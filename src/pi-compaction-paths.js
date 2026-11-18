// Locate the DSH compaction base class across Electron, CLI and npx installs.
import { dirname, join, resolve } from 'node:path';

/** Candidate filesystem paths for the running DSH's compaction-basic package. */
export function compactionBaseCandidates(options = {}) {
  const installDir = options.installDir ?? process.env.DSH_INSTALL_DIR;
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const argv1 = options.argv1 ?? process.argv[1];
  const candidates = [];
  if (installDir) {
    const anchor = resolve(installDir);
    candidates.push(resolve(anchor, '..', 'dsh-compaction-basic', 'lib', 'index.js'));
    candidates.push(join(anchor, 'node_modules', '@deepseek-ai', 'dsh-compaction-basic', 'lib', 'index.js'));
    candidates.push(join(anchor, '..', 'node_modules', '@deepseek-ai', 'dsh-compaction-basic', 'lib', 'index.js'));
  }
  if (resourcesPath) {
    candidates.push(join(resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-compaction-basic', 'lib', 'index.js'));
  }
  if (argv1) {
    let current = dirname(resolve(argv1));
    // npx/global/pnpm installs all put the DSH bin below a node_modules tree.
    // Walk upward and try both the scoped sibling and a nested node_modules
    // location; this also covers pnpm's virtual-store layout.
    for (let depth = 0; depth < 8; depth += 1) {
      candidates.push(join(current, 'dsh-compaction-basic', 'lib', 'index.js'));
      candidates.push(join(current, 'node_modules', '@deepseek-ai', 'dsh-compaction-basic', 'lib', 'index.js'));
      candidates.push(join(current, '..', 'dsh-compaction-basic', 'lib', 'index.js'));
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return [...new Set(candidates)];
}
