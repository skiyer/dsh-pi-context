// Shell resolution matching vanilla pi 1.5.0 on Unix and Windows.
import { accessSync, constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { win32 } from 'node:path';

function pathExists(path) {
  try {
    accessSync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function onPath(executable, platform) {
  try {
    const result = platform === 'win32'
      ? spawnSync('where', [executable], { encoding: 'utf8', timeout: 5000, windowsHide: true })
      : spawnSync('which', [executable], { encoding: 'utf8', timeout: 5000 });
    if (result.status !== 0 || !result.stdout) return undefined;
    const first = result.stdout.trim().split(/\r?\n/)[0];
    return first && pathExists(first) ? first : undefined;
  } catch {
    return undefined;
  }
}

function legacyWslBash(path) {
  const normalized = win32.normalize(path).toLowerCase();
  const systemRoot = process.env.SystemRoot;
  if (systemRoot && /^[a-z]:[\\/]/i.test(systemRoot)) {
    return ['System32', 'Sysnative'].some((directory) => (
      normalized === win32.join(systemRoot, directory, 'bash.exe').toLowerCase()
    ));
  }
  return /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/.test(normalized);
}

function configFor(shell) {
  return legacyWslBash(shell)
    ? { shell, args: ['-s'], commandTransport: 'stdin' }
    : { shell, args: ['-c'], commandTransport: 'args' };
}

/**
 * Resolve a bash-compatible shell. Explicit shellPath wins, then on Windows
 * Git for Windows, then bash.exe on PATH; Unix tries /bin/bash, PATH bash, sh.
 */
export function resolveBashShell(customShellPath, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.exists ?? pathExists;
  const find = options.find ?? ((name) => onPath(name, platform));
  if (customShellPath) {
    if (exists(customShellPath)) return configFor(customShellPath);
    throw new Error(`Custom bash shell path not found: ${customShellPath}`);
  }
  if (platform === 'win32') {
    const candidates = [];
    if (env.ProgramFiles) candidates.push(`${env.ProgramFiles}\\Git\\bin\\bash.exe`);
    if (env['ProgramFiles(x86)']) candidates.push(`${env['ProgramFiles(x86)']}\\Git\\bin\\bash.exe`);
    for (const candidate of candidates) {
      if (exists(candidate)) return configFor(candidate);
    }
    const bashOnPath = find('bash.exe');
    if (bashOnPath) return configFor(bashOnPath);
    throw new Error([
      'No bash shell found. Options:',
      '  1. Install Git for Windows: https://git-scm.com/download/win',
      '  2. Add your bash to PATH (Cygwin, MSYS2, WSL, etc.)',
      '  3. Set shellPath in the Pi preset configuration or PI_BASH_PATH',
      '',
      'Searched Git Bash in:',
      ...candidates.map((candidate) => `  ${candidate}`),
    ].join('\n'));
  }
  if (exists('/bin/bash')) return configFor('/bin/bash');
  const bashOnPath = find('bash');
  if (bashOnPath) return configFor(bashOnPath);
  return { shell: 'sh', args: ['-c'], commandTransport: 'args' };
}

export function shellEnvironment() {
  return { ...process.env };
}
