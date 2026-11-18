# pi context

Reproduces vanilla pi 1.5.0's context-management machinery inside DeepSeek Harness:
the tool set, `codemode`, MCP exposure and compaction.

The bundle registers a **`pi` agent preset** displayed as **Pi 模式**, so it appears as a mode in the mode/preset selector. The bundle is the installable package; the preset is the per-session mode it declares; the profile is the app composition that installs the bundle. Agents created with that mode get pi's context management; other modes are unchanged. In the `vanilla-pi` profile Pi 模式 is the default.

- **Tool set** — exactly `read`, `bash`, `edit`, `write` and `codemode`, with pi's JSON schemas, argument names and prompt snippets. The `PI_*` environment rule is intentionally removed; `models` is marked unbridged; `image()` saves a temp file and reports its path, matching pi. The codemode description points to the bundled codemode reference through a runtime placeholder, so it contains the installed bundle path, never a hardcoded `/Users/.../.pi/...` pi-install path.
- **codemode** — a real `codemode` tool: raw JavaScript as an async function body, `tools.<name>(args)`, `text()`, `image()`, `console`, `exit()`, `store()`/`load()`, `ALL_TOOLS`, `searchTools()`, `describeTool()`, `describeNamespace()`, `models`, and pi's `Script completed / Wall time / Output:` result format. It runs in the same QuickJS/WASM worker sandbox as pi (`@earendil-works/pi-codemode`), with no Node, filesystem, network or timers, a 256 MB VM memory limit, and a worker that is terminated on timeout/abort. `tools.bash()` resolves to pi's structured `{ output, truncated, full_output_path?, exit_code, wall_time_seconds }`, while direct `bash` still renders the model-facing text.
- **MCP exposure** — pi's four modes: `codemode` (default: tools are callable from scripts and never declared), `deferred` (`tool_search` loads matches for the next call), `direct`, and `hidden`. The `<mcp_servers>` prompt section uses pi's wording. User-level `~/.pi/agent/mcp.json` is read by a bundle-level bridge and its enabled servers are registered with DSH's MCP manager; `exposure` and `description` feed Pi 模式's `<mcp_servers>`.
- **Compaction** — Pi 模式 mounts a pi-summarizing backend in its isolated compaction group; a global mount patches the shipped backend. Summaries use pi's structured checkpoint prompt (`Goal / Constraints & Preferences / Progress / Key Decisions / Next Steps / Critical Context`) and pi's conversation serialization, with pi's defaults of 20k retained tokens and a 16k reserve.
- **Prompt/message context** — pi's `<tools>`, `<rules>`, `<cwd>` and `<mcp_servers>` sections, pi's tool order and declarations, block-form user content, and no DSH `<system-reminder>` turns.
- **Pi 配置 view** — the session View row **Pi 配置** edits profile-wide Pi settings (skills, MCP, compaction retain/headroom/threshold) through the DSH Settings Remote (`pi-settings` volatile fields), so opening or saving the view does not create command transcript rows. Skills and MCP servers are listed individually: unticking one adds its name to `disabledSkills` / `disabledMcpServers`, and Pi mode omits it from the prompt and codemode. A `pi-settings` Host plugin mirrors the values to `pi-mode.json` in the active profile directory; changes apply on the next request/compaction and do not require a restart.
- **Docs** — `docs/pi/codemode.md` is vendored from pi 1.5.0 (MIT, attribution in the file). Both the system prompt's `<docs>` section and the `codemode` tool description point at its absolute installed path; the tool link is interpolated at runtime, so it follows the bundle install location. It is the only pi documentation bundled; `models` is noted as unbridged in the tool description.
- **Identity** — the preamble starts **You are an AI agent powered by DeepSeek Harness in Pi mode.**; the captured `PI_*` environment-variable rule is intentionally omitted.
- **Skills** — the preset mounts `skill-filesystem`; local skills are rendered as pi's `<skills>` section with their absolute `SKILL.md` paths, and the model loads them through `read`. No separate `skill` tool is declared. DSH skill roots are used (`.dsh/skills`, `.agents/skills`, user roots), so shared `.agents/skills` works with pi; `.pi/skills` is not scanned by default.
- **Images** — `read` writes image bytes straight into DeepSeek Harness's durable attachment service (`attachments.saveImage`), so the image is validated, normalized, stored, and attached to the next request exactly as DSH does it. No separate `read_image` tool is mounted.

Transport identity is deliberately out of scope: `user-agent`, `x-stainless-*` and other transport headers are left exactly as DeepSeek Harness sends them, because they do not affect the agent's context or performance. Pi's documentation, skills and project trust model are not reproduced; the user-level MCP configuration is bridged as described below.

