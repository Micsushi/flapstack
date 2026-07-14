import { lstat, readdir, realpath } from "node:fs/promises"
import { relative, resolve, sep } from "node:path"
import { assertRegisteredWorktree } from "../git/security/path-validation"
import { readFileInsideRoot, resolveInsideRoot, RootedReadTooLargeError } from "../path-safety"

export const LOCAL_MODEL_READ_TOOL_NAMES = ["read_file", "list_directory", "glob", "grep"] as const
export type LocalModelReadToolName = (typeof LOCAL_MODEL_READ_TOOL_NAMES)[number]

export type LocalModelToolSchema = {
  type: "function"
  function: {
    name: string
    description: string
    parameters: {
      type: "object"
      properties: Record<string, Record<string, unknown>>
      required: string[]
      additionalProperties: false
    }
  }
}

export const LOCAL_MODEL_READ_TOOL_SCHEMAS: readonly LocalModelToolSchema[] = [
  toolSchema(
    "read_file",
    "Read one UTF-8 text file inside the registered project.",
    {
      path: { type: "string", description: "Project-relative file path." },
    },
    ["path"],
  ),
  toolSchema(
    "list_directory",
    "List one directory inside the registered project.",
    {
      path: { type: "string", description: "Project-relative directory path. Use . for root." },
    },
    ["path"],
  ),
  toolSchema(
    "glob",
    "Find files by a bounded project-relative *, ?, or ** glob.",
    {
      pattern: { type: "string", description: "Project-relative glob pattern." },
      path: { type: "string", description: "Optional project-relative directory root." },
    },
    ["pattern"],
  ),
  toolSchema(
    "grep",
    "Find a literal text pattern in bounded project files.",
    {
      pattern: { type: "string", description: "Literal text to find." },
      path: { type: "string", description: "Optional project-relative directory or file." },
      glob: { type: "string", description: "Optional file glob relative to path." },
      case_sensitive: { type: "boolean", description: "Defaults to true." },
    },
    ["pattern"],
  ),
]

export type LocalModelLoopMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  toolCalls?: LocalModelNormalizedToolCall[]
  toolCallId?: string
  toolName?: string
}

export type LocalModelRawToolCall = {
  id?: unknown
  name?: unknown
  arguments?: unknown
}

export type LocalModelNormalizedToolCall = {
  id: string
  name: string
  arguments: unknown
}

export type LocalModelProviderTurnEvent =
  | { kind: "text-delta"; delta: string }
  | { kind: "tool-call"; call: LocalModelRawToolCall }
  | {
      kind: "done"
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
      reason?: string
    }

export type LocalModelProviderTurnRequest = {
  messages: readonly LocalModelLoopMessage[]
  tools: readonly LocalModelToolSchema[]
  signal: AbortSignal
}

export type LocalModelToolProvider = {
  streamTurn(request: LocalModelProviderTurnRequest): AsyncIterable<LocalModelProviderTurnEvent>
}

export type LocalModelToolResult = {
  ok: boolean
  tool: string
  content: string
  truncated: boolean
  errorCode?: LocalModelToolErrorCode
}

export type LocalModelToolEvidenceStatus = "started" | "succeeded" | "denied" | "failed"

export type LocalModelToolEvidence = {
  schemaVersion: 1
  runId: string
  sequence: number
  iteration: number
  callId: string
  tool: string
  input: unknown
  status: LocalModelToolEvidenceStatus
  result?: LocalModelToolResult
  startedAt: string
  completedAt?: string
}

export type LocalModelToolLoopEvent =
  | { kind: "text-delta"; delta: string }
  | { kind: "tool-input"; evidence: LocalModelToolEvidence }
  | { kind: "tool-output"; evidence: LocalModelToolEvidence }
  | {
      kind: "done"
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
      reason?: string
    }

export type LocalModelToolErrorCode =
  | "malformed-tool-call"
  | "unknown-tool"
  | "invalid-tool-arguments"
  | "unregistered-root"
  | "path-denied"
  | "not-found"
  | "not-text"
  | "file-too-large"
  | "permission-denied"
  | "approval-denied"
  | "approval-timeout"
  | "approval-cancelled"
  | "stale-file"
  | "write-failed"
  | "rollback-failed"
  | "tool-failed"

