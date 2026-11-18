import assert from 'node:assert/strict';
import { compactionBaseCandidates } from '../src/pi-compaction-paths.js';

const npx = compactionBaseCandidates({
  installDir: undefined,
  resourcesPath: undefined,
  argv1: '/tmp/npm/_npx/abc/node_modules/@deepseek-ai/dsh/lib/bin.js',
});
assert.ok(npx.includes('/tmp/npm/_npx/abc/node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js'), npx.join('\n'));

const electron = compactionBaseCandidates({
  installDir: '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh',
  resourcesPath: undefined,
  argv1: undefined,
});
assert.ok(electron.includes('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh-compaction-basic/lib/index.js'));
console.log('compaction paths: ok');
