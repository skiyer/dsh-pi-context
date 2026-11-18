// pi 1.5.0 tool semantics: read, bash, edit, write.
// The model-facing result strings follow pi's captured/source behavior.

import { spawn } from 'node:child_process';
import { resolveBashShell } from './pi-shell.js';
import * as fs from 'node:fs';
import { constants } from 'node:fs';
import { access, mkdtemp, open, readFile, stat, writeFile as writeFileFs, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export const MAX_LINES = 2000;
export const MAX_BYTES = 50 * 1024;

/** pi's `read` sends images as attachments; detect them so text decoding does not mangle them. */
function detectImageMimeType(buffer) {
  const starts = (...bytes) => bytes.every((byte, index) => buffer[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (starts(0x42, 0x4d)) return 'image/bmp';
  return undefined;
}

export function resolvePath(cwd, path) {
  if (typeof path !== 'string' || path.length === 0) throw new Error('path must be a non-empty string');
  let target = path;
  if (target === '~') target = process.env.HOME ?? target;
  else if (target.startsWith('~/')) target = join(process.env.HOME ?? '', target.slice(2));
  return isAbsolute(target) ? target : resolve(cwd, target);
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)}KB`;
  return `${bytes}B`;
}

/** pi's truncateHead: keep at most MAX_LINES lines and MAX_BYTES bytes from the start. */
export function truncateHead(content) {
  const allLines = content.split('\n');
  const totalLines = allLines.length;
  let output = '';
  let outputLines = 0;
  let truncatedBy;
  let firstLineExceedsLimit = false;
  for (let index = 0; index < allLines.length; index += 1) {
    const line = allLines[index];
    const candidate = output.length === 0 ? line : `${output}\n${line}`;
    if (Buffer.byteLength(candidate, 'utf8') > MAX_BYTES) {
      if (index === 0) firstLineExceedsLimit = true;
      truncatedBy = 'bytes';
      break;
    }
    output = candidate;
    outputLines = index + 1;
    if (outputLines >= MAX_LINES) {
      truncatedBy = index + 1 < allLines.length ? 'lines' : undefined;
      break;
    }
  }
  return {
    content: output,
    truncated: truncatedBy !== undefined || outputLines < totalLines,
    truncatedBy,
    outputLines,
    totalLines,
    firstLineExceedsLimit,
    outputBytes: Buffer.byteLength(output, 'utf8'),
  };
}

/** Sniff a file's leading bytes for an image format pi's read supports. */
export async function detectImageFile(path) {
  try {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(16);
      const { bytesRead } = await handle.read(buffer, 0, 16, 0);
      return detectImageMimeType(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

/** pi's read tool: path, offset (1-based), limit; raw text plus continuation notices. */
export async function readTool(cwd, args) {
  const absolute = resolvePath(cwd, args.path);
  const info = await stat(absolute);
  if (info.isDirectory()) throw new Error(`Path is a directory: ${args.path}`);
  const buffer = await readFile(absolute);
  const imageMimeType = detectImageMimeType(buffer);
  if (imageMimeType !== undefined) {
    return `Read image file [${imageMimeType}]\n[pi-context: image attachments are not bridged; decode the bytes with bash if pixel data is needed]`;
  }
  const textContent = buffer.toString('utf-8');
  const allLines = textContent.split('\n');
  const totalFileLines = allLines.length;
  const startLine = args.offset ? Math.max(0, args.offset - 1) : 0;
  const startLineDisplay = startLine + 1;
  if (startLine >= allLines.length) {
    throw new Error(`Offset ${args.offset} is beyond end of file (${allLines.length} lines total)`);
  }
  let selectedContent;
  let userLimitedLines;
  if (args.limit !== undefined) {
    const endLine = Math.min(startLine + args.limit, allLines.length);
    selectedContent = allLines.slice(startLine, endLine).join('\n');
    userLimitedLines = endLine - startLine;
  } else {
    selectedContent = allLines.slice(startLine).join('\n');
  }
  const truncation = truncateHead(selectedContent);
  if (truncation.firstLineExceedsLimit) {
    const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], 'utf-8'));
    return `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${args.path} | head -c ${MAX_BYTES}]`;
  }
  if (truncation.truncated) {
    const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
    const nextOffset = endLineDisplay + 1;
    if (truncation.truncatedBy === 'lines') {
      return `${truncation.content}\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
    }
    return `${truncation.content}\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
  }
  if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
    const remaining = allLines.length - (startLine + userLimitedLines);
    const nextOffset = startLine + userLimitedLines + 1;
    return `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
  }
  return truncation.content;
}

