// Profile-wide Pi 模式 settings, shared by the Host facade and the
// Pi-config Conversation view. The view updates volatile Config fields through
// the Settings Remote; this file is the facade/compaction mirror.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_PI_SETTINGS = Object.freeze({
  disabledSkills: Object.freeze([]),
  disabledMcpServers: Object.freeze([]),
  compaction: Object.freeze({
    retainTokens: 20000,
    headroomTokens: 16384,
    thresholdRatio: 0.99,
    maxTokens: 16384,
  }),
});

export function piSettingsFile() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  // A shell that launched a different profile may export stale DSH_PROFILE*
  // values. The --profile argument is the authoritative profile for this
  // process; fall back to the environment only when the argument is absent.
  const argv = process.argv;
  const index = argv.indexOf('--profile');
  const argumentProfile = index >= 0 ? argv[index + 1] : undefined;
  if (argumentProfile) return join(home, 'profiles', argumentProfile, 'pi-mode.json');
  // Desktop's Electron host passes the profile directory as a positional
  // argument (…/profiles/desktop) instead of --profile.
  const argumentProfileDir = argv.find((arg) => /[\\/]profiles[\\/][^\\/]+$/.test(arg));
  if (argumentProfileDir) return join(argumentProfileDir, 'pi-mode.json');
  if (process.env.DSH_PROFILE_DIR) return join(process.env.DSH_PROFILE_DIR, 'pi-mode.json');
  const profile = process.env.DSH_PROFILE;
  return profile ? join(home, 'profiles', profile, 'pi-mode.json') : join(home, 'pi-mode.json');
}

function finiteNumber(value, fallback, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

/** Normalize one partial settings document, filling every missing field. */
export function normalizePiSettings(input = {}) {
  const compaction = input?.compaction ?? {};
  const strings = (value) => [...new Set((Array.isArray(value) ? value : [])
    .filter((entry) => typeof entry === 'string' && entry.length > 0))];
  return {
    disabledSkills: strings(input?.disabledSkills),
    disabledMcpServers: strings(input?.disabledMcpServers),
    compaction: {
      retainTokens: Math.round(finiteNumber(compaction.retainTokens, DEFAULT_PI_SETTINGS.compaction.retainTokens, 0, 10_000_000)),
      headroomTokens: Math.round(finiteNumber(compaction.headroomTokens, DEFAULT_PI_SETTINGS.compaction.headroomTokens, 0, 10_000_000)),
      thresholdRatio: finiteNumber(compaction.thresholdRatio, DEFAULT_PI_SETTINGS.compaction.thresholdRatio, 0.01, 1),
      maxTokens: Math.round(finiteNumber(compaction.maxTokens, DEFAULT_PI_SETTINGS.compaction.maxTokens, 1, 10_000_000)),
    },
  };
}

/** Read the profile-wide settings. A missing or malformed file uses defaults. */
export function readPiSettings(file = piSettingsFile()) {
  try {
    return normalizePiSettings(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return normalizePiSettings(DEFAULT_PI_SETTINGS);
  }
}

/** Atomically persist settings; the caller owns validation and authorization. */
export function writePiSettings(input, file = piSettingsFile()) {
  const settings = normalizePiSettings(input);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
  return settings;
}
