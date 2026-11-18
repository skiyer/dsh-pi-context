// Read the user-level pi MCP configuration (~/.pi/agent/mcp.json) and expose
// its enabled servers through DSH's global MCP manager. This lets Pi 模式 use
// the same MCP entries as pi without duplicating them in a DSH profile.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export const name = 'pi-mcp-config';
export const inject = ['mcpManager'];

function expandHome(value) {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

function expandEnv(value, env) {
  return String(value).replaceAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, key) => (
    env[key] === undefined ? match : env[key]
  ));
}

function expandValue(value, env) {
  if (typeof value !== 'string') return value;
  return expandHome(expandEnv(value, env));
}

function expandMap(values, env) {
  if (values === undefined || values === null) return undefined;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, expandValue(value, env)]));
}

/** Convert one pi mcp.json entry to a DSH mcp-manager registration. */
export function toDshEntry(server, env = process.env) {
  if (server === null || typeof server !== 'object') throw new Error('entry is not an object');
  if (server.enabled === false) return undefined;
  const command = expandValue(server.command, env);
  const url = expandValue(server.url, env);
  const timeout = Number.isFinite(server.timeout) && server.timeout > 0
    ? Math.round(server.timeout * 1000)
    : 60000;
  if (typeof command === 'string' && command.length > 0) {
    return {
      transport: 'stdio',
      command,
      ...(Array.isArray(server.args) ? { args: server.args.map((value) => expandValue(value, env)) } : {}),
      ...(server.env === undefined ? {} : { env: expandMap(server.env, env) }),
      ...(server.cwd === undefined ? {} : { cwd: expandValue(server.cwd, env) }),
      startupTimeoutMs: timeout,
    };
  }
  if (typeof url === 'string' && url.length > 0) {
    return {
      transport: 'streamable-http',
      url,
      ...(server.headers === undefined ? {} : { headers: expandMap(server.headers, env) }),
      startupTimeoutMs: timeout,
    };
  }
  throw new Error('entry needs command or url');
}

function normalizeExposure(exposure) {
  if (exposure === 'codemode-deferred') return 'deferred';
  return ['codemode', 'deferred', 'direct', 'hidden'].includes(exposure) ? exposure : 'codemode';
}

/**
 * Read pi's user-level MCP config. Project `.pi/mcp.json` is intentionally not
 * read here: DSH's MCP manager is global, while pi's project config is trusted
 * per project. Use DSH's own profile/settings for project-scoped entries.
 *
 * @param {{file?: string, env?: NodeJS.ProcessEnv}} [options]
 */
export function loadPiMcpConfig(options = {}) {
  const file = options.file ?? join(homedir(), '.pi', 'agent', 'mcp.json');
  const env = options.env ?? process.env;
  let document;
  try {
    document = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return { file, servers: {}, exposures: {}, errors: [] };
    return { file, servers: {}, exposures: {}, errors: [{ name: '', message: String(error?.message ?? error) }] };
  }
  const configured = document?.mcpServers;
  if (configured === null || typeof configured !== 'object' || Array.isArray(configured)) {
    return { file, servers: {}, exposures: {}, errors: [{ name: '', message: 'mcpServers must be an object' }] };
  }
  const servers = {};
  const exposures = {};
  const errors = [];
  for (const [serverName, server] of Object.entries(configured)) {
    try {
      const entry = toDshEntry(server, env);
      if (entry === undefined) continue;
      servers[serverName] = entry;
      exposures[serverName] = {
        exposure: normalizeExposure(server.exposure),
        ...(typeof server.description === 'string' && server.description.length > 0
          ? { description: server.description }
          : {}),
        ...(server.toolExposure !== null && typeof server.toolExposure === 'object' && !Array.isArray(server.toolExposure)
          ? { toolExposure: server.toolExposure }
          : {}),
      };
    } catch (error) {
      errors.push({ name: serverName, message: String(error?.message ?? error) });
    }
  }
  return { file, servers, exposures, errors };
}

/** Register every enabled pi MCP server for the lifetime of this plugin. */
export function apply(ctx, config = loadPiMcpConfig()) {
  for (const { name: serverName, message } of config.errors) {
    ctx.logger?.warn?.(`pi-mcp-config: ${serverName || config.file}: ${message}`);
  }
  for (const [serverName, entry] of Object.entries(config.servers)) {
    try {
      ctx.mcpManager.register(serverName, entry);
    } catch (error) {
      ctx.logger?.warn?.(`pi-mcp-config: cannot register "${serverName}": ${error?.message ?? error}`);
    }
  }
}
