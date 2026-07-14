import { createHash } from "node:crypto"
import { realpath } from "node:fs/promises"
import { assertRegisteredWorktree } from "../git/security/path-validation"
import {
  readFileInsideRoot,
  resolveInsideRoot,
  RootedReadTooLargeError,
  writeFileInsideRoot,
} from "../path-safety"
import type { RunPermissionMode } from "../../../shared/harness-types"
import type {
  LocalModelNormalizedToolCall,
  LocalModelReadToolExecutor,
  LocalModelToolResult,
  LocalModelToolSchema,
} from "./local-model-read-tools"

export const LOCAL_MODEL_WRITE_TOOL_NAMES = ["edit_file", "write_file", "apply_patch"] as const
export type LocalModelWriteToolName = (typeof LOCAL_MODEL_WRITE_TOOL_NAMES)[number]

export const LOCAL_MODEL_WRITE_TOOL_SCHEMAS: readonly LocalModelToolSchema[] = [
  toolSchema(
    "edit_file",
    "Replace one exact text occurrence in a project file using its current SHA-256 hash.",
    {
      path: { type: "string", description: "Project-relative file path." },
      old_text: { type: "string", description: "Exact text that must occur once." },
      new_text: { type: "string", description: "Replacement text." },
      expected_sha256: { type: "string", description: "Current lowercase SHA-256 hash." },
    },
    ["path", "old_text", "new_text", "expected_sha256"],
  ),
  toolSchema(
    "write_file",
    "Atomically create or replace one project file with exact content.",
    {
      path: { type: "string", description: "Project-relative file path." },
      content: { type: "string", description: "Complete UTF-8 file content." },
      expected_sha256: {
        type: ["string", "null"],
        description: "Current SHA-256 hash, or null only when the file must not exist.",
      },
    },
    ["path", "content", "expected_sha256"],
  ),
  toolSchema(
    "apply_patch",
    "Apply exact unified-diff hunks to one project file using its current SHA-256 hash.",
    {
      path: { type: "string", description: "Project-relative file path." },
      patch: { type: "string", description: "Unified diff containing one or more @@ hunks." },
      expected_sha256: { type: "string", description: "Current lowercase SHA-256 hash." },
    },
    ["path", "patch", "expected_sha256"],
  ),
]

export type LocalModelWriteApprovalDecision = "approved" | "denied" | "timed-out" | "cancelled"

export type LocalModelWriteApprovalRequest = {
  runId: string
  chatId: string
  callId: string
  tool: LocalModelWriteToolName
  path: string
  expectedSha256: string | null
  nextSha256: string
  byteLength: number
  signal: AbortSignal
}

export type LocalModelWriteToolOptions = {
  rootPath: string
  runId: string
  chatId: string
  permissionMode: RunPermissionMode
  projectWriteAllowed: boolean
  verifyRoot?: (rootPath: string) => string
  requestApproval?: (
    request: LocalModelWriteApprovalRequest,
  ) => Promise<LocalModelWriteApprovalDecision>
  maxFileBytes?: number
  /** Deterministic attack/failure seams used by security tests. */
  beforeCommit?: (targetPath: string) => void | Promise<void>
  afterCommit?: (targetPath: string) => void | Promise<void>
}

const DEFAULT_MAX_FILE_BYTES = 1_000_000

class WriteArgumentsError extends Error {}
class RegisteredRootError extends Error {}

