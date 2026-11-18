// pi 1.5.0 codemode: a JavaScript script body that calls other tools.
// pi runs this in QuickJS. We use @earendil-works/pi-codemode (the same
// worker + QuickJS/WASM sandbox) instead of node:vm, so scripts have no Node,
// filesystem, network or timers; the only capabilities are the injected tools
// and globals. The model-facing result format remains pi's.

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CodemodeSandbox,
  loadQuickJSWasm,
  parseCodemodeSource,
} from '@earendil-works/pi-codemode';

export const CODEMODE_DEFAULT_MAX_OUTPUT_TOKENS = 10000;
export const CODEMODE_MAX_OUTPUT_CHARS = 16777216;
const CODEMODE_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;
const CODEMODE_DEFAULT_TIMEOUT_MS = 300000;
const READ_OUTPUT_SCHEMA = {
  oneOf: [
    { type: 'string' },
    {
      type: 'object',
      properties: {
        type: { const: 'image' },
        data: { type: 'string' },
        mimeType: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['type', 'data', 'mimeType', 'note'],
    },
  ],
};

const BASH_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    output: { type: 'string' },
    truncated: { type: 'boolean' },
    full_output_path: { type: 'string' },
    exit_code: { type: 'number' },
    wall_time_seconds: { type: 'number' },
  },
  required: ['output', 'truncated', 'exit_code', 'wall_time_seconds'],
};
const CODEMODE_MAX_WORKERS = 2;

let activeWorkers = 0;
const workerWaiters = [];

function grantWorker() {
  const next = workerWaiters.shift();
  if (next === undefined) return;
  activeWorkers += 1;
  next();
}

