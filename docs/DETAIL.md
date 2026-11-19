# Design and limits

## What this bundle changes

The bundle inserts one row, `preset-pi` (`@deepseek-ai/dsh-agent-preset`, id `pi`), whose plugin list is:

- `persona` — a complete one-line pi identity with runtime context left on, so the session still records its working directory (the request rewrite reads it, then drops the reminder turns).
- `pi-context` with `mount: preset` — registers pi's tools on the preset scope, the direct parent of every agent that selects the mode. The tools shadow DSH's `read`/`bash`/`edit`/`write` for those agents only.
- `skill-filesystem` — provides local skills from DSH's roots (`.dsh/skills`, `.agents/skills`, user roots). The prompt-assembly waterfall publishes model-invocable skill metadata as a base64 `<pi-skills>` marker; the request transform renders pi's `<skills>` section with name, description and absolute `SKILL.md` path, and the model loads the body with `read`. No `skill` tool is added.
- `inherit-guard` (`@skiyer/dsh-pi-context/guard`) — a programmatic `tools.restrict({ deny })` at the preset scope. It removes inherited non-pi tools (`working_directory`, Team, web, workspace utilities) without profile-level `disabled` patches; `mcp__*` and `tool_search` stay callable, and the request facade still hides their declarations from the model.
- an isolated `compaction` group with `pi-compaction` (a `BasicCompactionEngine` subclass overriding `summarize()`) and `command-compact`.

A **global** mount (`mount: global`, inserted manually at a profile root) applies pi's tools to every agent instead; it also installs a complete pi system-prompt section and patches `BasicCompactionEngine.prototype.summarize` process-wide.

The `bash` tool resolves its shell the same way vanilla pi does: explicit `shellPath`/`PI_BASH_PATH`, Git for Windows installation paths, or `bash.exe` on `PATH`; the legacy WSL `System32\bash.exe` uses `-s` with the command on stdin. Missing shells produce pi's actionable error. Windows child termination uses `taskkill /T /F`.

`pi-context` also registers a `pi_cwd` prompt variable from `workingDirectory`. A preset that suppresses runtime context can put `<pi-cwd>{{pi_cwd}}</pi-cwd>` in its persona prefix; `readCwdFromMessages` extracts it before the wire rewrite, so the pi `<cwd>` stays per-session without a static path or a user-visible reminder.

A **wire** facade rewrites only calls to the configured gateway origins whose path ends in `/chat/completions` and whose body contains the pi tool set. Session-title calls and unrelated providers pass through untouched, and transport headers are not touched. It remains separate from tool control: the guard owns the local tool namespace, the facade owns the serialized pi request. It:

1. replaces the leading instruction message with pi's prompt (preamble, `<tools>`, `<rules>`, `<cwd>`, `<mcp_servers>`);
2. drops DSH `<system-reminder>` user messages and converts string user content to pi's text-block array;
3. replaces the tool array with pi's five declarations, plus `tool_search` when a deferred MCP server exists and any loaded `mcp__…` tools;
4. leaves every transport header (including `user-agent`) exactly as DeepSeek Harness sends it.

Body fields other than these are already produced by the shared pi-ai adapter and are left alone.

## MCP exposure

Exposure is decided per server from `mcpServers` (unlisted = `codemode`):

- `codemode` — excluded from the tool array; listed in `<mcp_servers>`; callable as `tools.mcp__server__tool`.
- `deferred` — excluded until `tool_search` matches it; `tool_search` then adds it to the next request's tool array.
- `direct` — declared with the server's own input schema.
- `hidden` — excluded and not listed.

A codemode script sees the tools that were resolved before its sandbox starts; MCP tools that are still connecting wait up to `mcpWaitMs` before the script runs.

## MCP configuration

`pi-mcp-config` (a profile-scope bundle plugin) reads `~/.pi/agent/mcp.json`, maps enabled entries to DSH `mcp-manager` registrations, and expands `${NAME}` plus leading `~/` values. `pi-context` reads the same file for `exposure`/`toolExposure`/`description` metadata, so Pi 模式's `<mcp_servers>` section reflects pi's exposure setting. Display names normalize `-` to `_`, descriptions use the first line with pi's 250/4096-character caps, and exact `toolExposure` keys win over `*` patterns.

