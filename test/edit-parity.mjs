// End-to-end comparison of pi-context's edit with vanilla pi 1.5.0's edit tool.
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { editTool } from '../src/pi-tools-runtime.js';

const PI_EDIT = `${homedir()}/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/edit.js`;

async function runPi(cwd, args) {
  const { createEditToolDefinition } = await import(pathToFileURL(PI_EDIT).href);
  const definition = createEditToolDefinition(cwd);
  const result = await definition.execute(null, args, undefined, undefined, { cwd });
  return result.content.map((block) => block.text ?? '').join('');
}

async function runOurs(cwd, args) {
  return editTool(cwd, args);
}

async function caseRun(name, content, args, options = {}) {
  const a = await mkdtemp(join(tmpdir(), 'pi-edit-a-'));
  const b = await mkdtemp(join(tmpdir(), 'pi-edit-b-'));
  try {
    await writeFile(join(a, 'x.txt'), content);
    await writeFile(join(b, 'x.txt'), content);
    let piOut;
    let ourOut;
    let piError;
    let ourError;
    try {
      piOut = await runPi(a, { path: 'x.txt', ...args });
    } catch (error) {
      piError = error instanceof Error ? error.message : String(error);
    }
    try {
      ourOut = await runOurs(b, { path: 'x.txt', ...args });
    } catch (error) {
      ourError = error instanceof Error ? error.message : String(error);
    }
    assert.equal(ourError, piError, `${name}: error mismatch`);
    assert.equal(ourOut, piOut, `${name}: result mismatch`);
    if (options.compareContent !== false && piError === undefined) {
      const piBytes = await readFile(join(a, 'x.txt'));
      const ourBytes = await readFile(join(b, 'x.txt'));
      assert.deepEqual(ourBytes, piBytes, `${name}: file bytes differ`);
    }
  } finally {
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  }
}

const cases = [
  ['exact single', 'alpha beta\n', { edits: [{ oldText: 'beta', newText: 'BETA' }] }],
  ['exact multi', 'one\ntwo\nthree\n', { edits: [{ oldText: 'one', newText: '1' }, { oldText: 'three', newText: '3' }] }],
  ['fuzzy trailing whitespace', 'alpha   \nbeta\n', { edits: [{ oldText: 'alpha\n', newText: 'ALPHA\n' }] }],
  ['fuzzy smart quotes', '\u201Chello\u201D\nkeep  \n', { edits: [{ oldText: 'hello', newText: 'bye' }] }],
  ['fuzzy special spaces', 'a\u00A0b\nkeep\u3000 \n', { edits: [{ oldText: 'a b', newText: 'a-b' }] }],
  ['fuzzy fullwidth untouched', '\uFF21\uFF22\uFF23  \n\uFF24\uFF25\n', { edits: [{ oldText: '\uFF21\uFF22\uFF23', newText: 'abc' }] }],
  ['bom and crlf', '\uFEFFalpha\r\nbeta\r\n', { edits: [{ oldText: 'alpha\nbeta', newText: 'ALPHA\nBETA' }] }],
  ['mixed fuzzy and exact', 'alpha   \nbeta\n', { edits: [{ oldText: 'alpha\n', newText: 'A\n' }, { oldText: 'beta', newText: 'B' }] }],
  ['line boundary replacement', 'one\ntwo\nthree\n', { edits: [{ oldText: 'one\ntwo', newText: 'ONE\nTWO' }] }],
  ['duplicate', 'dup\ndup\n', { edits: [{ oldText: 'dup', newText: 'x' }] }],
  ['not found', 'abc\n', { edits: [{ oldText: 'zzz', newText: 'x' }] }],
  ['overlap', 'abcdef\n', { edits: [{ oldText: 'abc', newText: 'x' }, { oldText: 'bcd', newText: 'y' }] }],
  ['empty oldText', 'abc\n', { edits: [{ oldText: '', newText: 'x' }] }],
  ['no change', 'abc\n', { edits: [{ oldText: 'abc', newText: 'abc' }] }],
  ['empty edits', 'abc\n', { edits: [] }],
  ['crlf fuzzy', 'alpha   \r\nbeta\r\n', { edits: [{ oldText: 'alpha\n', newText: 'A\n' }] }],
  ['bom fuzzy', '\uFEFF\u201Chello\u201D  \nkeep\n', { edits: [{ oldText: 'hello', newText: 'bye' }] }],
  ['lone cr', 'alpha\rbeta\r', { edits: [{ oldText: 'beta', newText: 'B' }] }],
  ['no trailing newline', 'alpha\nbeta', { edits: [{ oldText: 'beta', newText: 'B' }] }],
  ['multi fuzzy same line', '\u201Ca\u201D b \u201Cc\u201D\nkeep  \n', { edits: [{ oldText: 'a', newText: 'A' }, { oldText: 'c', newText: 'C' }] }],
  ['fuzzy adjacent lines merge', '\u201Ca\u201D  \n\u201Cb\u201D  \nkeep  \n', { edits: [{ oldText: 'a\nb', newText: 'A\nB' }] }],
  ['empty file', '', { edits: [{ oldText: 'a', newText: 'b' }] }],
];

for (const [name, content, args] of cases) {
  await caseRun(name, content, args);
  console.log(`ok ${name}`);
}

// Missing file error.
await caseRun('missing file', '', { edits: [{ oldText: 'a', newText: 'b' }] }, { compareContent: false });

// Read-only file: both tools gate on R_OK|W_OK through access().
{
  const a = await mkdtemp(join(tmpdir(), 'pi-edit-ro-a-'));
  const b = await mkdtemp(join(tmpdir(), 'pi-edit-ro-b-'));
  try {
    await writeFile(join(a, 'x.txt'), 'abc\n');
    await writeFile(join(b, 'x.txt'), 'abc\n');
    await chmod(join(a, 'x.txt'), 0o444);
    await chmod(join(b, 'x.txt'), 0o444);
    let piError;
    let ourError;
    try { await runPi(a, { path: 'x.txt', edits: [{ oldText: 'a', newText: 'b' }] }); } catch (error) { piError = error.message; }
    try { await runOurs(b, { path: 'x.txt', edits: [{ oldText: 'a', newText: 'b' }] }); } catch (error) { ourError = error.message; }
    assert.equal(ourError, piError, 'read-only error mismatch');
    assert.ok(piError, 'read-only file should fail');
    console.log('ok read-only');
  } finally {
    await chmod(join(a, 'x.txt'), 0o644).catch(() => {});
    await chmod(join(b, 'x.txt'), 0o644).catch(() => {});
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  }
}

console.log('edit parity: ok');