/** Structured bash result for codemode plus the model-facing text. */
export async function bashToolResult(cwd, args, signal, shellPath) {
  const command = String(args.command ?? '');
  if (command.length === 0) throw new Error('command must be a non-empty string');
  const timeoutMs = typeof args.timeout === 'number' && args.timeout > 0 ? args.timeout * 1000 : undefined;
  const shell = resolveBashShell(shellPath ?? process.env.PI_BASH_PATH);
  return new Promise((resolvePromise, rejectPromise) => {
    const startedAt = performance.now();
    const useStdin = shell.commandTransport === 'stdin';
    const child = spawn(shell.shell, useStdin ? shell.args : [...shell.args, command], {
      cwd,
      env: process.env,
      stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    if (useStdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(command);
    }
    const killShell = () => {
      if (process.platform === 'win32' && child.pid !== undefined) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
      } else {
        child.kill('SIGKILL');
      }
    };
    let output = '';
    let timedOut = false;
    let aborted = false;
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      killShell();
    }, timeoutMs);
    const onAbort = () => {
      aborted = true;
      killShell();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      rejectPromise(error);
    });
    child.on('close', async (code) => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const wallTimeSeconds = Math.round((performance.now() - startedAt) / 100) / 10;
      try {
        const { text, fullPath } = truncateTail(output);
        const failure = aborted
          ? 'Command aborted'
          : timedOut
            ? `Command timed out after ${args.timeout} seconds`
            : code === null
              ? 'Command terminated without an exit code'
              : undefined;
        const status = failure ?? (code !== 0 ? `Command exited with code ${code}` : undefined);
        const body = [text || '(no output)', status].filter(Boolean).join('\n\n');
        const full = await readFullOutput(fullPath, output);
        const structured = {
          output: full.content,
          truncated: full.truncated,
          ...(full.truncated && fullPath !== undefined ? { full_output_path: fullPath } : {}),
          exit_code: code ?? -1,
          wall_time_seconds: wallTimeSeconds,
          ...(failure ? { failure } : {}),
        };
        resolvePromise({ text: body, structured });
      } catch (error) {
        rejectPromise(error);
      }
    });
  });
}


/** pi's model-facing bash tool output. */
export async function bashTool(cwd, args, signal, shellPath) {
  return (await bashToolResult(cwd, args, signal, shellPath)).text;
}

/** Read the full bash output for programmatic callers, capped at 1 MiB. */
async function readFullOutput(fullPath, fallback) {
  if (fullPath === undefined) return { content: fallback, truncated: false };
  let buffer;
  try {
    buffer = await readFile(fullPath);
  } catch {
    return { content: fallback, truncated: false };
  }
  const max = 1024 * 1024;
  if (buffer.length <= max) return { content: buffer.toString('utf8'), truncated: false };
  const headBytes = Math.floor(max / 2);
  const tailBytes = max - headBytes;
  const head = buffer.subarray(0, headBytes).toString('utf8');
  const tail = buffer.subarray(buffer.length - tailBytes).toString('utf8');
  const omitted = buffer.length - headBytes - tailBytes;
  return { content: `${head}\n\n[... ${omitted} bytes omitted ...]\n\n${tail}`, truncated: true };
}

/** pi's truncateTail for bash output, including the full-output temp file notice. */
export function truncateTail(content) {
  const lines = content.split('\n');
  const totalLines = lines.length;
  let selected = '';
  let outputLines = 0;
  let truncatedBy;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = selected.length === 0 ? lines[index] : `${lines[index]}\n${selected}`;
    if (Buffer.byteLength(candidate, 'utf8') > MAX_BYTES) {
      truncatedBy = 'bytes';
      break;
    }
    selected = candidate;
    outputLines += 1;
    if (outputLines >= MAX_LINES) {
      truncatedBy = index > 0 ? 'lines' : undefined;
      break;
    }
  }
  if (truncatedBy === undefined && outputLines >= totalLines) return { text: selected, truncated: false };
  const startLine = totalLines - outputLines + 1;
  const endLine = totalLines;
  let text = selected;
  const tempDir = join(tmpdir(), 'pi-bash');
  const fullPath = join(tempDir, `output-${Date.now()}.txt`);
  // The caller cannot await inside this helper; write synchronously enough for parity.
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(fullPath, content);
    if (truncatedBy === 'lines') text += `\n\n[Showing lines ${startLine}-${endLine} of ${totalLines}. Full output: ${fullPath}]`;
    else text += `\n\n[Showing lines ${startLine}-${endLine} of ${totalLines} (${formatSize(MAX_BYTES)} limit). Full output: ${fullPath}]`;
  } catch {
    // If the full output cannot be saved, pi's marker is omitted rather than failing the call.
  }
  return { text, truncated: true, fullPath };
}

