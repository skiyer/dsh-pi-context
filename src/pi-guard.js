// Restrict the pi agent to its own tool namespace without patching global rows.
// Runs at the preset scope: the allowlist keeps the pi tools and the tools the
// context facade needs internally, and denies every other inherited tool.
export const DEFAULT_ALLOW = [
  'read',
  'bash',
  'edit',
  'write',
  'codemode',
  'tool_search',
];

export function apply(ctx, rawConfig) {
  const config = rawConfig ?? {};
  const allow = new Set(Array.isArray(config.allow) ? config.allow : DEFAULT_ALLOW);
  const keepMcp = config.keepMcp !== false;
  ctx.inject(['tools'], (scope) => {
    scope.effect(() => {
      const names = scope.tools.schemas().map((tool) => tool.name);
      const deny = names.filter((name) => !allow.has(name) && !(keepMcp && name.startsWith('mcp__')));
      if (deny.length === 0) return undefined;
      return scope.tools.restrict({ deny });
    });
  });
}

export default apply;