export type LocalModelToolLoopLimitCode =
  | "tool-iteration-limit"
  | "tool-call-limit"
  | "tool-context-limit"
  | "tool-output-limit"
  | "tool-time-limit"
  | "tool-recursion-limit"

export class LocalModelToolLoopError extends Error {
  constructor(public readonly code: LocalModelToolLoopLimitCode) {
    super(TOOL_LOOP_LIMIT_MESSAGES[code])
    this.name = "LocalModelToolLoopError"
  }
}

export type LocalModelToolLoopLimits = {
  maxIterations: number
  maxCalls: number
  maxRepeatedCall: number
  maxContextChars: number
  maxOutputChars: number
  maxWallTimeMs: number
}

export const DEFAULT_LOCAL_MODEL_TOOL_LOOP_LIMITS: LocalModelToolLoopLimits = {
  maxIterations: 8,
  maxCalls: 24,
  maxRepeatedCall: 3,
  maxContextChars: 120_000,
  maxOutputChars: 64_000,
  maxWallTimeMs: 120_000,
}

export type LocalModelReadToolExecutor = {
  execute(call: LocalModelNormalizedToolCall, signal: AbortSignal): Promise<LocalModelToolResult>
}

export type LocalModelReadToolOptions = {
  rootPath: string
  verifyRoot?: (rootPath: string) => string
  maxFileBytes?: number
  maxEntries?: number
  maxFilesVisited?: number
  maxOutputChars?: number
}

type ReadToolLimits = Required<Omit<LocalModelReadToolOptions, "rootPath" | "verifyRoot">>

const DEFAULT_READ_TOOL_LIMITS: ReadToolLimits = {
  maxFileBytes: 256_000,
  maxEntries: 200,
  maxFilesVisited: 1_000,
  maxOutputChars: 16_000,
}

const TOOL_LOOP_LIMIT_MESSAGES: Record<LocalModelToolLoopLimitCode, string> = {
  "tool-iteration-limit": "The local model tool loop reached its iteration limit.",
  "tool-call-limit": "The local model tool loop reached its tool-call limit.",
  "tool-context-limit": "The local model tool loop reached its context limit.",
  "tool-output-limit": "The local model tool loop reached its output limit.",
  "tool-time-limit": "The local model tool loop reached its wall-time limit.",
  "tool-recursion-limit": "The local model repeated the same tool call too many times.",
}

const SKIPPED_WALK_DIRECTORIES = new Set([".git", "node_modules", "out", "release"])

class LocalModelToolArgumentsError extends Error {}

export function createReadOnlyLocalModelToolExecutor(
  options: LocalModelReadToolOptions,
): LocalModelReadToolExecutor {
  const limits: ReadToolLimits = {
    maxFileBytes: boundedInteger(
      options.maxFileBytes,
      DEFAULT_READ_TOOL_LIMITS.maxFileBytes,
      1,
      2_000_000,
    ),
    maxEntries: boundedInteger(options.maxEntries, DEFAULT_READ_TOOL_LIMITS.maxEntries, 1, 2_000),
    maxFilesVisited: boundedInteger(
      options.maxFilesVisited,
      DEFAULT_READ_TOOL_LIMITS.maxFilesVisited,
      1,
      20_000,
    ),
    maxOutputChars: boundedInteger(
      options.maxOutputChars,
      DEFAULT_READ_TOOL_LIMITS.maxOutputChars,
      128,
      200_000,
    ),
  }
  const verifyRoot = options.verifyRoot ?? ((path) => assertRegisteredWorktree(path).canonicalPath)

  return {
    async execute(call, signal) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError")
      if (!LOCAL_MODEL_READ_TOOL_NAMES.includes(call.name as LocalModelReadToolName)) {
        return denied(call.name, "unknown-tool", "Unknown read-only tool.")
      }

      let root: string
      try {
        root = await realpath(verifyRoot(options.rootPath))
      } catch {
        return denied(call.name, "unregistered-root", "The project root is not registered.")
      }

      try {
        switch (call.name as LocalModelReadToolName) {
          case "read_file":
            return await readFileTool(root, call.arguments, limits)
          case "list_directory":
            return await listDirectoryTool(root, call.arguments, limits)
          case "glob":
            return await globTool(root, call.arguments, limits, signal)
          case "grep":
            return await grepTool(root, call.arguments, limits, signal)
        }
      } catch (error) {
        if (error instanceof LocalModelToolArgumentsError) {
          return denied(call.name, "invalid-tool-arguments", "The tool arguments are invalid.")
        }
        if (error instanceof RootedReadTooLargeError) {
          return denied(call.name, "file-too-large", "The requested file exceeds the read limit.")
        }
        if (isAbortError(error)) throw error
        const code = isMissingError(error) ? "not-found" : "path-denied"
        return denied(call.name, code, "The requested project path is unavailable or unsafe.")
      }
    },
  }
}

