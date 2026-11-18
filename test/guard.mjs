import assert from 'node:assert/strict';
import { apply } from '../src/pi-guard.js';

function capture(config) {
  let denied;
  const tools = {
    schemas: () => [
      { name: 'read' },
      { name: 'working_directory' },
      { name: 'team_task_create' },
      { name: 'mcp__ida__open_database' },
      { name: 'read_image' },
    ],
    restrict: (filter) => {
      denied = filter;
      return () => {};
    },
  };
  const scope = {
    effect: (callback) => callback(),
    tools,
  };
  apply({ inject: (_deps, callback) => callback(scope) }, config);
  return denied;
}

assert.deepEqual(capture({ allow: ['read', 'read_image'], keepMcp: true }), { deny: ['working_directory', 'team_task_create'] });
assert.deepEqual(capture({ allow: ['read'], keepMcp: false }), { deny: ['working_directory', 'team_task_create', 'mcp__ida__open_database', 'read_image'] });
assert.deepEqual(capture({ allow: ['read', 'read_image', 'mcp__ida__open_database'], keepMcp: true }), { deny: ['working_directory', 'team_task_create'] });
assert.equal(capture({ allow: ['read', 'read_image', 'mcp__ida__open_database', 'working_directory', 'team_task_create'], keepMcp: true }), undefined);
console.log('guard: ok');