async function acquireWorker(signal) {
  if (signal?.aborted) return false;
  if (activeWorkers < CODEMODE_MAX_WORKERS) {
    activeWorkers += 1;
    return true;
  }
  return new Promise((resolve) => {
    const grant = () => {
      signal?.removeEventListener('abort', abort);
      resolve(true);
    };
    const abort = () => {
      const index = workerWaiters.indexOf(grant);
      if (index >= 0) workerWaiters.splice(index, 1);
      resolve(false);
    };
    workerWaiters.push(grant);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function releaseWorker() {
  activeWorkers -= 1;
  grantWorker();
}

export function toCodemodeIdentifier(name) {
  let identifier = '';
  for (const char of String(name)) {
    const valid = identifier === '' ? /^[A-Za-z_$]$/.test(char) : /^[A-Za-z0-9_$]$/.test(char);
    identifier += valid ? char : '_';
  }
  return identifier === '' ? '_' : identifier;
}

function describeValue(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function valueText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
}

function formatOutput(items, consoleLines) {
  const texts = items.filter((item) => item.type === 'text');
  const total = texts.length;
  const lines = [];
  let index = 0;
  for (const item of items) {
    if (item.type === 'text') {
      index += 1;
      if (total > 1) lines.push(`==> text ${index}/${total} <==`);
      lines.push(item.text);
    } else if (item.type === 'image') {
      lines.push(`[image: ${item.mimeType}, ${item.bytes} bytes${item.path ? `, saved to ${item.path}` : ''}]`);
    }
  }
  if (consoleLines.length === 0 && lines.length === 0) return '';
  let body = lines.join('\n');
  if (consoleLines.length > 0) {
    body += `${body.length > 0 ? '\n' : ''}<console_output>\n${consoleLines.join('\n')}\n</console_output>`;
  }
  return body;
}

function truncateMiddle(text, maxChars) {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return `${text.slice(0, half)}\n\n... output truncated (${text.length - maxChars} characters) ...\n\n${text.slice(-half)}`;
}

function rankTools(query, tools, limit) {
  const terms = String(query).toLowerCase().split(/[^\p{L}\p{M}\p{N}_]+/u).filter(Boolean);
  const scored = tools.map((tool) => {
    const text = `${tool.name} ${tool.description ?? ''}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (tool.name.toLowerCase() === term) score += 8;
      else if (tool.name.toLowerCase().includes(term)) score += 4;
      if (text.includes(term)) score += 1;
    }
    return { tool, score };
  });
  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, limit)
    .map((entry) => entry.tool);
}

let imageSequence = 0;

function saveImage(data, mimeType) {
  try {
    const directory = join(tmpdir(), 'pi-codemode-images');
    mkdirSync(directory, { recursive: true });
    const extension = String(mimeType ?? 'image/png').split('/')[1]?.replace(/[^a-z0-9]+/gi, '') || 'png';
    imageSequence += 1;
    const file = join(directory, `image-${Date.now()}-${imageSequence}.${extension}`);
    writeFileSync(file, Buffer.from(String(data ?? ''), 'base64'));
    return file;
  } catch {
    return undefined;
  }
}

function outputItems(result) {
  const items = [];
  const consoleLines = [];
  for (const item of result.output ?? []) {
    if (item.type === 'text') {
      if (item.console) consoleLines.push(item.text);
      else items.push({ type: 'text', text: item.text });
    } else if (item.type === 'image') {
      items.push({
        type: 'image',
        mimeType: item.mimeType,
        bytes: Math.floor((String(item.data ?? '').length * 3) / 4),
        path: saveImage(item.data, item.mimeType),
      });
    }
  }
  return { items, consoleLines };
}

function errorMessage(result) {
  const { error } = result;
  if (error.kind === 'script') return error.stack ?? `${error.name ?? 'Error'}: ${error.message}`;
  if (error.kind === 'timeout') return `Script timed out: ${error.message}`;
  if (error.kind === 'aborted') return `Script aborted: ${error.message}`;
  return `Script sandbox failed: ${error.message}`;
}

function failure(message, body = '') {
  return `Script failed\nWall time 0.0 seconds\nOutput:\n\n${body}${body.length > 0 ? '\n\n' : ''}Script error:\n${message}`;
}

function makeGlobals(input) {
  const toolEntries = (input.tools ?? []).map((tool) => ({ ...tool, jsName: toCodemodeIdentifier(tool.name) }));
  const toolByName = new Map(toolEntries.map((tool) => [tool.name, tool]));
  const toolByJsName = new Map(toolEntries.map((tool) => [tool.jsName, tool]));

  const searchTools = async (args) => {
    const [first, second] = Array.isArray(args) ? args : [args, undefined];
    const query = typeof first === 'string' ? first : String(first?.query ?? '');
    const options = second ?? (typeof first === 'object' && first !== null ? first : {});
    const limit = Number.isInteger(options.limit) ? options.limit : 8;
    const namespace = options.namespace;
    let candidates = toolEntries;
    if (namespace != null) {
      const wanted = String(namespace).replace(/^mcp__/, '');
      candidates = candidates.filter((tool) => tool.name.startsWith(`mcp__${wanted}__`) || tool.name.startsWith(`mcp__${namespace}__`));
    }
    return rankTools(query, candidates, limit).map((tool) => ({ name: tool.name, description: tool.description ?? '' }));
  };

  const describeTool = async (name) => {
    const tool = toolByName.get(name) ?? toolByJsName.get(name);
    if (!tool) return undefined;
    const params = tool.parameters ? JSON.stringify(tool.parameters, null, 2) : '{}';
    return `${tool.description ?? ''}\n\nParameters: ${params}`;
  };

  const describeNamespace = async (name) => {
    const wanted = String(name).replace(/^mcp__/, '');
    const members = toolEntries.filter((tool) => tool.name.startsWith(`mcp__${wanted}__`));
    if (members.length === 0) return undefined;
    const namespace = (input.namespaces ?? []).find((entry) => entry.name === wanted);
    return {
      name: `mcp__${wanted}`,
      ...(namespace?.description ? { description: namespace.description } : {}),
      ...(namespace?.instructions ? { instructions: namespace.instructions } : {}),
      tools: members.map((tool) => tool.jsName),
    };
  };

  const unavailable = (kind) => async () => ({
    stopReason: 'error',
    errorMessage: `${kind} models are not available through pi-compat`,
    ...(kind === 'image' ? { output: [] } : {}),
  });

  return [
    { name: 'searchTools', spread: true, execute: searchTools },
    { name: 'describeTool', execute: describeTool },
    { name: 'describeNamespace', execute: describeNamespace },
    { name: 'models.getModelsOfType', execute: async () => [] },
    { name: 'models.getAvailableOfType', execute: async () => [] },
    { name: 'models.getModelOfType', execute: async () => undefined },
    { name: 'models.classify', execute: unavailable('classifier') },
    { name: 'models.generateImages', execute: unavailable('image') },
  ];
}

/**
 * Run one codemode script in the same QuickJS/WASM worker sandbox pi uses.
 *
 * @param {object} input
 * @param {string} input.code raw JavaScript source.
 * @param {Array<{name:string,description?:string,parameters?:object,outputSchema?:object}>} input.tools callable tools.
 * @param {(name:string,args:object,signal:AbortSignal)=>Promise<unknown>} input.callTool nested tool call.
 * @param {Map<string,unknown>} input.store persisted store.
 * @param {AbortSignal} [input.signal]
 * @param {number} [input.defaultTimeoutMs]
 * @param {Array<{name:string,description?:string,exposure?:string,instructions?:string}>} [input.namespaces]
 */
export async function runCodemode(input) {
  const startedAt = performance.now();
  let source;
  try {
    source = parseCodemodeSource(String(input.code ?? ''));
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }

  const maxOutputTokens = Number.isFinite(source.options.maxOutputTokens)
    ? source.options.maxOutputTokens
    : CODEMODE_DEFAULT_MAX_OUTPUT_TOKENS;
  const timeoutMs = Number.isFinite(source.options.timeoutMs)
    ? source.options.timeoutMs
    : input.defaultTimeoutMs ?? CODEMODE_DEFAULT_TIMEOUT_MS;

  const store = input.store ?? new Map();
  const tools = (input.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
    outputSchema: tool.name === 'bash' ? BASH_OUTPUT_SCHEMA : tool.name === 'read' ? READ_OUTPUT_SCHEMA : tool.outputSchema,
    execute: (args, { signal }) => input.callTool(tool.name, args ?? {}, signal),
  }));

  const acquired = await acquireWorker(input.signal);
  if (!acquired) return failure('Script aborted: execution cancelled while waiting for a codemode worker');

  let sandbox;
  let result;
  try {
    sandbox = new CodemodeSandbox({
      tools,
      globals: makeGlobals(input),
      timeoutMs,
      memoryLimitBytes: CODEMODE_MEMORY_LIMIT_BYTES,
      wasm: loadQuickJSWasm(),
    });
    result = await sandbox.execute(source.code, {
      signal: input.signal,
      store: Object.fromEntries(store),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(message);
  } finally {
    try {
      await sandbox?.close();
    } finally {
      releaseWorker();
    }
  }

  if (result.ok) {
    for (const [key, value] of Object.entries(result.storeWrites?.set ?? {})) store.set(key, value);
    for (const key of result.storeWrites?.delete ?? []) store.delete(key);
  }

  const { items, consoleLines } = outputItems(result);
  if (result.ok && result.value !== undefined) {
    items.push({ type: 'text', text: valueText(result.value) });
  }

  const wallTimeSeconds = (performance.now() - startedAt) / 1000;
  const body = truncateMiddle(formatOutput(items, consoleLines), maxOutputTokens * 4);
  if (!result.ok) {
    return `Script failed\nWall time ${wallTimeSeconds.toFixed(1)} seconds\nOutput:\n\n${body}${body.length > 0 ? '\n\n' : ''}Script error:\n${errorMessage(result)}`;
  }
  return `Script completed\nWall time ${wallTimeSeconds.toFixed(1)} seconds\nOutput:\n\n${body}`;
}