export async function* runBoundedLocalModelToolLoop(input: {
  runId: string
  messages: readonly LocalModelLoopMessage[]
  toolsEnabled: boolean
  tools?: readonly LocalModelToolSchema[]
  provider: LocalModelToolProvider
  executor?: LocalModelReadToolExecutor
  signal: AbortSignal
  limits?: Partial<LocalModelToolLoopLimits>
  now?: () => number
}): AsyncGenerator<LocalModelToolLoopEvent> {
  const limits = normalizeLoopLimits(input.limits)
  const now = input.now ?? Date.now
  const startedAt = now()
  const deadlineController = new AbortController()
  const abortFromCaller = () => deadlineController.abort(input.signal.reason)
  if (input.signal.aborted) deadlineController.abort(input.signal.reason)
  else input.signal.addEventListener("abort", abortFromCaller, { once: true })
  let wallTimedOut = false
  const timer = setTimeout(() => {
    wallTimedOut = true
    deadlineController.abort()
  }, limits.maxWallTimeMs)

  const messages = input.messages.map(copyMessage)
  const tools = input.toolsEnabled ? (input.tools ?? LOCAL_MODEL_READ_TOOL_SCHEMAS) : []
  const allowedToolNames = new Set(tools.map((tool) => tool.function.name))
  let callCount = 0
  let sequence = 0
  let outputChars = 0
  const repeatedCalls = new Map<string, number>()
  const usedCallIds = new Set<string>()
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  let hasInputTokens = false
  let hasOutputTokens = false
  let hasTotalTokens = false

  try {
    for (let iteration = 1; iteration <= limits.maxIterations; iteration += 1) {
      assertWithinContext(messages, limits.maxContextChars, tools)
      assertWithinTime(now(), startedAt, limits.maxWallTimeMs, wallTimedOut)
      const turnCalls: LocalModelNormalizedToolCall[] = []
      let assistantText = ""
      let doneReason: string | undefined
      let sawDone = false

      try {
        for await (const event of input.provider.streamTurn({
          messages,
          tools,
          signal: deadlineController.signal,
        })) {
          assertWithinTime(now(), startedAt, limits.maxWallTimeMs, wallTimedOut)
          if (event.kind === "text-delta") {
            if (typeof event.delta !== "string")
              throw new LocalModelToolLoopError("tool-output-limit")
            outputChars += event.delta.length
            if (outputChars > limits.maxOutputChars) {
              throw new LocalModelToolLoopError("tool-output-limit")
            }
            assistantText += event.delta
            yield event
          } else if (event.kind === "tool-call") {
            turnCalls.push(
              normalizeProviderToolCall(event.call, iteration, turnCalls.length + 1, usedCallIds),
            )
          } else {
            sawDone = true
            doneReason = event.reason
            if (event.inputTokens !== undefined) {
              usage.inputTokens += event.inputTokens
              hasInputTokens = true
            }
            if (event.outputTokens !== undefined) {
              usage.outputTokens += event.outputTokens
              hasOutputTokens = true
            }
            if (event.totalTokens !== undefined) {
              usage.totalTokens += event.totalTokens
              hasTotalTokens = true
            }
          }
        }
      } catch (error) {
        if (wallTimedOut) throw new LocalModelToolLoopError("tool-time-limit")
        throw error
      }

      if (!sawDone) throw new Error("Provider turn ended before a terminal event.")
      if (turnCalls.length === 0 || !input.toolsEnabled) {
        yield {
          kind: "done",
          ...(hasInputTokens ? { inputTokens: usage.inputTokens } : {}),
          ...(hasOutputTokens ? { outputTokens: usage.outputTokens } : {}),
          ...(hasTotalTokens ? { totalTokens: usage.totalTokens } : {}),
          ...(doneReason ? { reason: doneReason } : {}),
        }
        return
      }
      if (!input.executor) throw new Error("Read-only tool executor is unavailable.")

      messages.push({ role: "assistant", content: assistantText, toolCalls: turnCalls })
      assertWithinContext(messages, limits.maxContextChars, tools)
      for (const call of turnCalls) {
        callCount += 1
        sequence += 1
        const started = new Date(now()).toISOString()
        const evidence: LocalModelToolEvidence = {
          schemaVersion: 1,
          runId: input.runId,
          sequence,
          iteration,
          callId: call.id,
          tool: call.name,
          input: boundedEvidenceValue(call.arguments),
          status: "started",
          startedAt: started,
        }
        yield { kind: "tool-input", evidence }

        if (callCount > limits.maxCalls) {
          yield {
            kind: "tool-output",
            evidence: completeEvidence(
              evidence,
              denied(call.name, "tool-failed", TOOL_LOOP_LIMIT_MESSAGES["tool-call-limit"]),
              now(),
            ),
          }
          throw new LocalModelToolLoopError("tool-call-limit")
        }
        const signature = stableCallSignature(call)
        const repeats = (repeatedCalls.get(signature) ?? 0) + 1
        repeatedCalls.set(signature, repeats)
        if (repeats > limits.maxRepeatedCall) {
          yield {
            kind: "tool-output",
            evidence: completeEvidence(
              evidence,
              denied(call.name, "tool-failed", TOOL_LOOP_LIMIT_MESSAGES["tool-recursion-limit"]),
              now(),
            ),
          }
          throw new LocalModelToolLoopError("tool-recursion-limit")
        }

        const result = await executeNormalizedCall(
          input.executor,
          call,
          deadlineController.signal,
          allowedToolNames,
        )
        const serializedResult = JSON.stringify(result)
        if (outputChars + serializedResult.length > limits.maxOutputChars) {
          yield {
            kind: "tool-output",
            evidence: completeEvidence(
              evidence,
              denied(call.name, "tool-failed", TOOL_LOOP_LIMIT_MESSAGES["tool-output-limit"]),
              now(),
            ),
          }
          throw new LocalModelToolLoopError("tool-output-limit")
        }
        outputChars += serializedResult.length
        const completed = completeEvidence(evidence, result, now())
        yield { kind: "tool-output", evidence: completed }
        messages.push({
          role: "tool",
          content: serializedResult,
          toolCallId: call.id,
          toolName: call.name,
        })
        assertWithinContext(messages, limits.maxContextChars, tools)
      }

      if (iteration === limits.maxIterations) {
        throw new LocalModelToolLoopError("tool-iteration-limit")
      }
    }
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener("abort", abortFromCaller)
  }
}

