// pi 1.5.0 context-management facade: system prompt, tool declarations and the
// OpenAI chat-completions request transform. Values are taken from captured
// vanilla pi requests; see ../../capture/bodies.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PI_TOOL_DECLARATIONS,
  TOOL_CODEMODE,
  TOOL_SEARCH,
  TOOL_SNIPPETS,
} from './pi-tools.js';

export const PI_CODEMODE_DOCUMENT = fileURLToPath(new URL('../docs/pi/codemode.md', import.meta.url));

/** Replace the declaration placeholder with the installed vendored-doc path. */
export function renderCodemodeDescription(description = TOOL_CODEMODE.description) {
  return String(description).replaceAll('{{pi_codemode_docs}}', PI_CODEMODE_DOCUMENT);
}

export const PI_PREAMBLE = 'You are an AI agent powered by DeepSeek Harness in Pi mode. Help users inspect files, run commands, and modify code.';

export const PI_RULES = [
  ['bash', 'Use bash for file operations like ls, rg, find'],
  ['read', 'Use read to examine files instead of cat or sed.'],
  ['edit', 'Use edit for targeted changes. Batch changes to one file in a single call.'],
  ['edit', 'Each edits[].oldText must exactly and uniquely match the original file. Keep matches short and non-overlapping; merge nearby changes without including large unchanged regions.'],
  ['write', 'Use write only for new files or complete rewrites.'],
  ['codemode', 'Use codemode to batch independent tool calls (Promise.allSettled), chain them, or filter large output, instead of many separate calls.'],
  [null, 'Be concise in your responses'],
  [null, 'Show file paths clearly when working with files'],
];

export const DEFAULT_MCP_EXPOSURE = 'codemode';
export const MAX_MCP_SERVER_DESCRIPTION_CHARS = 250;
export const MAX_MCP_SERVERS_SECTION_CHARS = 4096;