DSH's MCP manager is global. The bridge therefore registers servers for the whole profile, and project `.pi/mcp.json` is deliberately not read (project trust and per-project scoping are absent). `!command` values and OAuth are not bridged.

## Pi settings view

`pi-mode.json` in the active profile directory stores profile-wide Pi settings: `disabledSkills`, `disabledMcpServers`, and compaction `retainTokens` / `headroomTokens` / `thresholdRatio` / `maxTokens`. There is no master skills/MCP switch; each listed item is controlled independently. The `Pi 配置` Settings section reads and writes it through the DSH Settings Remote (`pi-settings` volatile fields); a root `pi-settings` plugin mirrors those values to `pi-mode.json`. `pi-context` reads the file on each prompt/request, `PiCompactionEngine` reads it before each compaction, and the MCP bridge reads it at startup. MCP server enable/disable changes affect Pi mode on the next request; the bridge keeps the server registered so re-enabling does not require a restart.

## Compaction

The pi compaction backend overrides only `summarize()`. Span selection, pressure pricing and the durable `compaction/start`…`compaction/end` bracket stay unchanged, so replay, `/compact` and overflow recovery still work. The summary request serializes the conversation as pi does (`[User]`, `[Assistant]`, `[Assistant tool calls]`, `[Tool result]`, tool results truncated at 2000 characters) and asks for pi's checkpoint headings.

DSH's trigger formula is `min(window × thresholdRatio, window − outputReservation − headroomTokens)`; the `pi` mode configures its backend with `thresholdRatio: 0.99`, `headroomTokens: 16384` and `retainTokens: 20000`. Because DSH also subtracts the model's output reservation, compaction can start earlier than pi's `window − 16384`. Adjust `headroomTokens`/`thresholdRatio` to taste.

## Limits

- codemode runs in `@earendil-works/pi-codemode` (QuickJS/WASM in a worker thread), with no Node/fs/network/timers, a 256 MB VM memory limit, and timeout/abort termination. `image()` writes a temp file and reports its path; tool calls still pass through DSH's tool service.
- `models.classify()` and `models.generateImages()` report an unavailable result; classifier and image providers are not bridged.
- `read` maps images through `attachments.saveImage` directly; the request carries the image as pi-ai's `Attached image(s) from tool result:` user message. If the attachment or route gate refuses the file, `read` falls back to a text note naming the error. No `read_image` tool exists in the preset.
- Only `docs/pi/codemode.md` is vendored; the rest of pi's `<docs>`, `<skills>` and project instructions are not reproduced. User-level MCP configuration is bridged; project `.pi/mcp.json` is not.
- In `preset` mode the request rewrite is the sole system-prompt replacement: DSH's session log keeps the preset's one-line persona and its runtime-context turns, while the provider request carries pi's prompt. In `global` mode the pi prompt is also installed as DSH's own complete section.
- Identity headers are intentionally not simulated; a gateway can still tell the two apart by `user-agent`.
- DSH's own UI affordances for its native tools (cards, approval) apply only to tools that remain.
- Multiple concurrent sessions share the "loaded deferred tools" set; a `tool_search` in one session can add a tool to another session's next request until restart.
- The provider's output cap (`max_completion_tokens`) still comes from the DSH model configuration, not pi's `models.json`.


## Security

`codemode` runs in `@earendil-works/pi-codemode` (QuickJS/WASM in a worker thread). The VM has no Node, `process`, `require`, filesystem, network, or timers; tools and globals are the only capabilities and cross the boundary as JSON. The VM has a 256 MB memory limit, and timeout/abort terminates the worker.

Nested `tools.*` calls still go through DSH's tool service, so DSH sandbox and approval policies apply to them. This is a strong script sandbox, not an OS container: scripts can invoke any tool the mode exposes, and resource exhaustion is bounded rather than eliminated.