async function readFileTool(
  root: string,
  rawArguments: unknown,
  limits: ReadToolLimits,
): Promise<LocalModelToolResult> {
  const args = exactArguments(rawArguments, ["path"], ["path"])
  const path = safePathArgument(args.path, false)
  const bytes = await readFileInsideRoot(root, path, { maxBytes: limits.maxFileBytes })
  if (bytes.includes(0)) return denied("read_file", "not-text", "Binary files are not readable.")
  return successful("read_file", bytes.toString("utf8"), limits.maxOutputChars)
}

async function listDirectoryTool(
  root: string,
  rawArguments: unknown,
  limits: ReadToolLimits,
): Promise<LocalModelToolResult> {
  const args = exactArguments(rawArguments, ["path"], ["path"])
  const path = safePathArgument(args.path, true)
  const entries = (await readVerifiedDirectory(root, path))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, limits.maxEntries)
    .map(
      (entry) =>
        `${entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file"}\t${entry.name}`,
    )
  return successful("list_directory", entries.join("\n"), limits.maxOutputChars)
}

async function globTool(
  root: string,
  rawArguments: unknown,
  limits: ReadToolLimits,
  signal: AbortSignal,
): Promise<LocalModelToolResult> {
  const args = exactArguments(rawArguments, ["pattern", "path"], ["pattern"])
  const pattern = stringArgument(args.pattern, "pattern", 512)
  const path = args.path === undefined ? "." : safePathArgument(args.path, true)
  const matcher = compileGlob(pattern)
  const files = await walkFiles(root, path, limits, signal)
  return successful(
    "glob",
    files
      .filter((file) => matcher(file.relativeToStart))
      .map((file) => file.relativeToRoot)
      .join("\n"),
    limits.maxOutputChars,
  )
}

