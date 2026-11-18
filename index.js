// pi-compat: reproduce vanilla pi 1.5.0's context-management machinery in
// DeepSeek Harness — tool set, codemode, MCP exposure, prompt sections and the
// provider wire format.
//
// Two mount modes:
// - "preset": mounted inside a `@deepseek-ai/dsh-agent-preset` row, so only
//   agents that select that mode get pi's tools. This is how the `pi` mode in
//   the mode selector is built.
// - "global": mounted at the profile root and applied to every agent (the
//   standalone `vanilla-pi` profile).

import { appendFileSync } from 'node:fs';
import { readFile as readFileAsync } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  buildSystemPrompt,
  DEFAULT_MCP_EXPOSURE,
  effectiveToolExposure,
  renderCodemodeDescription,
  transformRequestBody,
} from './src/pi-context.js';
import { runCodemode, toCodemodeIdentifier } from './src/pi-codemode.js';
import { loadPiMcpConfig } from './src/pi-mcp-config.js';
import { readPiSettings } from './src/pi-mode-settings.js';
import {
  bashToolResult,
  detectImageFile,
  editTool,
  readTool,
  writeTool,
  resolvePath as resolvePathModule,
} from './src/pi-tools-runtime.js';
import {
  TOOL_BASH,
  TOOL_CODEMODE,
  TOOL_EDIT,
  TOOL_READ,
  TOOL_SEARCH,
  TOOL_WRITE,
} from './src/pi-tools.js';

const DEFAULTS = {
  mount: 'global',
  gatewayOrigins: ['http://127.0.0.1:3425'],
  codemode: true,
  installPromptSection: true,
  toolResultLimit: 2000,
  mcpServers: {},
  mcpWaitMs: 10000,
  suppressPromptContext: false,
};

const FETCH_SYMBOL = Symbol.for('@local/dsh-pi-compat/fetch-facade');
const COMPACTION_SYMBOL = Symbol.for('@local/dsh-pi-compat/compaction-facade');

function resolveReadPath(cwd, path) {
  try {
    return resolvePathModule(cwd, path);
  } catch {
    return path;
  }
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, '');
}

function blockText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((block) => block && block.type === 'text').map((block) => block.text).join('');
}

function serverOf(name, mcpServers) {
  for (const server of Object.keys(mcpServers)) {
    if (name.startsWith(`mcp__${server}__`)) return server;
  }
  const match = /^mcp__([^_]+(?:[_][^_]+)*)__/.exec(name);
  return match ? match[1] : undefined;
}

