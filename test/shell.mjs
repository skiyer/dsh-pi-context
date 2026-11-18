import assert from 'node:assert/strict';
import { resolveBashShell } from '../src/pi-shell.js';

assert.deepEqual(
  resolveBashShell(undefined, { platform: 'linux', exists: (path) => path === '/bin/bash', find: () => undefined }),
  { shell: '/bin/bash', args: ['-c'], commandTransport: 'args' },
);

assert.deepEqual(
  resolveBashShell(undefined, {
    platform: 'win32',
    env: { ProgramFiles: 'C:\\Program Files' },
    exists: (path) => path === 'C:\\Program Files\\Git\\bin\\bash.exe',
    find: () => undefined,
  }),
  { shell: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['-c'], commandTransport: 'args' },
);

assert.deepEqual(
  resolveBashShell(undefined, {
    platform: 'win32',
    env: {},
    exists: () => false,
    find: () => 'C:\\Windows\\System32\\bash.exe',
  }),
  { shell: 'C:\\Windows\\System32\\bash.exe', args: ['-s'], commandTransport: 'stdin' },
);

assert.throws(() => resolveBashShell('/missing/bash', { exists: () => false }), /Custom bash shell path not found/);
assert.throws(() => resolveBashShell(undefined, {
  platform: 'win32', env: {}, exists: () => false, find: () => undefined,
}), /No bash shell found/);
console.log('shell: ok');
