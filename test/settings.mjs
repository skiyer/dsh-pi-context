import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPiSettings, writePiSettings } from '../src/pi-mode-settings.js';

const file = join(await mkdtemp(join(tmpdir(), 'pi-settings-test-')), 'pi-mode.json');
assert.equal(readPiSettings(file).compaction.retainTokens, 20000);

assert.deepEqual(readPiSettings(file).disabledSkills, []);
assert.deepEqual(readPiSettings(file).disabledMcpServers, []);

const saved = writePiSettings({
  disabledSkills: ['review', 'review', 'deploy'],
  disabledMcpServers: ['stub', 'stub', 'files'],
  compaction: { retainTokens: 12000, headroomTokens: 8000, thresholdRatio: 0.9, maxTokens: 10000 },
}, file);
const current = readPiSettings(file);
assert.deepEqual(current.disabledSkills, ['review', 'deploy']);
assert.deepEqual(current.disabledMcpServers, ['stub', 'files']);
assert.deepEqual(saved.compaction, {
  retainTokens: 12000,
  headroomTokens: 8000,
  thresholdRatio: 0.9,
  maxTokens: 10000,
});

const normalized = writePiSettings({ disabledSkills: [] }, file);
assert.deepEqual(normalized.disabledSkills, []);
console.log('settings: ok');
