import assert from 'node:assert/strict';

let captured;
const ctx = {
  on() {},
  waterfall() { return false; },
  get() { return undefined; },
  logger: { warn() {}, info() {} },
  llm: {
    async *stream(options) {
      captured = options;
      yield { type: 'block-end', block: { type: 'text', text: '## Goal\nShip the plugin\n\n## Progress\n### Done\n- [x] tools' } };
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  },
};
const { default: PiCompactionEngine } = await import('../compaction.js');
const engine = Object.create(PiCompactionEngine.prototype);
engine.ctx = ctx;
engine.config = { summarizationProvider: '', summarizationModel: '', maxTokens: 16384 };
const agent = {
  options: {},
  session: {
    id: 'session-test',
    requestHeader: () => ({ config: { provider: 'magpie', model: 'auto/gpt-6.1-sol' } }),
    toolHistory: () => ({ tools: [], updates: [] }),
  },
};
const result = await engine.summarize({
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'please fix the bug' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'looking' }, { type: 'tool-call', id: '1', name: 'bash', arguments: '{"command":"ls"}' }] },
    { role: 'tool', content: [{ type: 'text', text: 'a.txt\nb.txt' }], toolCallId: '1' },
  ],
  tools: [],
}, agent, undefined);
assert.ok(captured, 'summarize called the llm');
assert.equal(captured.provider, 'magpie');
assert.equal(captured.model, 'auto/gpt-6.1-sol');
assert.equal(captured.purpose, 'compaction');
assert.equal(captured.maxTokens, 16384);
const text = captured.messages[0].content[0].text;
assert.ok(text.includes('[User]: please fix the bug'), text);
assert.ok(text.includes('[Assistant]: looking'), text);
assert.ok(text.includes('[Assistant tool calls]: bash({"command":"ls"})'), text);
assert.ok(text.includes('[Tool result]: a.txt\nb.txt'), text);
assert.ok(text.includes('## Critical Context'), 'pi checkpoint format');
assert.ok(text.includes('## Goal'), 'pi checkpoint format');
assert.equal(result.summary[0].text.startsWith('## Goal'), true);
assert.equal(result.llmStreamCall, true);
assert.equal(result.provider, 'magpie');
console.log('compaction: ok');