/** Strip the codemode addendum pi appends to a direct tool description in mode "on". */
export function withoutCodemodeAddendum(description) {
  const index = description.lastIndexOf('\n\nCodemode: `tools.');
  return index === -1 ? description : description.slice(0, index);
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** The declared pi tools, in pi's selection order. */
export function piDeclarations(options = {}) {
  const codemode = options.codemode !== false;
  const declarations = [];
  for (const declaration of PI_TOOL_DECLARATIONS) {
    if (declaration.name === 'codemode' && !codemode) continue;
    const copy = deepClone(declaration);
    if (copy.name === 'codemode') copy.description = renderCodemodeDescription(copy.description);
    if (!codemode) copy.description = withoutCodemodeAddendum(copy.description);
    declarations.push({ type: 'function', function: copy });
  }
  if (options.toolSearch === true) declarations.push({ type: 'function', function: deepClone(TOOL_SEARCH) });
  return declarations;
}

/** Render pi's project_context section; this is the exact section format from pi 1.5.0. */
function formatProjectContext(files) {
  return [
    'Project-specific instructions and guidelines:',
    ...files.map(({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`),
  ].join('\n');
}

/** Resolve a DSH model-facing instruction path to the absolute path pi reports. */
function absoluteInstructionPath(displayPath, cwd) {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  const agentsHome = process.env.AGENTS_HOME ?? join(homedir(), '.agents');
  if (displayPath.startsWith('$DSH_HOME/')) return join(home, displayPath.slice('$DSH_HOME/'.length));
  if (displayPath.startsWith('$AGENTS_HOME/')) return join(agentsHome, displayPath.slice('$AGENTS_HOME/'.length));
  if (displayPath.startsWith('~/')) return join(homedir(), displayPath.slice(2));
  if (isAbsolute(displayPath)) return displayPath;
  return resolve(cwd, displayPath);
}

/** Extract the instruction file sections DSH rendered inside a system-reminder. */
function readProjectContextFromMessages(messages, cwd) {
  const files = [];
  const seen = new Set();
  for (const message of messages) {
    if (message.role !== 'user' || !isPureSystemReminder(message.content)) continue;
    let text = textOf(message.content);
    const open = text.indexOf('<system-reminder>');
    const close = text.lastIndexOf('</system-reminder>');
    if (open !== -1 && close > open) {
      text = text.slice(open + '<system-reminder>'.length, close);
    }
    if (!text.includes('Instructions from: ')) continue;
    for (const part of text.split(/\n?Instructions from: /).slice(1)) {
      const lineEnd = part.indexOf('\n');
      if (lineEnd === -1) continue;
      const displayPath = part.slice(0, lineEnd).trim();
      const content = part.slice(lineEnd).replace(/^\n\n?/, '').replace(/\n+$/, '');
      if (displayPath.length === 0 || seen.has(displayPath)) continue;
      seen.add(displayPath);
      files.push({ path: absoluteInstructionPath(displayPath, cwd), content });
    }
  }
  return files;
}

/** The model-facing system prompt sections pi composes for context management. */
export function buildSystemPrompt(options) {
  const tools = options.tools ?? [];
  const rows = tools.map((name) => `- ${name}: ${TOOL_SNIPPETS[name] ?? ''}`).join('\n');
  const sections = {};

  sections.preamble = PI_PREAMBLE;
  sections.tools = `${rows || '(none)'}\n\nAdditional tools may be available.`;

  const visible = new Set(tools);
  const rules = PI_RULES
    .filter(([tool]) => tool === null || visible.has(tool))
    .map(([, text]) => `- ${text}`)
    .filter((line, index, all) => all.indexOf(line) === index);
  sections.rules = rules.join('\n');

  if (existsSync(PI_CODEMODE_DOCUMENT)) {
    sections.docs = `Pi codemode reference (vendored from pi 1.5.0; read only when the user asks about codemode, models, or script behavior):\n- ${PI_CODEMODE_DOCUMENT}`;
  }

  if (Array.isArray(options.projectContext) && options.projectContext.length > 0) {
    sections.project_context = formatProjectContext(options.projectContext);
  }

  if (Array.isArray(options.skills) && options.skills.length > 0) {
    sections.skills = formatPiSkills(options.skills);
  }

  sections.cwd = String(options.cwd ?? '').replaceAll('\\', '/');

  if (Array.isArray(options.mcpServers) && options.mcpServers.length > 0) {
    sections.mcp_servers = formatMcpServers(options.mcpServers);
  }

  return Object.entries(sections)
    .filter(([, text]) => text !== undefined && text !== null && text !== '')
    .map(([name, text]) => (name === 'preamble' ? text : `<${name}>\n${text}\n</${name}>`))
    .join('\n\n');
}

/** Normalize pi's exposure aliases and unknown values. */
export function normalizeExposure(exposure) {
  if (exposure === 'codemode-deferred') return 'deferred';
  return ['codemode', 'deferred', 'direct', 'hidden'].includes(exposure)
    ? exposure
    : DEFAULT_MCP_EXPOSURE;
}

function wildcardMatch(pattern, value) {
  let source = '^';
  for (const char of pattern) source += char === '*' ? '.*' : char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${source}$`).test(value);
}

/** Resolve one tool's exposure: server default, exact override, then first wildcard. */
export function effectiveToolExposure(serverConfig, toolName) {
  const entry = serverConfig ?? {};
  const overrides = entry.toolExposure;
  if (overrides && typeof overrides === 'object' && typeof toolName === 'string') {
    if (Object.hasOwn(overrides, toolName)) return normalizeExposure(overrides[toolName]);
    for (const [pattern, exposure] of Object.entries(overrides)) {
      if (pattern.includes('*') && wildcardMatch(pattern, toolName)) return normalizeExposure(exposure);
    }
  }
  return normalizeExposure(entry.exposure);
}

/** The effective exposures active for one server, across the tools it actually has. */
export function serverExposures(serverConfig, tools = []) {
  const names = Array.isArray(tools) ? tools.filter((name) => typeof name === 'string') : [];
  if (names.length === 0) return new Set([normalizeExposure(serverConfig?.exposure)]);
  return new Set(names.map((name) => effectiveToolExposure(serverConfig, name)));
}

/** pi's display namespace: hyphens in a server name become underscores. */
export function mcpNamespace(name) {
  return `mcp__${String(name).replaceAll('-', '_')}`;
}

function descriptionLine(description) {
  if (typeof description !== 'string') return '';
  const first = description.split(/\r?\n/, 1)[0].trim();
  return first;
}

/**
 * pi's `<mcp_servers>` section. Servers are listed only when at least one of
 * their tools is reachable indirectly (`codemode` or `deferred`); `direct`
 * tools are declared normally and `hidden` tools are absent.
 */
export function formatMcpServers(servers) {
  const listed = [];
  for (const server of servers) {
    const toolExposures = serverExposures({
      exposure: server.exposure,
      toolExposure: server.toolExposure,
    }, server.tools);
    if (!toolExposures.has('codemode') && !toolExposures.has('deferred')) continue;
    listed.push({
      ...server,
      reach: toolExposures.has('codemode') ? 'codemode' : 'tool_search',
      summary: descriptionLine(server.description),
    });
  }
  if (listed.length === 0) return undefined;
  listed.sort((a, b) => a.name.localeCompare(b.name));

  const reaches = new Set(listed.map((server) => server.reach));
  const intro = 'MCP servers whose tools are not declared to you.'
    + (reaches.has('codemode') ? ' Call the tools of `codemode` servers from codemode scripts.' : '')
    + (reaches.has('tool_search') ? ' Load the tools of `tool_search` servers with `tool_search`.' : '');

  const makeLine = (server, limit) => {
    const base = `- ${mcpNamespace(server.name)} (${server.reach})`;
    if (server.summary.length === 0 || limit <= 0) return base;
    const summary = server.summary.length <= limit
      ? server.summary
      : `${server.summary.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
    return `${base}: ${summary}`;
  };
  const omittedLine = (count) => `- … ${count} more server${count === 1 ? '' : 's'}; find their tools with searchTools()`;
  const section = (kept, omitted, limit) => [
    intro,
    ...kept.map((server) => makeLine(server, limit)),
    ...(omitted > 0 ? [omittedLine(omitted)] : []),
  ].join('\n');

  let kept = listed.slice();
  let omitted = 0;
  let limit = MAX_MCP_SERVER_DESCRIPTION_CHARS;
  while (section(kept, omitted, limit).length > MAX_MCP_SERVERS_SECTION_CHARS) {
    if (limit > 0) {
      limit = Math.max(0, limit - 20);
    } else if (kept.length > 0) {
      kept = kept.slice(0, -1);
      omitted += 1;
    } else {
      break;
    }
  }
  return section(kept, omitted, limit);
}

/** Recover the session cwd from the DSH runtime reminder without keeping it. */
export function readCwdFromMessages(messages) {
  for (const message of messages) {
    const text = textOf(message.content);
    const marker = /<pi-cwd>([\s\S]*?)<\/pi-cwd>/.exec(text);
    if (marker) return marker[1].trim();
    const cwd = /<cwd>\n([\s\S]*?)\n<\/cwd>/.exec(text);
    if (cwd) return cwd[1];
    const match = /Current working directory: "([^"]+)"/.exec(text);
    if (match) return match[1];
  }
  return undefined;
}

export function readSkillsFromMessages(messages) {
  for (const message of messages) {
    const text = textOf(message.content);
    const marker = /<pi-skills>([A-Za-z0-9_-]*)<\/pi-skills>/.exec(text);
    if (!marker || marker[1] === '') continue;
    try {
      const parsed = JSON.parse(Buffer.from(marker[1], 'base64url').toString('utf8'));
      if (!Array.isArray(parsed)) continue;
      return parsed.filter((skill) => skill && typeof skill.name === 'string' && typeof skill.path === 'string');
    } catch {
      continue;
    }
  }
  return [];
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function formatPiSkills(skills) {
  const lines = [
    'The following skills provide specialized instructions for specific tasks.',
    "Use the read tool to load a skill's file when the task matches its description.",
    "Resolve relative paths against the skill's directory (parent of SKILL.md). Use absolute paths in tool calls.",
    '',
    '<available_skills>',
  ];
  for (const skill of skills) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description ?? '')}</description>`);
    lines.push(`    <location>${escapeXml(skill.path)}</location>`);
    lines.push('  </skill>');
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

export function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

const REMINDER = /^\s*<system-reminder>[\s\S]*<\/system-reminder>\s*$/;
const REMINDER_BLOCK = /^\s*<system-reminder>[\s\S]*<\/system-reminder>\s*$/;

function isPureSystemReminder(content) {
  if (typeof content === 'string') return REMINDER.test(content);
  if (!Array.isArray(content)) return false;
  const blocks = content.filter((block) => block && block.type === 'text');
  if (blocks.length === 0) return false;
  return blocks.every((block) => REMINDER_BLOCK.test(block.text ?? ''));
}

function mcpServerOf(name, serverNames) {
  for (const server of serverNames) {
    if (name.startsWith(`mcp__${server}__`)) return server;
  }
  const match = /^mcp__([^_]+(?:[_][^_]+)*)__/.exec(name);
  return match ? match[1] : undefined;
}

/**
 * Rewrite one DSH OpenAI chat-completions body into vanilla pi's shape.
 *
 * Returns undefined when the request is not a pi-compat agent request (for
 * example the session-title call), so callers leave it untouched.
 */
export function transformRequestBody(body, options = {}) {
  if (!body || typeof body !== 'object') return undefined;
  const originalTools = Array.isArray(body.tools) ? body.tools : [];
  const schemaFor = (tool) => tool.function ?? tool;
  const originalNames = new Set(originalTools.map((tool) => schemaFor(tool).name));
  const agentRequest = originalNames.has('codemode') && originalNames.has('read') && originalNames.has('bash');
  if (!agentRequest) return undefined;

  const mcpConfig = options.mcpServers ?? {};
  const serverNames = Object.keys(mcpConfig);
  const cwd = options.cwd
    ?? readCwdFromMessages(body.messages ?? [])
    ?? process.cwd();
  const skills = options.skills ?? readSkillsFromMessages(body.messages ?? []);
  const projectContext = options.projectContext ?? readProjectContextFromMessages(body.messages ?? [], cwd);

  const mcp = [];
  const mcpToolsByServer = new Map();
  for (const tool of originalTools) {
    const schema = schemaFor(tool);
    if (typeof schema.name !== 'string' || !schema.name.startsWith('mcp__')) continue;
    const server = mcpServerOf(schema.name, serverNames);
    if (server === undefined) continue;
    const shortName = schema.name.slice(`mcp__${server}__`.length);
    const tools = mcpToolsByServer.get(server) ?? [];
    tools.push(shortName);
    mcpToolsByServer.set(server, tools);
    const exposure = effectiveToolExposure(mcpConfig[server], shortName);
    if (exposure === 'hidden' || exposure === 'codemode') continue;
    mcp.push({ server, exposure, schema });
  }
  mcp.sort((a, b) => a.schema.name.localeCompare(b.schema.name));

  const loaded = options.loadedToolNames ?? new Set();
  const deferredTools = new Set(
    mcp.filter(({ exposure }) => exposure === 'deferred').map(({ schema }) => schema.name),
  );
  const visibleMcp = mcp.filter(({ exposure, schema }) => exposure === 'direct'
    || (exposure === 'deferred' && deferredTools.has(schema.name) && loaded.has(schema.name)));

  const toolSearch = deferredTools.size > 0;
  const declarations = piDeclarations({ codemode: options.codemode !== false, toolSearch });
  for (const { schema } of visibleMcp) {
    declarations.push({
      type: 'function',
      function: {
        name: schema.name,
        description: schema.description ?? '',
        parameters: schema.parameters ?? { type: 'object', properties: {} },
      },
    });
  }

  const toolList = declarations.map((tool) => tool.function.name);

  const mcpServers = serverNames.map((name) => ({
    name,
    exposure: mcpConfig[name]?.exposure ?? DEFAULT_MCP_EXPOSURE,
    description: mcpConfig[name]?.description,
    toolExposure: mcpConfig[name]?.toolExposure,
    tools: mcpToolsByServer.get(name) ?? [],
  }));
  for (const server of mcpToolsByServer.keys()) {
    if (!mcpServers.some((entry) => entry.name === server)) {
      mcpServers.push({
        name: server,
        exposure: mcpConfig[server]?.exposure ?? DEFAULT_MCP_EXPOSURE,
        description: mcpConfig[server]?.description,
        toolExposure: mcpConfig[server]?.toolExposure,
        tools: mcpToolsByServer.get(server) ?? [],
      });
    }
  }

  const systemPrompt = buildSystemPrompt({ cwd, tools: toolList, mcpServers, skills, projectContext });

  const messages = [];
  let instructionWritten = false;
  for (const message of body.messages ?? []) {
    if (message.role === 'system' || message.role === 'developer') {
      if (!instructionWritten) {
        messages.push({ role: 'developer', content: systemPrompt });
        instructionWritten = true;
      }
      continue;
    }
    if (message.role === 'user') {
      if (isPureSystemReminder(message.content)) continue;
      const text = textOf(message.content);
      if (Array.isArray(message.content)) {
        messages.push({ ...message, content: message.content.map((block) => (block && block.type === 'text' ? { type: 'text', text: block.text } : block)) });
      } else {
        messages.push({ role: 'user', content: [{ type: 'text', text }] });
      }
      continue;
    }
    messages.push(message);
  }

  const transformed = {
    ...body,
    messages,
    tools: declarations,
  };
  return {
    body: transformed,
    summary: {
      cwd,
      tools: toolList,
      mcpServers: mcpServers.map((server) => `${server.name}:${server.exposure}`),
      droppedReminders: (body.messages ?? []).length - messages.length,
    },
  };
}