async function grepTool(
  root: string,
  rawArguments: unknown,
  limits: ReadToolLimits,
  signal: AbortSignal,
): Promise<LocalModelToolResult> {
  const args = exactArguments(
    rawArguments,
    ["pattern", "path", "glob", "case_sensitive"],
    ["pattern"],
  )
  const pattern = stringArgument(args.pattern, "pattern", 512)
  const path = args.path === undefined ? "." : safePathArgument(args.path, true)
  const caseSensitive =
    args.case_sensitive === undefined ? true : booleanArgument(args.case_sensitive)
  const matcher =
    args.glob === undefined ? null : compileGlob(stringArgument(args.glob, "glob", 512))
  const needle = caseSensitive ? pattern : pattern.toLocaleLowerCase()
  const target = resolveInsideRoot(root, path)
  const targetInfo = await lstat(target)
  const files = targetInfo.isFile()
    ? [
        {
          absolutePath: target,
          relativeToRoot: relative(root, target),
          relativeToStart: relative(root, target),
        },
      ]
    : await walkFiles(root, path, limits, signal)
  const matches: string[] = []

  for (const file of files) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError")
    if (matcher && !matcher(file.relativeToStart)) continue
    let bytes: Buffer
    try {
      bytes = await readFileInsideRoot(root, file.relativeToRoot, { maxBytes: limits.maxFileBytes })
    } catch (error) {
      if (error instanceof RootedReadTooLargeError) continue
      throw error
    }
    if (bytes.includes(0)) continue
    for (const [index, line] of bytes.toString("utf8").split(/\r?\n/).entries()) {
      const haystack = caseSensitive ? line : line.toLocaleLowerCase()
      if (haystack.includes(needle)) matches.push(`${file.relativeToRoot}:${index + 1}:${line}`)
      if (matches.length >= limits.maxEntries) break
    }
    if (matches.length >= limits.maxEntries) break
  }
  return successful("grep", matches.join("\n"), limits.maxOutputChars)
}

async function walkFiles(
  root: string,
  startPath: string,
  limits: ReadToolLimits,
  signal: AbortSignal,
): Promise<Array<{ absolutePath: string; relativeToRoot: string; relativeToStart: string }>> {
  const start = await safeDirectory(root, startPath)
  const files: Array<{ absolutePath: string; relativeToRoot: string; relativeToStart: string }> = []
  const pending = [start]
  let visited = 0

  while (
    pending.length > 0 &&
    files.length < limits.maxEntries &&
    visited < limits.maxFilesVisited
  ) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError")
    const requestedDirectory = pending.shift()!
    const relativeDirectory = relative(root, requestedDirectory) || "."
    const directory = await safeDirectory(root, relativeDirectory)
    for (const entry of (await readVerifiedDirectory(root, relativeDirectory)).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      visited += 1
      if (visited > limits.maxFilesVisited) break
      if (entry.isSymbolicLink()) continue
      const absolutePath = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_WALK_DIRECTORIES.has(entry.name)) pending.push(absolutePath)
        continue
      }
      if (!entry.isFile()) continue
      files.push({
        absolutePath,
        relativeToRoot: portablePath(relative(root, absolutePath)),
        relativeToStart: portablePath(relative(start, absolutePath)),
      })
      if (files.length >= limits.maxEntries) break
    }
  }
  return files
}

