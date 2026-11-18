// pi 1.5.0 compaction: a backend for DSH's compaction seam that summarizes
// with pi's structured checkpoint prompt.
//
// The span selection, trigger pricing and the durable checkpoint bracket stay
// with dsh-compaction-basic; only the summarization call is pi's.

import { readPiSettings } from './pi-mode-settings.js';

const PI_COMPACTION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_PROMPT = `Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

/** Apply profile-wide Pi compaction settings to one engine instance. */
function applyPiCompactionSettings(engine) {
  const next = readPiSettings().compaction;
  if (engine === null || typeof engine !== 'object' || engine.config === null || typeof engine.config !== 'object') return;
  if (engine.config.retainTokens === next.retainTokens
    && engine.config.headroomTokens === next.headroomTokens
    && engine.config.thresholdRatio === next.thresholdRatio
    && engine.config.maxTokens === next.maxTokens) return;
  try {
    engine.config = { ...engine.config, ...next };
  } catch {
    // A frozen config means the installation cannot live-tune; preserve the
    // composed values rather than breaking compaction.
  }
}

const TOOL_RESULT_LIMIT = 2000;

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function truncate(text, limit) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[${text.length - limit} characters truncated]`;
}

/** pi's serializeConversation(), over DSH request messages. */
export function serializeConversation(messages) {
  const parts = [];
  for (const message of messages ?? []) {
    if (message.role === 'user') {
      parts.push(`[User]: ${contentText(message.content)}`);
      continue;
    }
    if (message.role === 'assistant') {
      const text = contentText(message.content);
      const calls = (message.content ?? []).filter((block) => block && block.type === 'tool-call');
      if (text.length > 0) parts.push(`[Assistant]: ${text}`);
      if (calls.length > 0) {
        parts.push(`[Assistant tool calls]: ${calls.map((call) => `${call.name}(${call.arguments})`).join('; ')}`);
      }
      continue;
    }
    if (message.role === 'tool') {
      parts.push(`[Tool result]: ${truncate(contentText(message.content), TOOL_RESULT_LIMIT)}`);
    }
  }
  return parts.join('\n\n');
}

function previousSummaryText(messages) {
  for (const message of messages ?? []) {
    if (message.role !== 'user') continue;
    const text = contentText(message.content);
    const match = /<summary>([\s\S]*?)<\/summary>/.exec(text);
    if (match) return match[1];
  }
  return undefined;
}

function collect(stream) {
  const blocks = [];
  let usage;
  let finish;
  return (async () => {
    for await (const chunk of stream) {
      if (chunk.type === 'block-end' && chunk.block?.type === 'text') blocks.push(chunk.block);
      else if (chunk.type === 'usage') usage = chunk.usage;
      else if (chunk.type === 'finish') finish = chunk.reason;
    }
    return { blocks, usage, finish };
  })();
}

/** Find the base class from the running DSH installation. */
async function loadBase() {
  const { existsSync } = await import('node:fs');
  const { join, resolve } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const candidates = [];
  const anchor = process.env.DSH_INSTALL_DIR;
  if (anchor) {
    // .../node_modules/@deepseek-ai/dsh -> sibling package
    candidates.push(resolve(anchor, '..', 'dsh-compaction-basic', 'lib', 'index.js'));
    candidates.push(join(anchor, 'node_modules', '@deepseek-ai', 'dsh-compaction-basic', 'lib', 'index.js'));
    candidates.push(join(anchor, '..', 'node_modules', '@deepseek-ai', 'dsh-compaction-basic', 'lib', 'index.js'));
  }
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-compaction-basic', 'lib', 'index.js'));
  }
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const module = await import(pathToFileURL(candidate).href);
    return module.BasicCompactionEngine ?? module.default;
  }
  throw new Error(`Cannot locate @deepseek-ai/dsh-compaction-basic (tried: ${candidates.join(', ')})`);
}

const Base = await loadBase();