export function apply(ctx, rawConfig) {
  // A package-root Loader row exists only so the Client module graph can
  // discover this package's ./client export. The real Host facade is mounted
  // by the pi preset (or a deliberate global mount).
  if (rawConfig?.clientOnly === true) return;
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) };
  // Pi's mcp.json is the source of MCP exposure metadata in Pi 模式. Explicit
  // DSH profile config still wins, so a deployment can override a server.
  const mcpServers = () => {
    const settings = readPiSettings();
    const disabled = new Set(settings.disabledMcpServers);
    const all = { ...loadPiMcpConfig().exposures, ...(config.mcpServers ?? {}) };
    return Object.fromEntries(Object.entries(all).filter(([server]) => !disabled.has(server)));
  };
  const presetMount = config.mount === 'preset';
  const loadedToolNames = new Set();
  const stores = new Map();
  const agentDisposers = new Map();

  const logger = ctx.logger;
  const warn = (message) => {
    try {
      logger?.warn?.(message);
    } catch {
      // logging must never break the facade
    }
  };

  const debug = (value) => {
    if (!config.debugFile) return;
    try {
      appendFileSync(config.debugFile, `${JSON.stringify(value)}\n`);
    } catch {
      // debug output is best effort
    }
  };

  debug({ apply: true, mount: presetMount ? 'preset' : 'global' });

  // Resolve local skill metadata during prompt assembly and carry it in the
  // persona prefix as a base64 marker. The request transform turns that marker
  // into pi's <skills> section, so skills are discovered through DSH's registry
  // but loaded by pi's `read` tool (the path is included in the section).
  ctx.inject(['skills', 'workingDirectory'], (scope) => {
    scope.on('system-prompt/assemble', async (assembly, context, next) => {
      const result = await next();
      if (context.agent === undefined) return result;
      let encoded = '';
      try {
        const cwd = scope.workingDirectory.get(context.agent.session) ?? process.cwd();
        const list = await scope.skills.list({
          scope: context.agent,
          cwd,
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        });
        const disabled = new Set(readPiSettings().disabledSkills);
        const skills = list
          .filter((skill) => skill.invocation?.modelInvocable === true && typeof skill.path === 'string')
          .filter((skill) => !disabled.has(skill.name))
          .map((skill) => ({ name: skill.name, description: skill.description, path: skill.path }));
        if (skills.length > 0) encoded = Buffer.from(JSON.stringify(skills), 'utf8').toString('base64url');
      } catch {
        encoded = '';
      }
      result.variables.pi_skills = encoded;
      return result;
    }, { prepend: true });
  });

  // Expose the live session cwd as a prompt variable. A preset that suppresses
  // runtime-context reminders can carry `<pi-cwd>{{pi_cwd}}</pi-cwd>` in its
  // persona prefix; the request transform reads that marker before replacing
  // DSH's prompt with pi's. This mirrors dsh-working-directory's own context
  // rendering without keeping a user-visible system-reminder.
  ctx.inject(['systemPrompt', 'workingDirectory'], (scope) => {
    scope.effect(() => scope.systemPrompt.variable('pi_cwd', ({ agent }) => {
      if (agent === undefined) return undefined;
      try {
        return scope.workingDirectory.get(agent.session) ?? undefined;
      } catch {
        return undefined;
      }
    }));
  });

  // Optional: shadow DSH's required working-directory context section with an
  // empty one, so a profile with a static pi cwd emits no <system-reminder>
  // while the workingDirectory service remains available to tools and the UI.
  if (config.suppressPromptContext) {
    ctx.inject(['systemPrompt'], (scope) => {
      scope.effect(() => scope.systemPrompt.context({
        name: 'working-directory:current',
        order: scope.systemPrompt.getContextOrder('WORKING_DIRECTORY'),
        interpolate: false,
        text: () => '',
      }));
    });
  }

  const cwdFor = (scope, agent) => {
    try {
      const workingDirectory = scope.get('workingDirectory');
      if (workingDirectory && agent?.session) return workingDirectory.get(agent.session);
    } catch {
      // fall through
    }
    return config.cwd ?? process.cwd();
  };

  const storeFor = (agent) => {
    const key = agent?.id ?? 'preset';
    let store = stores.get(key);
    if (!store) {
      store = new Map();
      stores.set(key, store);
    }
    return store;
  };

  const textOutput = {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  };

  const bashOutput = {
    schema: {
      type: 'object',
      properties: {
        output: { type: 'string' },
        truncated: { type: 'boolean' },
        full_output_path: { type: 'string' },
        exit_code: { type: 'number' },
        wall_time_seconds: { type: 'number' },
        failure: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['output', 'truncated', 'exit_code', 'wall_time_seconds'],
    },
    render: (_args, value) => [{ type: 'text', text: typeof value?.text === 'string' ? value.text : '' }],
  };

  const describeTool = (declaration) => {
    if (config.codemode === false) {
      const index = declaration.description.lastIndexOf('\n\nCodemode: `tools.');
      if (index !== -1) return declaration.description.slice(0, index);
    }
    return declaration.description;
  };

  const resolveSchemas = async (scope, agent, toolSet, wantsMcp) => {
    let schemas = scope.tools.schemas(agent, toolSet);
    if (!wantsMcp || schemas.some((tool) => tool.name.startsWith('mcp__'))) return schemas;
    const deadline = Date.now() + (config.mcpWaitMs ?? 10000);
    while (Date.now() < deadline && !schemas.some((tool) => tool.name.startsWith('mcp__'))) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      schemas = scope.tools.schemas(agent);
    }
    return schemas;
  };

  const makeDefinitions = (scope) => {
    const definitions = [
      {
        name: 'read',
        description: describeTool(TOOL_READ),
        parameters: TOOL_READ.parameters,
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['kind'],
            properties: {
              kind: { type: 'string', enum: ['text', 'image'] },
              text: { type: 'string' },
              note: { type: 'string' },
              path: { type: 'string' },
              image: {
                type: 'object',
                additionalProperties: false,
                required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
                properties: {
                  attachmentId: { type: 'string' },
                  mediaType: { type: 'string' },
                  bytes: { type: 'integer' },
                  width: { type: 'integer' },
                  height: { type: 'integer' },
                  name: { type: 'string' },
                  originalDimensions: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['width', 'height'],
                    properties: {
                      width: { type: 'integer' },
                      height: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
          render: (_args, value) => {
            if (value.kind === 'image' && value.image) {
              return [
                { type: 'text', text: value.note ?? `Read image file [${value.image.mediaType}]` },
                { type: 'image', attachment: value.image },
              ];
            }
            return [{ type: 'text', text: value.text ?? '' }];
          },
        },
        isConcurrencySafe: () => true,
        timeoutMs: 120000,
        async execute(args, exec) {
          const cwd = cwdFor(scope, exec.agent);
          const absolute = resolveReadPath(cwd, args?.path);
          const mime = await detectImageFile(absolute);
          if (mime !== undefined) {
            const note = (detail) => ({
              kind: 'text',
              text: `Read image file [${mime}]\n[image could not be attached: ${detail}]`,
            });
            try {
              const attachments = scope.get('attachments');
              const llm = scope.get('llm');
              if (attachments === undefined || llm === undefined) return note('no attachment or model service');
              if (!attachments.imageLimits.mediaTypes.includes(mime)) return note(`${mime} images are not accepted by this deployment`);
              const routed = exec.agent?.session.requestHeader()?.config;
              const provider = routed?.provider ?? exec.agent?.options.provider;
              const model = routed?.model ?? exec.agent?.options.model;
              if (provider === undefined || model === undefined) return note('the current model route could not be resolved');
              const active = await llm.resolveModelInfo(provider, model, exec.signal);
              if (!active.inputModalities?.includes('image')) return note(`model "${model}" does not declare image input`);
              const data = await readFileAsync(absolute);
              const ref = await attachments.saveImage({ data, mediaType: mime, name: basename(absolute) });
              return {
                kind: 'image',
                note: `Read image file [${ref.mediaType}]`,
                path: absolute,
                image: {
                  attachmentId: ref.attachmentId,
                  mediaType: ref.mediaType,
                  bytes: ref.bytes,
                  width: ref.width,
                  height: ref.height,
                  ...(ref.name === undefined ? {} : { name: ref.name }),
                  ...(ref.originalDimensions === undefined ? {} : { originalDimensions: ref.originalDimensions }),
                },
              };
            } catch (error) {
              return note(error instanceof Error ? error.message : String(error));
            }
          }
          return { kind: 'text', text: await readTool(cwd, args ?? {}) };
        },
      },
      {
        name: 'bash',
        description: describeTool(TOOL_BASH),
        parameters: TOOL_BASH.parameters,
        output: bashOutput,
        isConcurrencySafe: () => false,
        timeoutMs: 600000,
        execute: async (args, exec) => {
          const result = await bashToolResult(cwdFor(scope, exec.agent), args ?? {}, exec.signal, config.shellPath);
          return { ...result.structured, text: result.text };
        },
      },
      {
        name: 'edit',
        description: describeTool(TOOL_EDIT),
        parameters: TOOL_EDIT.parameters,
        output: textOutput,
        isConcurrencySafe: () => false,
        timeoutMs: 120000,
        execute: async (args, exec) => editTool(cwdFor(scope, exec.agent), args ?? {}),
      },
      {
        name: 'write',
        description: describeTool(TOOL_WRITE),
        parameters: TOOL_WRITE.parameters,
        output: textOutput,
        isConcurrencySafe: () => false,
        timeoutMs: 120000,
        execute: async (args, exec) => writeTool(cwdFor(scope, exec.agent), args ?? {}),
      },
      {
        name: 'codemode',
        description: renderCodemodeDescription(),
        parameters: TOOL_CODEMODE.parameters,
        output: textOutput,
        isConcurrencySafe: () => true,
        timeoutMs: 900000,
        execute: async (args, exec) => {
          const agent = exec.agent;
          const callTool = async (name, callArgs, signal) => {
            if (name === 'codemode' || name === 'tool_search') {
              throw new Error(`Tool "${name}" cannot be called from a codemode script.`);
            }
            const callId = `codemode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const batch = await scope.tools.execute({
              calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(callArgs ?? {}) }],
              signal,
              agent,
              parent: exec.token,
            });
            const entry = batch.results?.[0];
            const result = entry?.result ?? entry;
            debug({ nested: name, result });
            if (!result) throw new Error(`Tool "${name}" returned no result.`);
            if (name.startsWith('mcp__')) {
              // DSH's MCP tool canonical value already is the CallToolResult
              // ({content, structuredContent?, isError}). Scripts must receive
              // it even when isError is true, like pi's nested calls.
              if (result.value !== null && typeof result.value === 'object' && Array.isArray(result.value.content)) {
                return result.value;
              }
              const content = (result.content ?? []).map((block) => {
                if (block?.type !== 'text' || typeof block.text !== 'string') return block;
                // DSH's MCP error projection prefixes the server's text with
                // "Error: "; scripts see the raw CallToolResult text in pi.
                return block.text.startsWith('Error: ')
                  ? { ...block, text: block.text.slice('Error: '.length) }
                  : block;
              });
              return {
                content,
                ...(result.value === undefined ? {} : { structuredContent: result.value }),
                isError: result.isError === true,
              };
            }
            if (result.isError) {
              throw new Error(blockText(result.content) || result.error?.message || `Tool "${name}" failed.`);
            }
            if (name === 'bash' && result.value !== null && typeof result.value === 'object') {
              const { text: _text, ...structured } = result.value;
              if (structured.failure !== undefined) throw new Error(structured.failure);
              delete structured.failure;
              return structured;
            }
            if (name === 'read' && result.value?.kind === 'image') {
              try {
                const data = await readFileAsync(result.value.path);
                return {
                  type: 'image',
                  data: data.toString('base64'),
                  mimeType: result.value.image?.mediaType ?? 'image/png',
                  note: result.value.note ?? '',
                };
              } catch {
                // Fall through to the rendered text when the file cannot be read.
              }
            }
            if (typeof result.value === 'string') return result.value;
            return blockText(result.content);
          };

          const code = String(args?.code ?? '');
          const wantsMcp = /mcp__|ALL_TOOLS|searchTools|describeTool|describeNamespace/.test(code);
          const schemas = await resolveSchemas(scope, agent, exec.toolSet, wantsMcp);
          const tools = schemas
            .filter((tool) => ['read', 'bash', 'edit', 'write'].includes(tool.name) || tool.name.startsWith('mcp__'))
            .filter((tool) => {
              if (!tool.name.startsWith('mcp__')) return true;
              const server = serverOf(tool.name, mcpServers());
              if (server === undefined) return false;
              const shortName = tool.name.slice(`mcp__${server}__`.length);
              return effectiveToolExposure(mcpServers()[server], shortName) !== 'hidden';
            });
          const namespaces = Object.entries(mcpServers()).map(([name, value]) => ({
            name,
            description: value?.description,
          }));
          debug({ codemodeTools: tools.map((tool) => tool.name) });
          return runCodemode({
            code,
            tools,
            callTool,
            store: storeFor(agent),
            signal: exec.signal,
            namespaces,
          });
        },
      },
      {
        name: 'tool_search',
        description: TOOL_SEARCH.description,
        parameters: TOOL_SEARCH.parameters,
        output: textOutput,
        isConcurrencySafe: () => true,
        timeoutMs: 60000,
        execute: async (args, exec) => {
          const query = String(args?.query ?? '');
          if (query.trim() === '') throw new Error('query must not be empty');
          const max = args?.limit ?? 8;
          if (!Number.isInteger(max) || max <= 0) throw new Error('limit must be a positive integer');
          const schemas = await resolveSchemas(scope, exec.agent, exec.toolSet, true);
          const candidates = schemas
            .filter((tool) => tool.name.startsWith('mcp__'))
            .filter((tool) => {
              const server = serverOf(tool.name, mcpServers());
              if (server === undefined) return false;
              const shortName = tool.name.slice(`mcp__${server}__`.length);
              return effectiveToolExposure(mcpServers()[server], shortName) === 'deferred';
            });
          const terms = query.toLowerCase().split(/[^\p{L}\p{M}\p{N}_]+/u).filter(Boolean);
          const matches = candidates
            .map((tool) => {
              const text = `${tool.name} ${tool.description ?? ''}`.toLowerCase();
              let score = 0;
              for (const term of terms) {
                if (tool.name.toLowerCase().includes(term)) score += 4;
                if (text.includes(term)) score += 1;
              }
              return { tool, score };
            })
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
            .slice(0, max)
            .map((entry) => entry.tool);
          for (const tool of matches) loadedToolNames.add(tool.name);
          if (matches.length === 0) return 'No matching tools found.';
          return `Loaded ${matches.length} tool${matches.length === 1 ? '' : 's'}. They are available from your next call:\n${matches
            .map((tool) => `- ${tool.name}: ${String(tool.description ?? '').trim().split(/\r?\n/)[0]}`)
            .join('\n')}`;
        },
      },
    ];
    return definitions;
  };

  const registerToolSet = (scope) => {
    const definitions = makeDefinitions(scope);
    for (const definition of definitions) {
      try {
        scope.tools.register(definition);
      } catch (error) {
        debug({ registerError: definition.name, message: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }
    debug({ registered: definitions.map((definition) => definition.name) });
  };

  const installPromptSection = (agent, scope) => {
    if (config.installPromptSection === false) return;
    const systemPrompt = scope.get('systemPrompt');
    if (!systemPrompt) return;
    try {
      const order = (() => {
        try {
          return systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX');
        } catch {
          return -1000;
        }
      })();
      systemPrompt.section({
        name: 'deployment:persona-prefix',
        order,
        interpolate: false,
        complete: true,
        text: () => {
          const cwd = cwdFor(scope, agent);
          let names = [];
          try {
            names = scope.tools.schemas(agent).map((tool) => tool.name);
          } catch {
            names = [];
          }
          const mcpByServer = new Map();
          for (const name of names) {
            if (!name.startsWith('mcp__')) continue;
            const server = serverOf(name, mcpServers());
            if (server === undefined) continue;
            const shortName = name.slice(`mcp__${server}__`.length);
            const list = mcpByServer.get(server) ?? [];
            list.push(shortName);
            mcpByServer.set(server, list);
          }
          const hasDeferred = [...mcpByServer].some(([server, serverTools]) => serverTools.some(
            (tool) => effectiveToolExposure(mcpServers()[server], tool) === 'deferred',
          ));
          const tools = ['read', 'bash', 'edit', 'write'];
          if (config.codemode !== false && names.includes('codemode')) tools.push('codemode');
          if (names.includes('tool_search') && hasDeferred) tools.push('tool_search');
          for (const name of names) {
            if (!name.startsWith('mcp__')) continue;
            const server = serverOf(name, mcpServers());
            if (server === undefined) continue;
            const shortName = name.slice(`mcp__${server}__`.length);
            if (effectiveToolExposure(mcpServers()[server], shortName) === 'direct') tools.push(name);
          }
          const servers = Object.entries(mcpServers()).map(([name, value]) => ({
            name,
            exposure: value?.exposure ?? DEFAULT_MCP_EXPOSURE,
            description: value?.description,
            toolExposure: value?.toolExposure,
            tools: mcpByServer.get(name) ?? [],
          }));
          for (const server of mcpByServer.keys()) {
            if (!servers.some((entry) => entry.name === server)) {
              servers.push({
                name: server,
                exposure: mcpServers()[server]?.exposure ?? DEFAULT_MCP_EXPOSURE,
                description: mcpServers()[server]?.description,
                toolExposure: mcpServers()[server]?.toolExposure,
                tools: mcpByServer.get(server) ?? [],
              });
            }
          }
          return buildSystemPrompt({ cwd, tools, mcpServers: servers });
        },
      });
      systemPrompt.suppressRuntimeContext();
    } catch (error) {
      warn(`pi-compat: could not install the pi system prompt section: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (presetMount) {
    // Preset scope is the direct parent of every agent using this mode, so
    // tools registered here shadow the global tools for those agents only.
    ctx.inject(['tools', 'workingDirectory'], (scope) => {
      registerToolSet(scope);
    });
  } else {
    const installForAgent = (agent) => {
      if (!agent?.ctx) return;
      if (agentDisposers.has(agent.id)) return;
      const dispose = agent.ctx.inject(['tools', 'workingDirectory'], (scope) => {
        registerToolSet(scope);
        installPromptSection(agent, scope);
      });
      agentDisposers.set(agent.id, dispose);
    };

    const uninstallForAgent = (agent) => {
      const dispose = agentDisposers.get(agent.id);
      if (dispose) {
        agentDisposers.delete(agent.id);
        try {
          dispose();
        } catch {
          // ignore
        }
      }
      stores.delete(agent.id);
    };

    ctx.effect(() => {
      const offCreated = ctx.on('agent/created', ({ agent }) => {
        installForAgent(agent);
      });
      const offDisposed = ctx.on('agent/disposed', ({ agent }) => {
        uninstallForAgent(agent);
      });
      let existing = [];
      try {
        const registry = ctx.agents ?? ctx.get('agents');
        existing = registry?.list?.() ?? [];
      } catch {
        existing = [];
      }
      for (const agent of existing) installForAgent(agent);
      return () => {
        try {
          offCreated?.();
        } catch {
          // ignore
        }
        try {
          offDisposed?.();
        } catch {
          // ignore
        }
        for (const dispose of [...agentDisposers.values()]) {
          try {
            dispose();
          } catch {
            // ignore
          }
        }
        agentDisposers.clear();
        stores.clear();
      };
    });
  }

  // The compaction patch is for global mounts. A preset mount supplies its own
  // PiCompactionEngine inside the preset's isolated compaction group.
  ctx.effect(() => {
    if (presetMount || config.compaction === 'service') return;
    const state = globalThis[COMPACTION_SYMBOL];
    if (state) {
      state.count += 1;
    } else {
      let dispose;
      let cancelled = false;
      import('./src/pi-compaction.js')
        .then((module) => module.applyCompactionPatch())
        .then((cleanup) => {
          if (cancelled) cleanup();
          else dispose = cleanup;
        })
        .catch((error) => warn(`pi-compat: compaction patch failed: ${error instanceof Error ? error.message : String(error)}`));
      globalThis[COMPACTION_SYMBOL] = { count: 1, dispose: () => dispose?.() };
      return () => {
        cancelled = true;
        const shared = globalThis[COMPACTION_SYMBOL];
        if (!shared) return;
        shared.count -= 1;
        if (shared.count <= 0) {
          shared.dispose();
          delete globalThis[COMPACTION_SYMBOL];
        }
      };
    }
    return () => {
      const shared = globalThis[COMPACTION_SYMBOL];
      if (!shared) return;
      shared.count -= 1;
      if (shared.count <= 0) {
        shared.dispose();
        delete globalThis[COMPACTION_SYMBOL];
      }
    };
  });

  // Provider context facade: rewrite the request body (instruction, tools and
  // message shape) into pi's context management. Identity headers are left as
  // DSH sends them. Installed once per process; the transformed body is the
  // only marker that decides whether a request belongs to the pi tool set.
  ctx.effect(() => {
    if (typeof globalThis.fetch !== 'function') return;
    const shared = globalThis[FETCH_SYMBOL];
    if (shared) {
      shared.count += 1;
      return () => {
        const current = globalThis[FETCH_SYMBOL];
        if (!current) return;
        current.count -= 1;
        if (current.count <= 0) {
          if (globalThis.fetch === current.wrapped) globalThis.fetch = current.original;
          delete globalThis[FETCH_SYMBOL];
        }
      };
    }

    const original = globalThis.fetch;
    const origins = config.gatewayOrigins.map(trimTrailingSlash);
    const wrapped = async function piCompatFetch(input, init) {
      let url;
      try {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
      } catch {
        url = undefined;
      }
      if (typeof url !== 'string' || !origins.some((origin) => url.startsWith(origin))) {
        return original.call(this, input, init);
      }
      if (!url.includes('/chat/completions') || typeof init?.body !== 'string') {
        return original.call(this, input, init);
      }
      let body;
      try {
        body = JSON.parse(init.body);
      } catch {
        return original.call(this, input, init);
      }
      debug({ requestTools: (body.tools ?? []).map((tool) => tool?.function?.name ?? tool?.name) });
      let transformed;
      try {
        transformed = transformRequestBody(body, {
          codemode: config.codemode !== false,
          mcpServers: mcpServers(),
          loadedToolNames,
          cwd: config.cwd,
        });
      } catch (error) {
        warn(`pi-compat: request transform failed, forwarding unchanged: ${error instanceof Error ? error.message : String(error)}`);
        return original.call(this, input, init);
      }
      if (!transformed) return original.call(this, input, init);
      return original.call(this, input, { ...init, body: JSON.stringify(transformed.body) });
    };

    globalThis.fetch = wrapped;
    globalThis[FETCH_SYMBOL] = {
      count: 1,
      original,
      wrapped,
      dispose: () => {
        if (globalThis.fetch === wrapped) globalThis.fetch = original;
      },
    };
    return () => {
      const current = globalThis[FETCH_SYMBOL];
      if (!current) return;
      current.count -= 1;
      if (current.count <= 0) {
        current.dispose();
        delete globalThis[FETCH_SYMBOL];
      }
    };
  });
}

export { toCodemodeIdentifier };
export default apply;