export function createProjectLocalModelWriteToolExecutor(
  options: LocalModelWriteToolOptions,
): LocalModelReadToolExecutor {
  const verifyRoot = options.verifyRoot ?? ((path) => assertRegisteredWorktree(path).canonicalPath)
  const maxFileBytes = boundedBytes(options.maxFileBytes)

  return {
    async execute(call, signal) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError")
      if (!LOCAL_MODEL_WRITE_TOOL_NAMES.includes(call.name as LocalModelWriteToolName)) {
        return denied(call.name, "unknown-tool", "Unknown project-write tool.")
      }
      if (!options.projectWriteAllowed || options.permissionMode === "read-only") {
        return denied(call.name, "permission-denied", "Project mutation is not authorized.")
      }

      try {
        const tool = call.name as LocalModelWriteToolName
        const plan = await buildWritePlan(
          tool,
          call.arguments,
          options.rootPath,
          verifyRoot,
          maxFileBytes,
        )
        if (plan.next.byteLength > maxFileBytes) {
          return denied(tool, "file-too-large", "The proposed file exceeds the write limit.")
        }

        if (options.permissionMode === "ask-before-edits") {
          if (!options.requestApproval) {
            return denied(tool, "approval-cancelled", "No approval bridge is available.")
          }
          const decision = await options.requestApproval({
            runId: options.runId,
            chatId: options.chatId,
            callId: call.id,
            tool,
            path: plan.path,
            expectedSha256: plan.expectedSha256,
            nextSha256: plan.next.sha256,
            byteLength: plan.next.byteLength,
            signal,
          })
          if (decision !== "approved") return approvalDenied(tool, decision)
        }

        if (signal.aborted) throw new DOMException("Aborted", "AbortError")
        const commitRoot = await verifiedRoot(options.rootPath, verifyRoot)
        if (commitRoot !== plan.root) {
          return denied(tool, "path-denied", "The registered project root changed.")
        }
        await writeFileInsideRoot(
          commitRoot,
          plan.path,
          { data: plan.next.content },
          {
            overwrite: true,
            createParents: false,
            mode: 0o644,
            expectedSha256: plan.expectedSha256,
            beforeCommit: async (targetPath) => {
              await options.beforeCommit?.(targetPath)
              const finalRoot = await verifiedRoot(options.rootPath, verifyRoot)
              if (finalRoot !== plan.root) throw new RegisteredRootError()
            },
            afterCommit: options.afterCommit,
          },
        )
        return {
          ok: true,
          tool,
          content: JSON.stringify({
            path: plan.path,
            byteLength: plan.next.byteLength,
            sha256: plan.next.sha256,
          }),
          truncated: false,
        }
      } catch (error) {
        if (isAbortError(error)) throw error
        if (error instanceof WriteArgumentsError) {
          return denied(call.name, "invalid-tool-arguments", error.message)
        }
        if (error instanceof RegisteredRootError) {
          return denied(call.name, "unregistered-root", "The registered project root changed.")
        }
        if (error instanceof RootedReadTooLargeError) {
          return denied(call.name, "file-too-large", "The current file exceeds the write limit.")
        }
        if (error instanceof AggregateError) {
          return denied(call.name, "rollback-failed", "The atomic write rollback failed safely.")
        }
        if (isStaleError(error)) {
          return denied(call.name, "stale-file", "The file changed before the write committed.")
        }
        if (isMissingError(error)) {
          return denied(call.name, "not-found", "The requested project file does not exist.")
        }
        if (isPathDeniedError(error)) {
          return denied(call.name, "path-denied", "The requested project path is unsafe.")
        }
        return denied(call.name, "write-failed", "The project write failed safely.")
      }
    },
  }
}

type WritePlan = {
  root: string
  path: string
  expectedSha256: string | null
  next: { content: string; byteLength: number; sha256: string }
}

async function buildWritePlan(
  tool: LocalModelWriteToolName,
  rawArguments: unknown,
  rootPath: string,
  verifyRoot: (rootPath: string) => string,
  maxFileBytes: number,
): Promise<WritePlan> {
  const root = await verifiedRoot(rootPath, verifyRoot)
  const args = parseArguments(tool, rawArguments)
  resolveInsideRoot(root, args.path)
  const current = await readCurrent(root, args.path, maxFileBytes)
  const currentHash = current === null ? null : sha256(current)
  if (currentHash !== args.expectedSha256) throw new Error("Write target content is stale")

  let next: string
  if (args.tool === "write_file") {
    next = args.content
  } else {
    if (current === null) throw missingError()
    const currentText = decodeText(current)
    next =
      args.tool === "edit_file"
        ? applyExactEdit(currentText, args.oldText, args.newText)
        : applyUnifiedPatch(currentText, args.patch)
  }
  const nextBytes = Buffer.from(next, "utf8")
  return {
    root,
    path: args.path,
    expectedSha256: args.expectedSha256,
    next: { content: next, byteLength: nextBytes.byteLength, sha256: sha256(nextBytes) },
  }
}

type ParsedWriteArguments =
  | {
      tool: "write_file"
      path: string
      expectedSha256: string | null
      content: string
    }
  | {
      tool: "edit_file"
      path: string
      expectedSha256: string
      oldText: string
      newText: string
    }
  | { tool: "apply_patch"; path: string; expectedSha256: string; patch: string }

function parseArguments(tool: LocalModelWriteToolName, value: unknown): ParsedWriteArguments {
  if (!isRecord(value)) throw new WriteArgumentsError("Tool arguments must be an object.")
  const path = pathArgument(value.path)
  if (tool === "write_file") {
    exactKeys(value, ["path", "content", "expected_sha256"])
    return {
      tool,
      path,
      content: contentArgument(value.content, "content"),
      expectedSha256: hashArgument(value.expected_sha256, true),
    }
  }
  if (tool === "edit_file") {
    exactKeys(value, ["path", "old_text", "new_text", "expected_sha256"])
    const oldText = contentArgument(value.old_text, "old_text")
    if (!oldText) throw new WriteArgumentsError("old_text must not be empty.")
    return {
      tool,
      path,
      oldText,
      newText: contentArgument(value.new_text, "new_text"),
      expectedSha256: hashArgument(value.expected_sha256, false)!,
    }
  }
  exactKeys(value, ["path", "patch", "expected_sha256"])
  return {
    tool,
    path,
    patch: nonEmptyContentArgument(value.patch, "patch"),
    expectedSha256: hashArgument(value.expected_sha256, false)!,
  }
}

function applyExactEdit(content: string, oldText: string, newText: string): string {
  const first = content.indexOf(oldText)
  if (first < 0) throw new WriteArgumentsError("old_text was not found.")
  if (content.indexOf(oldText, first + oldText.length) >= 0) {
    throw new WriteArgumentsError("old_text must identify exactly one occurrence.")
  }
  return `${content.slice(0, first)}${newText}${content.slice(first + oldText.length)}`
}

