import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, loadPiMcpConfig, toDshEntry } from '../src/pi-mcp-config.js';

const dir = await mkdtemp(join(tmpdir(), 'pi-mcp-config-test-'));
const file = join(dir, 'mcp.json');
await writeFile(file, JSON.stringify({
  mcpServers: {
    ida: {
      command: 'uvx',
      args: ['--agent=pi', '~/tool'],
      env: { TOKEN: '${MCP_TEST_TOKEN}' },
      cwd: '~/work',
      timeout: 12,
      exposure: 'codemode',
      toolExposure: { list_databases: 'direct' },
      description: 'IDA server',
    },
    docs: {
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer ${MCP_TEST_TOKEN}' },
      exposure: 'direct',
    },
    disabled: { command: 'nope', enabled: false },
    broken: { args: ['x'] },
  },
}));

const config = loadPiMcpConfig({ file, env: { MCP_TEST_TOKEN: 'secret', HOME: dir } });
assert.equal(config.errors.length, 1);
assert.equal(config.errors[0].name, 'broken');
assert.equal(config.servers.disabled, undefined);
assert.equal(config.servers.ida.transport, 'stdio');
assert.equal(config.servers.ida.command, 'uvx');
assert.deepEqual(config.servers.ida.args, ['--agent=pi', join(homedir(), 'tool')]);
assert.equal(config.servers.ida.env.TOKEN, 'secret');
assert.equal(config.servers.ida.startupTimeoutMs, 12000);
assert.equal(config.servers.ida.cwd, join(homedir(), 'work'));
assert.equal(config.exposures.ida.exposure, 'codemode');
assert.equal(config.exposures.ida.description, 'IDA server');
assert.deepEqual(config.exposures.ida.toolExposure, { list_databases: 'direct' });
assert.equal(config.servers.docs.transport, 'streamable-http');
assert.equal(config.exposures.docs.exposure, 'direct');
assert.equal(config.servers.docs.headers.Authorization, 'Bearer secret');

assert.equal(toDshEntry({ enabled: false, command: 'x' }), undefined);
assert.throws(() => toDshEntry({ args: [] }), /command or url/);

const registered = [];
const fake = {
  mcpManager: {
    register(name, entry) {
      if (name === 'taken') throw new Error('already configured');
      registered.push({ name, entry });
    },
  },
  logger: { warn() {} },
};
apply(fake, config);
assert.deepEqual(registered.map((entry) => entry.name).sort(), ['docs', 'ida']);

console.log('mcp-config: ok');