function splitBom(content) {
  return content.startsWith('\uFEFF')
    ? { bom: '\uFEFF', text: content.slice(1) }
    : { bom: '', text: content };
}

function detectLineEnding(content) {
  const crlfIdx = content.indexOf('\r\n');
  const lfIdx = content.indexOf('\n');
  if (lfIdx === -1) return '\n';
  if (crlfIdx === -1) return '\n';
  return crlfIdx < lfIdx ? '\r\n' : '\n';
}

function normalizeToLF(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function restoreLineEndings(text, ending) {
  return ending === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

function normalizeForFuzzyMatch(text) {
  return text
    .normalize('NFKC')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ');
}

function splitLinesWithEndings(content) {
  return content.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function getLineSpans(content) {
  let offset = 0;
  return splitLinesWithEndings(content).map((line) => {
    const span = { start: offset, end: offset + line.length };
    offset = span.end;
    return span;
  });
}

function getReplacementLineRange(lines, replacement) {
  const replacementStart = replacement.matchIndex;
  const replacementEnd = replacement.matchIndex + replacement.matchLength;
  let startLine = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (replacementStart >= line.start && replacementStart < line.end) {
      startLine = index;
      break;
    }
  }
  if (startLine === -1) throw new Error('Replacement range is outside the base content.');
  let endLine = startLine;
  while (endLine < lines.length && lines[endLine].end < replacementEnd) endLine += 1;
  if (endLine >= lines.length) throw new Error('Replacement range is outside the base content.');
  return { startLine, endLine: endLine + 1 };
}

function applyReplacements(content, replacements, offset = 0) {
  let result = content;
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const replacement = replacements[index];
    const matchIndex = replacement.matchIndex - offset;
    result = result.substring(0, matchIndex) + replacement.newText + result.substring(matchIndex + replacement.matchLength);
  }
  return result;
}

/** pi's overlay: rewrite only the lines a replacement touches, copying all other lines verbatim. */
function applyReplacementsPreservingUnchangedLines(originalContent, baseContent, replacements) {
  const originalLines = splitLinesWithEndings(originalContent);
  const baseLines = getLineSpans(baseContent);
  if (originalLines.length !== baseLines.length) {
    throw new Error('Cannot preserve unchanged lines because the base content has a different line count.');
  }
  const groups = [];
  const sorted = [...replacements].sort((left, right) => left.matchIndex - right.matchIndex);
  for (const replacement of sorted) {
    const range = getReplacementLineRange(baseLines, replacement);
    const current = groups[groups.length - 1];
    if (current && range.startLine < current.endLine) {
      current.endLine = Math.max(current.endLine, range.endLine);
      current.replacements.push(replacement);
      continue;
    }
    groups.push({ ...range, replacements: [replacement] });
  }
  let originalLineIndex = 0;
  let result = '';
  for (const group of groups) {
    result += originalLines.slice(originalLineIndex, group.startLine).join('');
    const groupStartOffset = baseLines[group.startLine].start;
    const groupEndOffset = baseLines[group.endLine - 1].end;
    result += applyReplacements(baseContent.slice(groupStartOffset, groupEndOffset), group.replacements, groupStartOffset);
    originalLineIndex = group.endLine;
  }
  result += originalLines.slice(originalLineIndex).join('');
  return result;
}

function fuzzyFind(content, oldText) {
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return { found: true, index: exactIndex, length: oldText.length, usedFuzzyMatch: false, content };
  }
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);
  if (fuzzyIndex === -1) return { found: false, index: -1, length: 0, usedFuzzyMatch: false, content };
  return { found: true, index: fuzzyIndex, length: fuzzyOldText.length, usedFuzzyMatch: true, content: fuzzyContent };
}