export function applyUnifiedPatch(content: string, patch: string): string {
  const source = content.split("\n")
  const lines = patch.replaceAll("\r\n", "\n").split("\n")
  const output: string[] = []
  let sourceCursor = 0
  let index = 0
  let hunkCount = 0

  while (index < lines.length) {
    const header = lines[index]!
    if (!header.startsWith("@@")) {
      index += 1
      continue
    }
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header)
    if (!match) throw new WriteArgumentsError("Patch hunk header is invalid.")
    hunkCount += 1
    const oldStart = Number(match[1])
    const oldExpected = Number(match[2] ?? 1)
    const newExpected = Number(match[4] ?? 1)
    const hunkStart = Math.max(0, oldStart - 1)
    if (hunkStart < sourceCursor || hunkStart > source.length) {
      throw new WriteArgumentsError("Patch hunks overlap or exceed the file.")
    }
    output.push(...source.slice(sourceCursor, hunkStart))
    sourceCursor = hunkStart
    index += 1
    let oldCount = 0
    let newCount = 0

    while (index < lines.length && !lines[index]!.startsWith("@@")) {
      const line = lines[index]!
      if (line.startsWith("\\ No newline at end of file")) {
        index += 1
        continue
      }
      const marker = line[0]
      if (marker !== " " && marker !== "+" && marker !== "-") break
      const text = line.slice(1)
      if (marker === " " || marker === "-") {
        if (source[sourceCursor] !== text) {
          throw new WriteArgumentsError("Patch context does not match the current file.")
        }
        sourceCursor += 1
        oldCount += 1
      }
      if (marker === " " || marker === "+") {
        output.push(text)
        newCount += 1
      }
      index += 1
    }
    if (oldCount !== oldExpected || newCount !== newExpected) {
      throw new WriteArgumentsError("Patch hunk line counts are invalid.")
    }
  }

  if (hunkCount === 0) throw new WriteArgumentsError("Patch contains no unified-diff hunks.")
  output.push(...source.slice(sourceCursor))
  return output.join("\n")
}

async function readCurrent(root: string, path: string, maxBytes: number): Promise<Buffer | null> {
  try {
    return await readFileInsideRoot(root, path, { maxBytes })
  } catch (error) {
    if (isMissingError(error)) return null
    throw error
  }
}

async function verifiedRoot(rootPath: string, verifyRoot: (rootPath: string) => string) {
  try {
    return await realpath(verifyRoot(rootPath))
  } catch {
    throw new RegisteredRootError("Registered root is unavailable")
  }
}

function decodeText(content: Buffer): string {
  if (content.includes(0)) throw new WriteArgumentsError("Binary files are not writable.")
  return content.toString("utf8")
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new WriteArgumentsError("Tool arguments contain missing or unknown fields.")
  }
}

function pathArgument(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 4_096 || value.includes("\0")) {
    throw new WriteArgumentsError("path is invalid.")
  }
  const path = value.replaceAll("\\", "/")
  if (path === "." || path.endsWith("/")) throw new WriteArgumentsError("path must target a file.")
  return path
}

function contentArgument(value: unknown, name: string): string {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new WriteArgumentsError(`${name} must be UTF-8 text.`)
  }
  return value
}

function nonEmptyContentArgument(value: unknown, name: string): string {
  const content = contentArgument(value, name)
  if (!content) throw new WriteArgumentsError(`${name} must not be empty.`)
  return content
}

function hashArgument(value: unknown, nullable: boolean): string | null {
  if (nullable && value === null) return null
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new WriteArgumentsError("expected_sha256 must be an exact lowercase SHA-256 hash.")
  }
  return value
}

function approvalDenied(
  tool: LocalModelWriteToolName,
  decision: Exclude<LocalModelWriteApprovalDecision, "approved">,
): LocalModelToolResult {
  const errorCode =
    decision === "denied"
      ? "approval-denied"
      : decision === "timed-out"
        ? "approval-timeout"
        : "approval-cancelled"
  return denied(tool, errorCode, `The project write approval was ${decision}.`)
}

function denied(
  tool: string,
  errorCode: LocalModelToolResult["errorCode"],
  content: string,
): LocalModelToolResult {
  return { ok: false, tool, content, truncated: false, errorCode }
}

function toolSchema(
  name: LocalModelWriteToolName,
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

function boundedBytes(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_FILE_BYTES
  return Math.min(4_000_000, Math.max(1_024, Math.floor(value!)))
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isMissingError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function missingError(): NodeJS.ErrnoException {
  const error = new Error("Project file does not exist") as NodeJS.ErrnoException
  error.code = "ENOENT"
  return error
}

function isStaleError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /stale|changed during content validation|Write target (changed|appeared) during commit/.test(
      error.message,
    )
  )
}

function isPathDeniedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /escapes root|symbolic link|Unsafe|Write (root|parent)|Target parent/.test(error.message)
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}
