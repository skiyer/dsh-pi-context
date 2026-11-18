// Generated from captured vanilla pi 1.5.0 requests.
// Do not edit by hand; see pi-compat/capture.

export const PI_TOOL_NAMES = ["read", "bash", "edit", "write", "codemode"];

export const TOOL_READ = {
  "name": "read",
  "description": "Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.\n\nCodemode: `tools.read(args)` resolves to `string | { data: string; mimeType: string; note: string; type: \"image\"; }`.",
  "parameters": {
    "type": "object",
    "required": [
      "path"
    ],
    "properties": {
      "path": {
        "type": "string",
        "description": "Path to the file to read (relative or absolute)"
      },
      "offset": {
        "type": "number",
        "description": "Line number to start reading from (1-indexed)"
      },
      "limit": {
        "type": "number",
        "description": "Maximum number of lines to read"
      }
    }
  }
};

export const TOOL_BASH = {
  "name": "bash",
  "description": "Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.\n\nCodemode: `tools.bash(args)` resolves to `{ output, truncated, full_output_path?, exit_code, wall_time_seconds }`.",
  "parameters": {
    "type": "object",
    "required": [
      "command"
    ],
    "properties": {
      "command": {
        "type": "string",
        "description": "Shell command to execute"
      },
      "timeout": {
        "type": "number",
        "description": "Timeout in seconds (optional, no default timeout)"
      }
    }
  }
};

export const TOOL_EDIT = {
  "name": "edit",
  "description": "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.\n\nCodemode: `tools.edit(args)` resolves to a string.",
  "parameters": {
    "type": "object",
    "required": [
      "path",
      "edits"
    ],
    "properties": {
      "path": {
        "type": "string",
        "description": "Path to the file to edit (relative or absolute)"
      },
      "edits": {
        "type": "array",
        "items": {
          "type": "object",
          "required": [
            "oldText",
            "newText"
          ],
          "properties": {
            "oldText": {
              "type": "string",
              "description": "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call."
            },
            "newText": {
              "type": "string",
              "description": "Replacement text for this targeted edit."
            }
          }
        },
        "description": "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead."
      }
    }
  }
};

export const TOOL_WRITE = {
  "name": "write",
  "description": "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.\n\nCodemode: `tools.write(args)` resolves to a string.",
  "parameters": {
    "type": "object",
    "required": [
      "path",
      "content"
    ],
    "properties": {
      "path": {
        "type": "string",
        "description": "Path to the file to write (relative or absolute)"
      },
      "content": {
        "type": "string",
        "description": "Content to write to the file"
      }
    }
  }
};

export const TOOL_CODEMODE = {
  "name": "codemode",
  "description": "Run JavaScript that calls other tools. The input is raw JavaScript (not JSON, no code fence), run as an async function body in a QuickJS sandbox: top-level `await` and `return` work. No Node, file system, network, or timers.\n- `await tools.<name>({ ...args })` resolves to a string, or an object if the tool's declaration says so, and rejects with an Error on failure. A tool whose declaration returns an object resolves on failure too when it returned that object; check its fields. Calls still running when the script ends are cancelled.\n- Optional first line: `// @options: {\"max_output_tokens\": 10000, \"timeout_ms\": 60000}`\n\nGlobals:\n- `text(value)`, `image(dataUrlOrImageBlock)`, `console.log(...)`, and top-level `return` add output; `exit()` ends the script. With several text items, each starts with a `==> text N/M <==` line, and `console` lines follow the other output in one `<console_output>` block. `image()` also saves the image to a temp file and the result names its path.\n- `store(key, value)` and `load(key)` keep JSON values across codemode calls.\n- `ALL_TOOLS`, `await searchTools(query, { limit?, namespace? })`, `await describeTool(name)`, `await describeNamespace(name)`: find unlisted tools, such as MCP tools.\n- `models`: classifier and image-model helpers are not bridged in this deployment.\n- Read the vendored codemode reference first: {{pi_codemode_docs}}",
  "parameters": {
    "type": "object",
    "required": [
      "code"
    ],
    "properties": {
      "code": {
        "type": "string",
        "description": "Raw JavaScript source."
      }
    }
  }
};

export const TOOL_SEARCH = {
  "name": "tool_search",
  "description": "# Tool discovery\n\nSearches over deferred tool metadata with BM25 and exposes matching tools for the next model call.\n\nSome of the tools, such as tools of MCP servers, may not have been provided to you upfront, and you should use this tool (`tool_search`) to search for the required tools. For MCP tool discovery, always use `tool_search`.",
  "parameters": {
    "type": "object",
    "required": [
      "query"
    ],
    "properties": {
      "query": {
        "type": "string",
        "description": "Search query for deferred tools."
      },
      "limit": {
        "type": "number",
        "description": "Maximum number of tools to return. Defaults to 8."
      }
    }
  }
};

export const PI_TOOL_DECLARATIONS = [TOOL_READ, TOOL_BASH, TOOL_EDIT, TOOL_WRITE, TOOL_CODEMODE];
export const TOOL_SNIPPETS = {
  read: "Read file contents",
  bash: "Execute bash commands (ls, grep, find, etc.)",
  edit: "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
  write: "Create or overwrite files",
  codemode: "Run JavaScript that calls other tools",
  tool_search: "Search for tools that are not loaded yet and load the matches",
};