async function safeDirectory(root: string, relativePath: string): Promise<string> {
  const lexicalRoot = resolve(root)
  const target = resolveInsideRoot(lexicalRoot, relativePath)
  const rootInfo = await lstat(lexicalRoot)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("Unsafe root")
  const canonicalRoot = await realpath(lexicalRoot)
  let current = canonicalRoot
  for (const part of relative(lexicalRoot, target).split(sep).filter(Boolean)) {
    current = resolve(current, part)
    const info = await lstat(current)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Unsafe directory")
    const canonical = await realpath(current)
    if (canonical !== canonicalRoot && !canonical.startsWith(canonicalRoot + sep)) {
      throw new Error("Directory escaped root")
    }
  }
  return current
}

async function readVerifiedDirectory(root: string, relativePath: string) {
  const directory = await safeDirectory(root, relativePath)
  const before = await lstat(directory)
  const entries = await readdir(directory, { withFileTypes: true })
  const rechecked = await safeDirectory(root, relativePath)
  const after = await lstat(rechecked)
  if (
    directory !== rechecked ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.isSymbolicLink() ||
    !before.isDirectory()
  ) {
    throw new Error("Directory changed during read")
  }
  return entries
}

async function executeNormalizedCall(
  executor: LocalModelReadToolExecutor,
  call: LocalModelNormalizedToolCall,
  signal: AbortSignal,
  allowedToolNames: ReadonlySet<string>,
): Promise<LocalModelToolResult> {
  if (!allowedToolNames.has(call.name)) {
    return denied(call.name, "unknown-tool", "Unknown or unavailable local-model tool.")
  }
  if (!isRecord(call.arguments)) {
    return denied(call.name, "malformed-tool-call", "Tool arguments must be an object.")
  }
  try {
    return await executor.execute(call, signal)
  } catch (error) {
    if (isAbortError(error)) throw error
    return denied(call.name, "tool-failed", "The local-model tool failed safely.")
  }
}

function normalizeProviderToolCall(
  raw: LocalModelRawToolCall,
  iteration: number,
  index: number,
  usedCallIds: Set<string>,
): LocalModelNormalizedToolCall {
  const requestedId =
    typeof raw.id === "string" && raw.id.trim() && raw.id.length <= 256
      ? raw.id
      : `local-tool-${iteration}-${index}`
  const id = usedCallIds.has(requestedId) ? `${requestedId}-${iteration}-${index}` : requestedId
  usedCallIds.add(id)
  return {
    id,
    name:
      typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 128) : "unknown",
    arguments: raw.arguments,
  }
}

function completeEvidence(
  evidence: LocalModelToolEvidence,
  result: LocalModelToolResult,
  completedAt: number,
): LocalModelToolEvidence {
  const failed =
    result.errorCode === "tool-failed" ||
    result.errorCode === "write-failed" ||
    result.errorCode === "rollback-failed"
  return {
    ...evidence,
    status: result.ok ? "succeeded" : failed ? "failed" : "denied",
    result,
    completedAt: new Date(completedAt).toISOString(),
  }
}

function exactArguments(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) throw new LocalModelToolArgumentsError("Invalid tool arguments")
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new LocalModelToolArgumentsError("Invalid tool arguments")
  }
  if (required.some((key) => !(key in value))) {
    throw new LocalModelToolArgumentsError("Invalid tool arguments")
  }
  return value
}

function safePathArgument(value: unknown, allowRoot: boolean): string {
  const path = stringArgument(value, "path", 4_096).replaceAll("\\", "/")
  if (!allowRoot && (path === "." || path === "")) {
    throw new LocalModelToolArgumentsError("File path required")
  }
  return path || "."
}

function stringArgument(value: unknown, _name: string, maxLength: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    value.includes("\0")
  ) {
    throw new LocalModelToolArgumentsError("Invalid string argument")
  }
  return value.trim()
}

function booleanArgument(value: unknown): boolean {
  if (typeof value !== "boolean") throw new LocalModelToolArgumentsError("Invalid boolean argument")
  return value
}

