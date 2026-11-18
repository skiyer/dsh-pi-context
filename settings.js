// Volatile Pi settings entry. The Settings service exposes these fields to the
// Client, while apply mirrors them to pi-mode.json for the facade and compaction.
import z from '@deepseek-ai/schemastery';
import { writePiSettings } from './src/pi-mode-settings.js';
import { loadPiMcpConfig } from './src/pi-mcp-config.js';

export const name = 'pi-settings';

function availableMcpServers() {
  try {
    return Object.entries(loadPiMcpConfig().exposures).map(([name, entry]) => ({
      name,
      description: typeof entry?.description === 'string' ? entry.description : '',
    }));
  } catch {
    return [];
  }
}

export const Config = z.object({
  disabledSkills: z.array(z.string()).default([]).volatile(),
  disabledMcpServers: z.array(z.string()).default([]).volatile(),
  availableMcpServers: z.array(z.object({ name: z.string(), description: z.string() })).default(availableMcpServers()).volatile(),
  retainTokens: z.natural().default(20000).volatile(),
  headroomTokens: z.natural().default(16384).volatile(),
  thresholdRatio: z.number().min(0.01).max(1).default(0.99).volatile(),
  maxTokens: z.natural().default(16384).volatile(),
});

export function apply(ctx, config) {
  const sync = () => writePiSettings({
    disabledSkills: config.disabledSkills.get(),
    disabledMcpServers: config.disabledMcpServers.get(),
    compaction: {
      retainTokens: config.retainTokens.get(),
      headroomTokens: config.headroomTokens.get(),
      thresholdRatio: config.thresholdRatio.get(),
      maxTokens: config.maxTokens.get(),
    },
  });
  sync();
  ctx.on('loader/volatile-update', sync);
}
