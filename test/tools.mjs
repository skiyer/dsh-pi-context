import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodemode } from '../src/pi-codemode.js';
import { bashTool, bashToolResult, editTool, readTool, writeTool } from '../src/pi-tools-runtime.js';

const dir = await mkdtemp(join(tmpdir(), 'pi-compat-test-'));
await writeFile(join(dir, 'a.txt'), 'hello\nworld\n');
assert.equal(await readTool(dir, { path: 'a.txt' }), 'hello\nworld\n');
assert.equal(await readTool(dir, { path: 'a.txt', offset: 2 }), 'world\n');
await assert.rejects(readTool(dir, { path: 'missing.txt' }), /ENOENT/);
assert.equal(await editTool(dir, { path: 'a.txt', edits: [{ oldText: 'hello', newText: 'HELLO' }] }), 'Successfully replaced 1 block(s) in a.txt.');
assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'HELLO\nworld\n');
assert.equal(await writeTool(dir, { path: 'nested/b.txt', content: 'x' }), 'Successfully wrote to nested/b.txt');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
await writeFile(join(dir, 'dot.png'), png);
const imageRead = await readTool(dir, { path: 'dot.png' });
assert.ok(imageRead.startsWith('Read image file [image/png]'), imageRead);
assert.ok(imageRead.includes('not bridged'), imageRead);
const nonzero = await bashToolResult(dir, { command: 'exit 3' });
assert.equal(nonzero.structured.exit_code, 3, JSON.stringify(nonzero.structured));
assert.equal(nonzero.structured.failure, undefined);
const timed = await bashToolResult(dir, { command: 'sleep 1', timeout: 0.01 });
assert.match(timed.structured.failure ?? '', /timed out/);

const listed = await bashTool(dir, { command: 'ls' });
assert.ok(listed.includes('a.txt'), listed);
const failed = await bashTool(dir, { command: 'exit 3' });
assert.ok(failed.includes('Command exited with code 3'), failed);

const out = await runCodemode({
  code: 'const r = await tools.read({ path: "a.txt" }); text(r); console.log("done"); return 1 + 1;',
  tools: [{ name: 'read', description: 'Read file contents' }],
  callTool: async (name, args) => readTool(dir, args),
  store: new Map(),
});
assert.ok(out.startsWith('Script completed'), out);
assert.ok(out.includes('HELLO\nworld\n'), out);
assert.ok(out.includes('==> text 2/2 <=='), out);
assert.ok(out.includes('<console_output>\ndone\n</console_output>'), out);
assert.ok(out.includes('\n2\n<console_output>'), out);

const failing = await runCodemode({
  code: 'await tools.read({ path: "missing" })',
  tools: [{ name: 'read', description: 'Read file contents' }],
  callTool: async (name, args) => readTool(dir, args),
  store: new Map(),
});
assert.ok(failing.startsWith('Script failed'), failing);
assert.ok(failing.includes('ENOENT'), failing);
// tool errors inside scripts reject with the tool's message
const structuredBash = await runCodemode({
  code: 'const r = await tools.bash({ command: "printf hello" }); return { type: typeof r, output: r.output, truncated: r.truncated, exit_code: r.exit_code, wall: typeof r.wall_time_seconds };',
  tools: [{ name: 'bash', description: 'Execute bash commands' }],
  callTool: async (_name, args) => (await bashToolResult(dir, args)).structured,
  store: new Map(),
});
assert.ok(structuredBash.startsWith('Script completed'), structuredBash);
assert.ok(structuredBash.includes('"type":"object"'), structuredBash);
assert.ok(structuredBash.includes('"output":"hello"'), structuredBash);
assert.ok(structuredBash.includes('"exit_code":0'), structuredBash);
assert.ok(structuredBash.includes('"wall":"number"'), structuredBash);

console.log('tools: ok');
