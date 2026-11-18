import assert from 'node:assert/strict';
import { runCodemode } from '../src/pi-codemode.js';

const tools = [
  { name: 'read', description: 'Read file contents', parameters: { type: 'object' } },
  { name: 'mcp__demo__echo', description: 'Echo text', parameters: { type: 'object' } },
];

async function run(code, options = {}) {
  const store = options.store ?? new Map();
  const output = await runCodemode({
    code,
    tools,
    callTool: async (name, args) => {
      if (args?.fail) throw new Error('tool failure');
      return `${name}:${JSON.stringify(args)}`;
    },
    store,
    defaultTimeoutMs: 10000,
    ...options,
  });
  return { output, store };
}

// QuickJS has no host capabilities and cannot reach the host realm.
{
  const { output } = await run(`
    const caps = [typeof process, typeof require, typeof fetch, typeof setTimeout].join(',');
    const escaped = text.constructor.constructor('return typeof process')();
    return caps + '|' + escaped;
  `);
  assert.ok(output.startsWith('Script completed'), output);
  assert.ok(output.includes('undefined,undefined,undefined,undefined|undefined'), output);
  assert.ok(!output.includes('v24.'), output);
}

// Tool calls, text, console, return value and ALL_TOOLS.
{
  const { output } = await run(`
    const r = await tools.read({ path: 'a' });
    text(r);
    console.log('done');
    text(ALL_TOOLS.length);
    return 2;
  `);
  assert.ok(output.includes('==> text 1/3 <=='), output);
  assert.ok(output.includes('read:{"path":"a"}'), output);
  assert.ok(output.includes('<console_output>\ndone\n</console_output>'), output);
  assert.ok(output.includes('==> text 3/3 <=='), output);
  assert.ok(output.includes('\n2\n'), output);
}

// Tool errors become script errors.
{
  const { output } = await run('await tools.read({ fail: true });');
  assert.ok(output.startsWith('Script failed'), output);
  assert.ok(output.includes('tool failure'), output);
}

// Discovery globals are host values, not host objects.
{
  const { output } = await run(`
    const found = await searchTools('read', { limit: 2 });
    const described = await describeTool('read');
    return { found: found.length, described: described.startsWith('Read file') };
  `);
  assert.ok(output.startsWith('Script completed'), output);
  assert.ok(output.includes('{"found":1,"described":true}'), output);
}

// Store load/write/delete, only committed on success.
{
  const store = new Map([['seed', { a: 1 }]]);
  const { output } = await run(`
    store('x', { b: 2 });
    store('seed', undefined);
    return load('x');
  `, { store });
  assert.ok(output.includes('{"b":2}'), output);
  assert.deepEqual([...store.keys()], ['x']);
  assert.deepEqual(store.get('x'), { b: 2 });

  const failedStore = new Map([['keep', 1]]);
  const failed = await run(`
    store('lost', 2);
    throw new Error('stop');
  `, { store: failedStore });
  assert.ok(failed.output.startsWith('Script failed'), failed.output);
  assert.deepEqual([...failedStore.keys()], ['keep']);
}

// Image output and exit.
{
  const { output } = await run(`
    image('data:image/png;base64,iVBORw0KGgo=');
    exit();
    return 'not reached';
  `);
  assert.ok(output.startsWith('Script completed'), output);
  assert.match(output, /\[image: image\/png, 9 bytes(?:, saved to .+)?\]/, output);
  assert.ok(!output.includes('not reached'), output);
}

// Timeout, including an async wait that never resolves.
{
  const { output } = await run('while (true) {}', { defaultTimeoutMs: 100 });
  assert.ok(output.startsWith('Script failed'), output);
  assert.ok(output.includes('Script timed out'), output);

  const waiting = await run('await tools.read({ never: true });', {
    defaultTimeoutMs: 100,
    callTool: () => new Promise(() => {}),
  });
  assert.ok(waiting.output.startsWith('Script failed'), waiting.output);
  assert.ok(waiting.output.includes('Script timed out'), waiting.output);
}

// @options timeout.
{
  const { output } = await run('// @options: {"timeout_ms": 100}\nwhile (true) {}', { defaultTimeoutMs: 10000 });
  assert.ok(output.startsWith('Script failed'), output);
  assert.ok(output.includes('Script timed out'), output);
}

// Abort signal.
{
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const { output } = await run('while (true) {}', { signal: controller.signal, defaultTimeoutMs: 10000 });
  assert.ok(output.startsWith('Script failed'), output);
  assert.ok(output.includes('Script aborted') || output.includes('Script timed out'), output);
}

// VM memory limit.
{
  const { output } = await run('new Uint8Array(300 * 1024 * 1024);');
  assert.ok(output.startsWith('Script failed'), output);
  assert.ok(output.includes('out of memory'), output);
}

// Source syntax and option errors.
{
  const { output } = await run('');
  assert.ok(output.startsWith('Script failed'), output);
  assert.ok(output.includes('Source cannot be empty') || output.includes('empty'), output);
}

console.log('codemode: ok');