function countOccurrences(content, oldText) {
  return normalizeForFuzzyMatch(content).split(normalizeForFuzzyMatch(oldText)).length - 1;
}

function emptyOldTextError(path, editIndex, totalEdits) {
  return totalEdits === 1
    ? new Error(`oldText must not be empty in ${path}.`)
    : new Error(`edits[${editIndex}].oldText must not be empty in ${path}.`);
}

function notFoundError(path, editIndex, totalEdits) {
  return totalEdits === 1
    ? new Error(`Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`)
    : new Error(`Could not find edits[${editIndex}] in ${path}. The oldText must match exactly including all whitespace and newlines.`);
}

function duplicateError(path, editIndex, totalEdits, occurrences) {
  return totalEdits === 1
    ? new Error(`Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`)
    : new Error(`Found ${occurrences} occurrences of edits[${editIndex}] in ${path}. Each oldText must be unique. Please provide more context to make it unique.`);
}

function overlapError(path, previous, current) {
  return new Error(`edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`);
}

function noChangeError(path, totalEdits) {
  return totalEdits === 1
    ? new Error(`No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`)
    : new Error(`No changes made to ${path}. The replacements produced identical content.`);
}

/** pi's applyEditsToNormalizedContent, byte-for-byte behavior. */
export function applyEditsToNormalizedContent(normalizedContent, edits, path) {
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText),
  }));
  for (let index = 0; index < normalizedEdits.length; index += 1) {
    if (normalizedEdits[index].oldText.length === 0) {
      throw emptyOldTextError(path, index, normalizedEdits.length);
    }
  }
  const initialMatches = normalizedEdits.map((edit) => fuzzyFind(normalizedContent, edit.oldText));
  const usedFuzzyMatch = initialMatches.some((match) => match.usedFuzzyMatch);
  const replacementBaseContent = usedFuzzyMatch ? normalizeForFuzzyMatch(normalizedContent) : normalizedContent;
  const matchedEdits = [];
  for (let index = 0; index < normalizedEdits.length; index += 1) {
    const edit = normalizedEdits[index];
    const matchResult = fuzzyFind(replacementBaseContent, edit.oldText);
    if (!matchResult.found) throw notFoundError(path, index, normalizedEdits.length);
    const occurrences = countOccurrences(replacementBaseContent, edit.oldText);
    if (occurrences > 1) throw duplicateError(path, index, normalizedEdits.length, occurrences);
    matchedEdits.push({
      editIndex: index,
      matchIndex: matchResult.index,
      matchLength: matchResult.length,
      newText: edit.newText,
    });
  }
  matchedEdits.sort((left, right) => left.matchIndex - right.matchIndex);
  for (let index = 1; index < matchedEdits.length; index += 1) {
    const previous = matchedEdits[index - 1];
    const current = matchedEdits[index];
    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw overlapError(path, previous, current);
    }
  }
  const baseContent = normalizedContent;
  const newContent = usedFuzzyMatch
    ? applyReplacementsPreservingUnchangedLines(normalizedContent, replacementBaseContent, matchedEdits)
    : applyReplacements(replacementBaseContent, matchedEdits);
  if (baseContent === newContent) throw noChangeError(path, normalizedEdits.length);
  return { baseContent, newContent };
}

export async function editTool(cwd, args) {
  const { path } = args;
  const edits = Array.isArray(args.edits) ? args.edits : [];
  if (edits.length === 0) {
    throw new Error('Edit tool input is invalid. edits must contain at least one replacement.');
  }
  const absolute = resolvePath(cwd, path);
  try {
    await access(absolute, constants.R_OK | constants.W_OK);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? `Error code: ${error.code}` : String(error);
    throw new Error(`Could not edit file: ${path}. ${code}.`);
  }
  const raw = await readFile(absolute, 'utf-8');
  const { bom, text } = splitBom(raw);
  const originalEnding = detectLineEnding(text);
  const normalized = normalizeToLF(text);
  const { newContent } = applyEditsToNormalizedContent(normalized, edits, path);
  await writeFileFs(absolute, bom + restoreLineEndings(newContent, originalEnding));
  return `Successfully replaced ${edits.length} block(s) in ${path}.`;
}

export async function writeTool(cwd, args) {
  const { path } = args;
  const absolute = resolvePath(cwd, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFileFs(absolute, String(args.content ?? ''));
  return `Successfully wrote to ${path}`;
}

export async function makeTempDir(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}