## Install

Install this directory as a bundle from **Plugins → Add plugin**, or:

```
plugin_manager install_bundle target=/absolute/path/to/pi-context/plugin
```

The bundle adds the `preset-pi` row (id `pi`). Restart DeepSeek Harness after installing so the profile recomposes and the mode appears. Select **Pi 模式** in the mode selector for a new session.

## Headless

## Install from GitHub

The repository is public. Install the bundle from the repository URL (or download a tarball and use **Plugins → Add plugin**):

```text
https://github.com/skiyer/dsh-pi-context
```

After installation, select **Pi 模式**; the Pi 配置 View appears beside Chat and Trajectory.

## Distribute Pi 模式

The bundle is the installable unit. Do not send a whole profile; recipients install the bundle into their own profile.

1. Choose a published package name and update the bundle references:
   - `package.json` → `@yourscope/dsh-pi-context`
   - `cordis.patch.yml` → the same name for `pi-context`, `/guard`, and `/compaction`
   - remove `"private": true`, add `license`/`repository`, keep `engines.dsh`
2. Publish to npm or build a tarball:
   ```bash
   npm pack
   ```
3. The recipient installs it from **Plugins → Add plugin** (npm name, Git URL, or `.tgz`) or the profile's plugin manager, then restarts. `Pi 模式` appears in the mode selector.
4. A local folder install also works for testing; the package name only needs to be unique inside the recipient's profile.

Profile-level choices — fixed cwd, `danger-full-access`, approval `never`, default preset — are intentionally **not** in the bundle. Ship those separately as a profile template or a small install script if you want a one-step `vanilla-pi` experience.

Headless note: Pi 模式 is an agent preset, and the one-shot headless runner does not adopt presets. A headless distribution needs a separate global-mount bundle/profile.

## Security: codemode is sandboxed

`codemode` runs in `@earendil-works/pi-codemode`: a fresh worker thread with a QuickJS/WASM VM. The VM has no Node, `process`, `require`, filesystem, network, or timers. The only capabilities are the injected `tools` and `globals`, bridged as JSON; host objects and host `Function` constructors are never exposed. Scripts are bounded by the overall timeout (including tool calls), a 256 MB VM memory limit, and worker termination on timeout/abort.

Tool calls inside a script still go through DSH's tool service, so the normal sandbox and approval policies apply to those nested calls. Resource exhaustion and tool capability mistakes remain possible (a script can call any tool the tool set exposes); codemode is not an OS-level container.

## Bundle, preset, profile

- **bundle** — the npm/local package (`@skiyer/dsh-pi-context`) installed into a profile; its `dsh.bundle.patch` adds the preset row.
- **preset** — the `id: pi` mode (`Pi 模式`); it owns the child plugins and is selected per session.
- **profile** — `vanilla-pi`/`desktop`; the app composition that lists bundles, sets the default model and chooses the app surface.
- **guard** — a child plugin of the preset. It calls `tools.restrict` at the preset scope instead of patching global rows, so every agent created from this preset keeps only the pi tool namespace plus the internal image/MCP tools.

A DSH profile selects one app, so `vanilla-pi` is the web profile. Its headless sibling is `vanilla-pi-headless`, which mounts the same bundle globally (the one-shot runner does not compose agent presets):

```sh
dsh vanilla-pi-headless "run the tests"
```

## Configure

### npx and CLI installs

`pi-compaction` loads DSH's `@deepseek-ai/dsh-compaction-basic` from the running installation. It first tries normal module resolution, then `DSH_INSTALL_DIR`, Electron resources, and the directory tree around `process.argv[1]`; this covers npx, global npm/pnpm installs, and Desktop. A missing installation reports the attempted paths.

### Windows

On Windows, `bash` resolves Git for Windows, then `bash.exe` on `PATH`, including WSL/MSYS2/Cygwin, matching vanilla pi. It uses stdin transport for the legacy WSL `System32\bash.exe`. Set `shellPath` (or `PI_BASH_PATH`) to an explicit `bash.exe`. A missing shell yields pi's actionable error instead of a spawn failure.

The bundle's `cordis.patch.yml` exposes the common settings:

| Setting | Default | Meaning |
|---|---|---|
| `mount` | `global` | `preset` when mounted inside the Pi 模式 preset; `global` when mounted at the profile root and applied to every agent. |
| `gatewayOrigins` | `["http://127.0.0.1:3425"]` | Provider origins whose `/chat/completions` context is rewritten. |
| `codemode` | `true` | Expose `codemode` and its addenda to the direct tools. |
| `installPromptSection` | `true` | Make DSH's own system prompt pi's in global mode (preset mode uses the wire rewrite). |
| `mcpServers` | `{}` | Per-server exposure and description, e.g. `{ "ida": { "exposure": "codemode", "description": "IDA tools" } }`. Unlisted servers default to `codemode`. |
| `mcpWaitMs` | `10000` (the pi preset uses `60000`) | How long to wait for MCP tools that are still connecting before a codemode sandbox starts. IDA's MCP server starts IDA before listing tools, so the preset allows a minute. |
| `shellPath` | `undefined` (or `PI_BASH_PATH`) | Explicit bash executable; on Windows, Git Bash is discovered automatically and a missing shell reports install instructions. |
| `suppressPromptContext` | `false` | Shadow DSH's required `working-directory:current` context section with an empty one, so the session emits no cwd `<system-reminder>`. Pair it with the persona marker below. |

### Dynamic cwd without a reminder

`pi-context` registers a prompt variable `pi_cwd` backed by DSH's own `workingDirectory` service. A preset that turns runtime context off can carry:

```yaml
prefix: |-
  You are an AI agent powered by DeepSeek Harness in Pi mode. Help users inspect files, run commands, and modify code.
  <pi-cwd>{{pi_cwd}}</pi-cwd>
complete: true
includeRuntimeContext: false
```

`readCwdFromMessages` reads `<pi-cwd>` from the recorded system prompt, then rewrites that prompt to pi's single developer message. The cwd stays per-session; no static path and no user-visible `<system-reminder>` are needed.

The preset also mounts `@skiyer/dsh-pi-context/guard`:

| Guard option | Default | Meaning |
|---|---|---|
| `allow` | `read, bash, edit, write, codemode, tool_search` | Inherited tools kept for the pi agent. The pi tools themselves are scoped; `tool_search` is the deferred MCP helper. |
| `keepMcp` | `true` | Keep inherited `mcp__*` tools callable from codemode; the request facade still hides their declarations from the model. |
| `debugFile` | unset | Append request/tool diagnostics as JSONL to this path. |

## MCP configuration from pi

The bundle mounts `pi-mcp-config` at profile scope. It reads the user-level pi MCP file:

```text
~/.pi/agent/mcp.json
```

and registers each enabled server with DSH's global `mcp-manager`:

- `command`/`args`/`env`/`cwd` → stdio
- `url`/`headers` → streamable HTTP
- `enabled: false` is skipped
- `${NAME}` values expand from the process environment; leading `~/` expands to home
- `exposure`, `toolExposure` and `description` are used for Pi 模式's `<mcp_servers>` prompt and tool projection. Server names are normalized to pi's `mcp__name` form (hyphens become `_`), descriptions use the first line with pi's 250-char/4096-char section caps, and per-tool `toolExposure` patterns (`*`, exact-name priority) override the server exposure.

Project-level `.pi/mcp.json` is **not** read, because DSH's MCP manager is global while pi's project configuration is per trusted project. Configure project-specific servers through DSH profile/settings instead.

Because MCP manager is global, registered servers are visible to the whole profile, not only Pi 模式. Pi 模式 still applies its own exposure policy; other modes may see the same MCP tools according to their own composition.

Do not also list the same server in a profile `mcp-manager.servers` map: the registration refuses the name collision. Use one source of truth.

`!command` values and pi's OAuth flow are not implemented by this bridge; use literal values or DSH's credential templates/headers instead.

## Verify

- Ask for a file read: the tool call is `read {"path": …}` and the result is pi's raw text.
- Ask for a codemode script that calls two tools in parallel; the result starts with `Script completed`.
- With an MCP server set to `deferred`, the first request declares `tool_search`; after a search, the next request declares the matched `mcp__…` tool.
- Run `/compact`; the summary uses pi's checkpoint headings.

### Automated tests

```bash
node test/guard.mjs
node test/tools.mjs
node test/codemode.mjs
node test/mcp-config.mjs
node test/settings.mjs
node test/parity.mjs
node test/agents-md.mjs
node test/shell.mjs
node test/compaction-paths.mjs
DSH_INSTALL_DIR="$DSH_INSTALL_DIR" ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" test/compaction.mjs
node test/edit-parity.mjs
```

`test/codemode.mjs` covers the QuickJS sandbox boundary, tool/global bridging, store writes, images, timeout, abort, and source errors. Codemode runs through `@earendil-works/pi-codemode`, so its `quickjs-wasi` dependency is installed with the package.

See `docs/DETAIL.md` for the implementation and its limits.