/** pi's summarize(), bound to one compaction backend instance. */
export async function piSummarize(input, agent, signal) {
  const config = this.config ?? {};
  const latest = agent.session.requestHeader()?.config;
  const configured = config.summarizationProvider
    ? { provider: config.summarizationProvider, model: config.summarizationModel }
    : undefined;
  const agentTarget = agent.options.provider && agent.options.model
    ? { provider: agent.options.provider, model: agent.options.model }
    : undefined;
  const target = configured ?? latest ?? agentTarget;
  if (target === undefined) {
    throw new Error('no provider/model available for summarization: set both summarization fields, route one request, or set both AgentOptions fields');
  }

  const previous = previousSummaryText(input.messages);
  const conversation = serializeConversation(input.messages);
  const instruction = previous === undefined
    ? PI_COMPACTION_PROMPT
    : `${UPDATE_PROMPT}\n\n<previous-summary>\n${previous}\n</previous-summary>`;
  const text = `${conversation}\n\n${instruction}`;

  const options = {
    provider: target.provider,
    model: target.model,
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
    maxTokens: config.maxTokens,
    sessionId: agent.session.id,
    purpose: 'compaction',
    ...(signal === undefined ? {} : { signal }),
  };
  const { blocks, usage, finish } = await collect(this.ctx.llm.stream(options));
  if (finish?.kind === 'error' || finish?.kind === 'aborted') {
    throw new Error(finish.failure?.message ?? 'summarization failed');
  }
  if (finish?.kind === 'max-tokens') {
    throw new Error('summarization truncated at the token cap (incomplete checkpoint)');
  }
  if (!blocks.some((block) => block.text.trim().length > 0)) {
    throw new Error('summarization produced no text summary content');
  }
  return {
    summary: blocks,
    rawOutput: blocks,
    llmStreamCall: true,
    provider: options.provider,
    model: options.model,
    maxTokens: options.maxTokens,
    ...(usage === undefined ? {} : { usage }),
  };
}

const PATCH = Symbol.for('@local/dsh-pi-compat/compaction-patch');

/**
 * Route every compaction backend instance through pi's summarizer.
 *
 * Presets mount their own compaction backend inside an isolated group, so a
 * separate service registration cannot reach them; patching the shipped base
 * class' single documented customization hook covers root and preset agents.
 */
export async function applyCompactionPatch() {
  if (Base.prototype[PATCH]) return () => {};
  for (const method of ['compactIfNeeded', 'compactNow']) {
    const key = `${PATCH}:${method}`;
    const originalMethod = Base.prototype[method];
    if (typeof originalMethod !== 'function' || originalMethod[key]) continue;
    const wrapped = function patchedCompaction(...args) {
      applyPiCompactionSettings(this);
      return originalMethod.apply(this, args);
    };
    wrapped[key] = true;
    Base.prototype[method] = wrapped;
  }
  const original = Base.prototype.summarize;
  const patched = function summarizeWithPi(input, agent, signal) {
    return piSummarize.call(this, input, agent, signal);
  };
  Base.prototype[PATCH] = original;
  Base.prototype.summarize = patched;
  return () => {
    if (Base.prototype.summarize !== patched) return;
    Base.prototype.summarize = original;
    delete Base.prototype[PATCH];
  };
}

/** Optional standalone service, for compositions that prefer registration over the patch. */
export class PiCompactionEngine extends Base {
  static inject = Base.inject;

  static Config = Base.Config;

  compactIfNeeded(input, trigger, signal) {
    applyPiCompactionSettings(this);
    return super.compactIfNeeded(input, trigger, signal);
  }

  compactNow(agent, signal, sourceCommandId) {
    applyPiCompactionSettings(this);
    return super.compactNow(agent, signal, sourceCommandId);
  }

  summarize(input, agent, signal) {
    return piSummarize.call(this, input, agent, signal);
  }
}

export default PiCompactionEngine;
