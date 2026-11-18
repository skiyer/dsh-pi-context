import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  formatMcpServers,
  MAX_MCP_SERVERS_SECTION_CHARS,
  transformRequestBody,
} from '../src/pi-context.js';

function load(path) {
  const raw = readFileSync(new URL(path, import.meta.url), 'utf8');
  const body = raw.slice(raw.indexOf('\n\n') + 2);
  return JSON.parse(body);
}

const pi = load('./fixtures/pi-002-v1_chat_completions.http');
const dsh = load('./fixtures/pi-003-v1_chat_completions.http');

const fakeMcpTool = {
  type: 'function',
  function: { name: 'mcp__stub__echo', description: 'Echo text back.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } },
};
const input = {
  ...dsh,
  messages: [
    { role: 'developer', content: dsh.messages[0].content },
    { role: 'user', content: 'Reply with exactly: hi' },
  ],
  tools: [...pi.tools, fakeMcpTool, { type: 'function', function: { name: 'todo_write', description: 'x', parameters: { type: 'object', properties: {} } } }],
};

const cwd = '/tmp/pi-compat-capture';
const result = transformRequestBody(input, { cwd, codemode: true, mcpServers: { stub: { exposure: 'codemode', description: 'Stub server for capture tests.' } }, loadedToolNames: new Set() });
assert.ok(result, 'transform returns a body');
const out = result.body;

const toolShape = (tools) => tools.map((tool) => ({
  name: tool.function.name,
  parameters: tool.function.parameters,
}));
assert.deepEqual(toolShape(out.tools), toolShape(pi.tools), 'tool names and schemas match vanilla pi');
for (const tool of out.tools) {
  assert.doesNotMatch(tool.function.description, /\.pi\/(?:agent|install)/, `${tool.function.name} has no pi install path`);
  if (tool.function.name !== 'codemode') {
    assert.doesNotMatch(tool.function.description, /\/Users\//, `${tool.function.name} has no deployment path`);
  }
}
const codemodeTool = out.tools.find((tool) => tool.function.name === 'codemode');
assert.match(codemodeTool.function.description, /not bridged in this deployment/);
assert.match(codemodeTool.function.description, /docs\/pi\/codemode\.md/);
assert.equal(out.messages[0].role, 'developer');
assert.deepEqual(out.messages[1], pi.messages[1], 'user content uses pi block form');
for (const key of ['model', 'stream', 'stream_options', 'store', 'max_completion_tokens', 'reasoning_effort']) {
  assert.deepEqual(out[key], pi[key], `request field ${key} matches`);
}
assert.equal(out.messages.length, 2, 'only the instruction and the user message remain');

const prompt = out.messages[0].content;
const section = (name, source = prompt) => {
  const match = new RegExp(`<${name}>\\n([\\s\\S]*?)\\n</${name}>`).exec(source);
  return match ? match[1] : undefined;
};
for (const name of ['tools', 'mcp_servers']) {
  const expected = section(name, pi.messages[0].content);
  assert.ok(expected !== undefined, `pi captured a ${name} section`);
  assert.equal(section(name), expected, `${name} section matches pi`);
}
assert.equal(section('cwd'), cwd, 'cwd section uses the requested workspace');
const docs = section('docs');
assert.ok(docs.includes('codemode.md'), docs);
assert.match(docs, /vendored from pi 1\.5\.0/);

assert.match(prompt, /^You are an AI agent powered by DeepSeek Harness in Pi mode\. Help users inspect files, run commands, and modify code\./, 'identity is DeepSeek Harness Pi mode');
assert.doesNotMatch(prompt, /PI_/, 'the PI_* environment rule is removed');
const rules = section('rules');
assert.ok(rules.includes('Use bash for file operations like ls, rg, find'));
assert.ok(rules.includes('Use read to examine files instead of cat or sed.'));
assert.ok(!rules.includes('PI_'));

// Preset mounts install no pi prompt section: cwd comes from DSH's runtime
// reminder, which the transform reads and then drops.
const presets = transformRequestBody({
  ...input,
  messages: [
    { role: 'developer', content: 'You are a helpful software engineer assistant.' },
    { role: 'user', content: 'Reply with exactly: hi' },
    { role: 'user', content: '<system-reminder>\nThe following information describes your current session:\n\nCurrent working directory: "/tmp/preset-cwd".\n\nApproval prompts are disabled.</system-reminder>' },
  ],
}, { codemode: true, mcpServers: { stub: { exposure: 'codemode', description: 'Stub server for capture tests.' } }, loadedToolNames: new Set() });
assert.ok(presets, 'preset transform returns a body');
assert.equal(presets.body.messages.length, 2, 'the runtime reminder is dropped');
assert.equal(/(^|\n)\/tmp\/preset-cwd(\n|$)/.test(presets.body.messages[0].content), true, 'cwd read from the runtime reminder');

const marked = transformRequestBody({
  ...input,
  messages: [
    { role: 'developer', content: 'You are an AI agent powered by DeepSeek Harness in Pi mode. Help users inspect files, run commands, and modify code.\n<pi-cwd>/tmp/marked-cwd</pi-cwd>' },
    { role: 'user', content: 'Reply with exactly: hi' },
  ],
}, { codemode: true, mcpServers: {}, loadedToolNames: new Set() });
assert.ok(marked, 'marked transform returns a body');
assert.equal(/(^|\n)\/tmp\/marked-cwd(\n|$)/.test(marked.body.messages[0].content), true, 'cwd read from the pi-cwd marker');

const skillPayload = Buffer.from(JSON.stringify([{ name: 'demo', description: 'A & B', path: '/skills/demo/SKILL.md' }])).toString('base64url');
const skilled = transformRequestBody({
  ...input,
  messages: [
    { role: 'developer', content: `You are an AI agent powered by DeepSeek Harness in Pi mode.\n<pi-skills>${skillPayload}</pi-skills>` },
    { role: 'user', content: 'Reply with exactly: hi' },
  ],
}, { codemode: true, mcpServers: {}, loadedToolNames: new Set() });
assert.ok(skilled, 'skills transform returns a body');
assert.match(skilled.body.messages[0].content, /<skills>\n/);
assert.match(skilled.body.messages[0].content, /<name>demo<\/name>/);
assert.match(skilled.body.messages[0].content, /<description>A &amp; B<\/description>/);
assert.match(skilled.body.messages[0].content, /<location>\/skills\/demo\/SKILL\.md<\/location>/);
assert.doesNotMatch(skilled.body.messages[0].content, /pi-skills/);

// Per-tool exposure overrides, including direct, deferred and hidden tools.
{
  const direct = { type: 'function', function: { name: 'mcp__stub__direct', description: 'Direct', parameters: { type: 'object' } } };
  const deferred = { type: 'function', function: { name: 'mcp__stub__deferred', description: 'Deferred', parameters: { type: 'object' } } };
  const hidden = { type: 'function', function: { name: 'mcp__stub__hidden', description: 'Hidden', parameters: { type: 'object' } } };
  const perTool = transformRequestBody({
    ...input,
    tools: [...pi.tools, direct, deferred, hidden],
  }, {
    cwd,
    codemode: true,
    mcpServers: {
      stub: {
        exposure: 'codemode',
        description: 'Stub server',
        toolExposure: { direct: 'direct', deferred: 'deferred', hidden: 'hidden' },
      },
    },
    loadedToolNames: new Set(),
  });
  const names = perTool.body.tools.map((tool) => tool.function.name);
  assert.ok(names.includes('mcp__stub__direct'));
  assert.ok(names.includes('tool_search'));
  assert.ok(!names.includes('mcp__stub__deferred'));
  assert.ok(!names.includes('mcp__stub__hidden'));
  assert.match(perTool.body.messages[0].content, /- mcp__stub \(tool_search\): Stub server/);

  const loaded = transformRequestBody({
    ...input,
    tools: [...pi.tools, direct, deferred, hidden],
  }, {
    cwd,
    codemode: true,
    mcpServers: {
      stub: {
        exposure: 'codemode',
        toolExposure: { direct: 'direct', deferred: 'deferred', hidden: 'hidden' },
      },
    },
    loadedToolNames: new Set(['mcp__stub__deferred']),
  });
  assert.ok(loaded.body.tools.some((tool) => tool.function.name === 'mcp__stub__deferred'));
}

// Section formatting: first line, normalized server names, caps, and hidden servers.
{
  const section = formatMcpServers([
    { name: 'demo-server', exposure: 'codemode', description: 'First line\nSecond line', tools: ['a'] },
    { name: 'all-direct', exposure: 'direct', description: 'not listed', tools: ['x'] },
    { name: 'all-hidden', exposure: 'hidden', description: 'not listed', tools: ['x'] },
  ]);
  assert.match(section, /- mcp__demo_server \(codemode\): First line/);
  assert.ok(!section.includes('Second line'));
  assert.ok(!section.includes('all_direct'));
  assert.ok(!section.includes('all_hidden'));

  const many = Array.from({ length: 300 }, (_, index) => ({
    name: `server-${index}`,
    exposure: 'codemode',
    description: 'x'.repeat(300),
  }));
  const capped = formatMcpServers(many);
  assert.ok(capped.length <= MAX_MCP_SERVERS_SECTION_CHARS, `${capped.length} > ${MAX_MCP_SERVERS_SECTION_CHARS}`);
  assert.match(capped, /more server/);
}

console.log('parity: ok', {
  tools: out.tools.length,
  promptChars: prompt.length,
  mcp: result.summary.mcpServers,
});
