import assert from 'node:assert/strict';
import { buildSystemPrompt, transformRequestBody } from '../src/pi-context.js';

const tools = [
  { type: 'function', function: { name: 'codemode', parameters: { type: 'object' } } },
  { type: 'function', function: { name: 'read', parameters: { type: 'object' } } },
  { type: 'function', function: { name: 'bash', parameters: { type: 'object' } } },
];
const reminder = [
  '<system-reminder>',
  'The following workspace instructions may be relevant to your work.',
  'Instructions from: AGENTS.md',
  '',
  '# Test instructions',
  'Use the test convention.',
  '</system-reminder>',
].join('\n');
const result = transformRequestBody({
  messages: [
    { role: 'system', content: 'placeholder' },
    { role: 'user', content: [{ type: 'text', text: reminder }] },
  ],
  tools,
}, { cwd: '/tmp' });
assert.ok(result);
const developer = result.body.messages.find((message) => message.role === 'developer');
assert.ok(developer.content.includes('<project_context>'));
assert.ok(developer.content.includes('<project_instructions path="/tmp/AGENTS.md">'));
assert.ok(developer.content.includes('Use the test convention.'));
assert.equal(result.body.messages.some((message) => message.content?.[0]?.text?.includes?.('<system-reminder>')), false);
const prompt = buildSystemPrompt({
  cwd: '/tmp',
  tools: ['read', 'bash', 'codemode'],
  projectContext: [{ path: '/tmp/AGENTS.md', content: '# Test instructions\nUse the test convention.' }],
});
assert.ok(prompt.includes(`<project_context>\nProject-specific instructions and guidelines:\n<project_instructions path="/tmp/AGENTS.md">`));
console.log('agents-md: ok');