function successful(tool: string, content: string, maxChars: number): LocalModelToolResult {
  const truncated = content.length > maxChars
  return { ok: true, tool, content: content.slice(0, maxChars), truncated }
}

function denied(
  tool: string,
  errorCode: LocalModelToolErrorCode,
  content: string,
): LocalModelToolResult {
  return { ok: false, tool, content, truncated: false, errorCode }
}

function compileGlob(pattern: string): (path: string) => boolean {
  const portable = portablePath(pattern)
  let source = "^"
  for (let index = 0; index < portable.length; index += 1) {
    const character = portable[index]!
    if (character === "*" && portable[index + 1] === "*") {
      index += 1
      if (portable[index + 1] === "/") {
        index += 1
        source += "(?:.*/)?"
      } else source += ".*"
    } else if (character === "*") source += "[^/]*"
    else if (character === "?") source += "[^/]"
    else source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
  }
  const expression = new RegExp(`${source}$`)
  return (path) => expression.test(portablePath(path))
}

function assertWithinContext(
  messages: readonly LocalModelLoopMessage[],
  maxChars: number,
  tools: readonly LocalModelToolSchema[],
): void {
  const chars =
    messages.reduce((total, message) => total + JSON.stringify(message).length, 0) +
    JSON.stringify(tools).length
  if (chars > maxChars) throw new LocalModelToolLoopError("tool-context-limit")
}

function assertWithinTime(now: number, startedAt: number, maxMs: number, timedOut: boolean): void {
  if (timedOut || now - startedAt >= maxMs) throw new LocalModelToolLoopError("tool-time-limit")
}

function normalizeLoopLimits(
  limits: Partial<LocalModelToolLoopLimits> | undefined,
): LocalModelToolLoopLimits {
  return {
    maxIterations: boundedInteger(
      limits?.maxIterations,
      DEFAULT_LOCAL_MODEL_TOOL_LOOP_LIMITS.maxIterations,
      1,
      64,
    ),
    maxCalls: boundedInteger(
      limits?.maxCalls,
      DEFAULT_LOCAL_MODEL_TOOL_LOOP_LIMITS.maxCalls,
      1,
      256,
    ),
    maxRepeatedCall: boundedInteger(
      limits?.maxRepeatedCall,
      DEFAULT_LOCAL_MODEL_TOOL_LOOP_LIMITS.maxRepeatedCall,
      1,
      32,
    ),
    maxContextChars: boundedInteger(
      limits?.maxContextChars,
      DEFAULT_LOCAL_MODEL_TOOL_LOOP_LIMITS.maxContextChars,
      256,
      2_000_000,
    ),
    maxOutputChars: boundedInteger(
      limits?.maxOutputChars,
      DEFAULT_LOCAL_MODEL_TOOL_LOOP_LIMITS.maxOutputChars,
      128,
      2_000_000,
    ),
    maxWallTimeMs: boundedInteger(
      limits?.maxWallTimeMs,
      DEFAULT_LOCAL_MODEL_TOOL_LOOP_LIMITS.maxWallTimeMs,
      10,
      600_000,
    ),
  }
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(value!)))
}

function stableCallSignature(call: LocalModelNormalizedToolCall): string {
  return `${call.name}:${stableJson(call.arguments)}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function boundedEvidenceValue(value: unknown): unknown {
  const serialized = stableJson(value)
  return serialized.length <= 2_000
    ? value
    : { truncated: true, preview: serialized.slice(0, 2_000) }
}

function copyMessage(message: LocalModelLoopMessage): LocalModelLoopMessage {
  return {
    ...message,
    ...(message.toolCalls ? { toolCalls: message.toolCalls.map((call) => ({ ...call })) } : {}),
  }
}

function portablePath(path: string): string {
  return path.split(sep).join("/").replaceAll("\\", "/").replace(/^\.\//, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isMissingError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

function toolSchema(
  name: string,
  description: string,
  properties: Record<string, Record<string, unknown>>,
  required: string[],
): LocalModelToolSchema {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required, additionalProperties: false },
    },
  }
}
