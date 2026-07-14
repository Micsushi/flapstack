import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { isAbsolute, resolve } from "node:path"
import { assertRegisteredWorktree } from "../git/security/path-validation"
import type {
  LocalModelNormalizedToolCall,
  LocalModelReadToolExecutor,
  LocalModelToolResult,
  LocalModelToolSchema,
} from "./local-model-read-tools"

export const LOCAL_MODEL_EXEC_TOOL_NAMES = ["shell_exec", "git_exec", "network_fetch"] as const
export type LocalModelExecToolName = (typeof LOCAL_MODEL_EXEC_TOOL_NAMES)[number]
export type LocalModelExecPolicy = "allow" | "ask" | "deny"
export type LocalModelExecApprovalDecision = "approved" | "denied" | "timed-out" | "cancelled"

export const LOCAL_MODEL_EXEC_TOOL_SCHEMAS: readonly LocalModelToolSchema[] = [
  toolSchema(
    "shell_exec",
    "Run one bounded, allowlisted command with argv in the registered project root.",
    {
      command: { type: "string", description: "Allowlisted executable basename." },
      args: { type: "array", items: { type: "string" }, description: "Exact argv entries." },
    },
    ["command", "args"],
  ),
  toolSchema(
    "git_exec",
    "Run one bounded git operation in the registered project root.",
    {
      command: { type: "string", description: "Allowlisted git subcommand." },
      args: { type: "array", items: { type: "string" }, description: "Exact git arguments." },
    },
    ["command", "args"],
  ),
  toolSchema(
    "network_fetch",
    "Fetch one credential-free HTTP(S) URL with GET, no redirects, and bounded output.",
    { url: { type: "string", description: "Absolute uncredentialed HTTP(S) URL." } },
    ["url"],
  ),
]

export type LocalModelExecApprovalRequest = {
  id: string
  runId: string
  chatId: string
  callId: string
  tool: LocalModelExecToolName
  operation: string
  targetHost: string | null
  argumentCount: number
  signal: AbortSignal
}

export type LocalModelExecAuditStatus =
  | "allowed"
  | "dispatch-started"
  | "denied"
  | "approval-required"
  | "timed-out"
  | "failed"
  | "completed"

export type LocalModelExecAuditRecord = {
  id: string
  invocationId: string
  status: LocalModelExecAuditStatus
  runId: string
  chatId: string
  tool: LocalModelExecToolName
  operation: string
  targetHost: string | null
  argumentCount: number
  outputBytes?: number
  truncated?: boolean
  durationMs?: number
}

export type LocalModelCommandRequest = {
  command: string
  args: readonly string[]
  cwd: string
  env: NodeJS.ProcessEnv
  signal: AbortSignal
  timeoutMs: number
  maxOutputBytes: number
}

export type LocalModelCommandResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  outputLimited: boolean
  outputBytes: number
}

export type LocalModelExecToolOptions = {
  rootPath: string
  runId: string
  chatId: string
  shellPolicy: LocalModelExecPolicy
  gitPolicy: LocalModelExecPolicy
  networkPolicy: LocalModelExecPolicy
  verifyRoot?: (rootPath: string) => string
  requestApproval?: (
    request: LocalModelExecApprovalRequest,
  ) => Promise<LocalModelExecApprovalDecision>
  audit?: (record: LocalModelExecAuditRecord) => void | Promise<void>
  runCommand?: (request: LocalModelCommandRequest) => Promise<LocalModelCommandResult>
  fetchImpl?: typeof fetch
  environment?: NodeJS.ProcessEnv
  shellCommands?: readonly string[]
  timeoutMs?: number
  maxOutputBytes?: number
  now?: () => number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_BYTES = 64_000
const DEFAULT_SHELL_COMMANDS = ["find", "head", "ls", "pwd", "rg", "tail", "wc"] as const
const READ_GIT_COMMANDS = new Set(["status", "diff", "log", "show", "rev-parse"])
const WRITE_GIT_COMMANDS = new Set(["restore"])
const SECRET_ENV_KEY =
  /(?:api[-_]?key|authorization|credential|cookie|pass(?:word)?|secret|token|private[-_]?key|session(?:[-_]?id)?|access[-_]?token|refresh[-_]?token)/i
const SAFE_ENV_KEYS = new Set(["HOME", "LANG", "LC_ALL", "PATH", "SHELL", "TMPDIR"])

class ExecArgumentsError extends Error {}
class RootBindingError extends Error {}

export function createBoundedLocalModelExecToolExecutor(
  options: LocalModelExecToolOptions,
): LocalModelReadToolExecutor {
  const verifyRoot = options.verifyRoot ?? ((path) => assertRegisteredWorktree(path).canonicalPath)
  const runCommand = options.runCommand ?? runBoundedCommand
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 120_000)
  const maxOutputBytes = boundedInteger(
    options.maxOutputBytes,
    DEFAULT_MAX_OUTPUT_BYTES,
    1_024,
    1_000_000,
  )
  const shellCommands = new Set(options.shellCommands ?? DEFAULT_SHELL_COMMANDS)
  const environment = options.environment ?? process.env
  const safeEnvironment = filterEnvironment(environment)
  const secretValues = secretEnvironmentValues(environment)
  const now = options.now ?? Date.now

  return {
    redactInput(call) {
      return redactExecInput(call, shellCommands)
    },
    async execute(call, signal) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError")
      if (!LOCAL_MODEL_EXEC_TOOL_NAMES.includes(call.name as LocalModelExecToolName)) {
        return denied(call.name, "unknown-tool", "Unknown execution tool.")
      }

      const tool = call.name as LocalModelExecToolName
      const startedAt = now()
      let parsed: ParsedExecCall
      try {
        parsed = parseExecCall(tool, call.arguments, shellCommands)
      } catch (error) {
        const result = denied(
          tool,
          "invalid-tool-arguments",
          error instanceof ExecArgumentsError ? error.message : "Invalid execution arguments.",
        )
        await appendAudit(options, auditBase(call, tool, "invalid", null), "denied", startedAt, now)
        return result
      }

      const audit = auditBase(call, tool, parsed.operation, parsed.targetHost)
      const policy = policyFor(tool, parsed.gitMutates, options)
      if (policy === "deny") {
        await appendAudit(options, audit, "denied", startedAt, now)
        return denied(tool, "permission-denied", `${tierName(tool)} capability is not authorized.`)
      }

      if (policy === "ask") {
        await appendAudit(options, audit, "approval-required", startedAt, now)
        if (!options.requestApproval) {
          await appendAudit(options, audit, "denied", startedAt, now)
          return denied(tool, "approval-cancelled", "No approval bridge is available.")
        }
        const decision = await options.requestApproval({
          id: randomUUID(),
          runId: options.runId,
          chatId: options.chatId,
          callId: call.id,
          tool,
          operation: parsed.operation,
          targetHost: parsed.targetHost,
          argumentCount: parsed.argumentCount,
          signal,
        })
        if (decision !== "approved") {
          await appendAudit(
            options,
            audit,
            decision === "timed-out" ? "timed-out" : "denied",
            startedAt,
            now,
          )
          return approvalDenied(tool, decision)
        }
      }

      await appendAudit(options, audit, "allowed", startedAt, now)
      let root: string
      try {
        root = verifiedRoot(options.rootPath, verifyRoot)
      } catch {
        await appendAudit(options, audit, "denied", startedAt, now)
        return denied(tool, "unregistered-root", "The registered project root is unavailable.")
      }
      if (signal.aborted) throw new DOMException("Aborted", "AbortError")
      await appendAudit(options, audit, "dispatch-started", startedAt, now)

      try {
        const result =
          tool === "network_fetch"
            ? await executeNetworkFetch(
                parsed,
                options.fetchImpl ?? fetch,
                signal,
                timeoutMs,
                maxOutputBytes,
                secretValues,
              )
            : await executeCommand(
                parsed,
                root,
                safeEnvironment,
                runCommand,
                signal,
                timeoutMs,
                maxOutputBytes,
                secretValues,
              )
        await appendAudit(
          options,
          { ...audit, outputBytes: result.outputBytes, truncated: result.truncated },
          result.auditStatus,
          startedAt,
          now,
        )
        return result.value
      } catch (error) {
        if (isAbortError(error)) throw error
        await appendAudit(options, audit, "failed", startedAt, now)
        return denied(tool, "tool-failed", "The bounded execution tool failed safely.")
      }
    },
  }
}

type ParsedExecCall = {
  tool: LocalModelExecToolName
  operation: string
  args: string[]
  targetHost: string | null
  argumentCount: number
  gitMutates: boolean
  url?: URL
}

type ExecutionResult = {
  value: LocalModelToolResult
  auditStatus: "completed" | "failed" | "timed-out"
  outputBytes: number
  truncated: boolean
}

function parseExecCall(
  tool: LocalModelExecToolName,
  value: unknown,
  shellCommands: ReadonlySet<string>,
): ParsedExecCall {
  const input = exactRecord(value, tool === "network_fetch" ? ["url"] : ["command", "args"])
  if (tool === "network_fetch") {
    const requested = stringValue(input.url, "url", 4_096)
    let url: URL
    try {
      url = new URL(requested)
    } catch {
      throw new ExecArgumentsError("url must be an absolute HTTP(S) URL.")
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname ||
      [...url.searchParams.keys()].some((key) => SECRET_ENV_KEY.test(key))
    ) {
      throw new ExecArgumentsError("Network URLs must be credential-free HTTP(S) URLs.")
    }
    return {
      tool,
      operation: "get",
      args: [],
      targetHost: url.hostname.toLowerCase(),
      argumentCount: 0,
      gitMutates: false,
      url,
    }
  }

  const command = stringValue(input.command, "command", 64)
  if (!/^[a-zA-Z0-9._-]+$/.test(command)) {
    throw new ExecArgumentsError("command must be an executable basename.")
  }
  const args = stringArray(input.args)
  if (args.length > 64) throw new ExecArgumentsError("At most 64 arguments are allowed.")
  if (tool === "shell_exec") {
    if (!shellCommands.has(command))
      throw new ExecArgumentsError("Shell command is not allowlisted.")
    validateShellArguments(command, args)
    return {
      tool,
      operation: command,
      args,
      targetHost: null,
      argumentCount: args.length,
      gitMutates: false,
    }
  }

  if (!READ_GIT_COMMANDS.has(command) && !WRITE_GIT_COMMANDS.has(command)) {
    throw new ExecArgumentsError("Git command is not allowlisted.")
  }
  validateGitArguments(command, args)
  return {
    tool,
    operation: command,
    args,
    targetHost: null,
    argumentCount: args.length,
    gitMutates: WRITE_GIT_COMMANDS.has(command),
  }
}

function validateGitArguments(command: string, args: readonly string[]): void {
  if (args.some((arg) => arg.includes("\0") || arg.length > 4_096)) {
    throw new ExecArgumentsError("Git arguments are invalid.")
  }
  if (command === "restore" && !args.includes("--staged")) {
    throw new ExecArgumentsError("git restore is limited to --staged index changes.")
  }
  if (
    args.some(
      (arg) =>
        isExternalPathArgument(arg) ||
        /^--(?:exec-path|ext-diff|git-dir|output|upload-pack|work-tree)(?:=|$)/.test(arg) ||
        arg === "-c" ||
        arg === "--config-env" ||
        arg === "--no-index",
    )
  ) {
    throw new ExecArgumentsError("Git argument can escape the bounded project operation.")
  }
  if (command === "restore") {
    for (const arg of args) {
      if (
        arg === "--" ||
        arg === "--staged" ||
        arg === "-A" ||
        arg === "--all" ||
        arg === "-u" ||
        arg === "--update"
      ) {
        continue
      }
      if (arg.startsWith("-")) throw new ExecArgumentsError("Git mutation flag is not allowlisted.")
      if (resolve("/root", arg) !== "/root" && !resolve("/root", arg).startsWith("/root/")) {
        throw new ExecArgumentsError("Git mutation path must stay relative to the project.")
      }
    }
  }
}

function validateShellArguments(command: string, args: readonly string[]): void {
  if (args.some(isExternalPathArgument)) {
    throw new ExecArgumentsError("Shell arguments must stay inside the registered project.")
  }
  if (command === "pwd" && args.length > 0) {
    throw new ExecArgumentsError("pwd does not accept arguments.")
  }
  if (
    command === "find" &&
    args.some((arg) =>
      [
        "-delete",
        "-exec",
        "-execdir",
        "-fls",
        "-fprint",
        "-fprint0",
        "-fprintf",
        "-ok",
        "-okdir",
      ].includes(arg),
    )
  ) {
    throw new ExecArgumentsError("Mutating or command-running find actions are not allowed.")
  }
  if (command === "rg" && args.some((arg) => arg === "--pre" || arg.startsWith("--pre="))) {
    throw new ExecArgumentsError("rg preprocessors are not allowed.")
  }
}

function isExternalPathArgument(arg: string): boolean {
  return arg.startsWith("/") || /^[A-Za-z]:[\\/]/.test(arg) || arg.split(/[\\/]/).includes("..")
}

async function executeCommand(
  parsed: ParsedExecCall,
  root: string,
  env: NodeJS.ProcessEnv,
  runner: (request: LocalModelCommandRequest) => Promise<LocalModelCommandResult>,
  signal: AbortSignal,
  timeoutMs: number,
  maxOutputBytes: number,
  secretValues: readonly string[],
): Promise<ExecutionResult> {
  const gitOperationArgs = ["diff", "log", "show"].includes(parsed.operation)
    ? [parsed.operation, "--no-ext-diff", "--no-textconv", ...parsed.args]
    : [parsed.operation, ...parsed.args]
  const gitArgs =
    parsed.tool === "git_exec"
      ? [
          "-c",
          "core.fsmonitor=false",
          "-c",
          "core.pager=cat",
          "-c",
          "credential.helper=",
          "-c",
          "diff.external=",
          "-c",
          "pager.diff=false",
          ...gitOperationArgs,
        ]
      : parsed.args
  const result = await runner({
    command: parsed.tool === "git_exec" ? "git" : parsed.operation,
    args: gitArgs,
    cwd: root,
    env,
    signal,
    timeoutMs,
    maxOutputBytes,
  })
  const content = scrubSecrets(
    [result.stdout, result.stderr].filter(Boolean).join(result.stderr ? "\n" : ""),
    [...secretValues, ...parsed.args],
  )
  if (result.timedOut) {
    return {
      value: denied(parsed.tool, "command-timeout", "The bounded command timed out."),
      auditStatus: "timed-out",
      outputBytes: result.outputBytes,
      truncated: result.outputLimited,
    }
  }
  if (result.outputLimited) {
    return {
      value: denied(parsed.tool, "output-limit", "The bounded command exceeded its output cap."),
      auditStatus: "failed",
      outputBytes: result.outputBytes,
      truncated: true,
    }
  }
  return {
    value: {
      ok: result.exitCode === 0,
      tool: parsed.tool,
      content: content || `Process exited with code ${result.exitCode ?? "unknown"}.`,
      truncated: false,
      ...(result.exitCode === 0 ? {} : { errorCode: "tool-failed" as const }),
    },
    auditStatus: result.exitCode === 0 ? "completed" : "failed",
    outputBytes: result.outputBytes,
    truncated: false,
  }
}

async function executeNetworkFetch(
  parsed: ParsedExecCall,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  timeoutMs: number,
  maxOutputBytes: number,
  secretValues: readonly string[],
): Promise<ExecutionResult> {
  const controller = new AbortController()
  let timedOut = false
  const cancel = () => controller.abort()
  signal.addEventListener("abort", cancel, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    const response = await fetchImpl(parsed.url!, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "text/plain, application/json;q=0.9, */*;q=0.1" },
      signal: controller.signal,
    })
    if (response.status >= 300 && response.status < 400) {
      return failedNetwork(parsed.tool, "Network redirects are not followed.")
    }
    const body = await readBoundedResponse(response, maxOutputBytes, controller)
    if (body.limited) {
      return {
        value: denied(parsed.tool, "output-limit", "The network response exceeded its output cap."),
        auditStatus: "failed",
        outputBytes: body.bytes,
        truncated: true,
      }
    }
    const preview = scrubSecrets(new TextDecoder().decode(body.data), secretValues)
    return {
      value: {
        ok: response.ok,
        tool: parsed.tool,
        content: preview || `HTTP ${response.status}`,
        truncated: false,
        ...(response.ok ? {} : { errorCode: "tool-failed" as const }),
      },
      auditStatus: response.ok ? "completed" : "failed",
      outputBytes: body.bytes,
      truncated: false,
    }
  } catch (error) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError")
    if (timedOut) {
      return {
        value: denied(parsed.tool, "command-timeout", "The network request timed out."),
        auditStatus: "timed-out",
        outputBytes: 0,
        truncated: false,
      }
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", cancel)
  }
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
  controller: AbortController,
): Promise<{ data: Uint8Array; bytes: number; limited: boolean }> {
  if (!response.body) return { data: new Uint8Array(), bytes: 0, limited: false }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      bytes += item.value.byteLength
      if (bytes > maxBytes) {
        controller.abort()
        return { data: new Uint8Array(), bytes, limited: true }
      }
      chunks.push(item.value)
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }
  const data = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { data, bytes, limited: false }
}

export function runBoundedCommand(
  request: LocalModelCommandRequest,
): Promise<LocalModelCommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: request.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    const chunks: Buffer[] = []
    let outputBytes = 0
    let timedOut = false
    let outputLimited = false
    let settled = false
    const stop = () => child.kill("SIGKILL")
    const abort = () => stop()
    request.signal.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, request.timeoutMs)
    const capture = (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > request.maxOutputBytes) {
        outputLimited = true
        stop()
        return
      }
      chunks.push(Buffer.from(chunk))
    }
    child.stdout.on("data", capture)
    child.stderr.on("data", capture)
    child.once("error", (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
    child.once("close", (exitCode) => {
      if (settled) return
      settled = true
      cleanup()
      if (request.signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"))
        return
      }
      const output = Buffer.concat(chunks).toString("utf8")
      resolveResult({
        exitCode,
        stdout: output,
        stderr: "",
        timedOut,
        outputLimited,
        outputBytes,
      })
    })
    function cleanup() {
      clearTimeout(timer)
      request.signal.removeEventListener("abort", abort)
    }
  })
}

function policyFor(
  tool: LocalModelExecToolName,
  gitMutates: boolean,
  options: LocalModelExecToolOptions,
): LocalModelExecPolicy {
  if (tool === "shell_exec") return options.shellPolicy
  if (tool === "network_fetch") return options.networkPolicy
  if (options.gitPolicy === "deny") return "deny"
  return gitMutates ? options.gitPolicy : "allow"
}

function filterEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(environment).filter(
        ([key, value]) =>
          SAFE_ENV_KEYS.has(key) && !SECRET_ENV_KEY.test(key) && value !== undefined,
      ),
    ),
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_EXTERNAL_DIFF: "",
    GIT_PAGER: "cat",
  }
}

function secretEnvironmentValues(environment: NodeJS.ProcessEnv): string[] {
  return Object.entries(environment)
    .filter(([key, value]) => SECRET_ENV_KEY.test(key) && Boolean(value) && value!.length >= 4)
    .map(([, value]) => value!)
}

function scrubSecrets(value: string, secrets: readonly string[]): string {
  let output = value
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(
      /^.*(?:api[-_ ]?key|authorization|credential|cookie|password|private[-_ ]?key|secret|token).*$/gim,
      "[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(api[-_]?key|authorization|credential|cookie|password|secret|token)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
  for (const secret of secrets) {
    if (secret.length >= 4) output = output.split(secret).join("[REDACTED]")
  }
  return output
}

function redactExecInput(
  call: LocalModelNormalizedToolCall,
  shellCommands: ReadonlySet<string>,
): unknown {
  if (!LOCAL_MODEL_EXEC_TOOL_NAMES.includes(call.name as LocalModelExecToolName)) return null
  if (!call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) {
    return { valid: false }
  }
  const input = call.arguments as Record<string, unknown>
  if (call.name === "network_fetch") {
    try {
      const url = new URL(typeof input.url === "string" ? input.url : "")
      return { method: "GET", host: url.hostname || null }
    } catch {
      return { method: "GET", host: null }
    }
  }
  const command = typeof input.command === "string" ? input.command : null
  const commandAllowed =
    command !== null &&
    (call.name === "shell_exec"
      ? shellCommands.has(command)
      : READ_GIT_COMMANDS.has(command) || WRITE_GIT_COMMANDS.has(command))
  return {
    command: commandAllowed ? command : null,
    argumentCount: Array.isArray(input.args) ? input.args.length : null,
  }
}

function auditBase(
  call: LocalModelNormalizedToolCall,
  tool: LocalModelExecToolName,
  operation: string,
  targetHost: string | null,
): Omit<LocalModelExecAuditRecord, "status" | "runId" | "chatId"> {
  const args =
    call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments)
      ? (call.arguments as Record<string, unknown>).args
      : null
  return {
    id: randomUUID(),
    invocationId: call.id,
    tool,
    operation,
    targetHost,
    argumentCount: Array.isArray(args) ? args.length : 0,
  }
}

async function appendAudit(
  options: LocalModelExecToolOptions,
  base: Omit<LocalModelExecAuditRecord, "status" | "runId" | "chatId">,
  status: LocalModelExecAuditStatus,
  startedAt: number,
  now: () => number,
): Promise<void> {
  await options.audit?.({
    ...base,
    id: randomUUID(),
    status,
    runId: options.runId,
    chatId: options.chatId,
    durationMs: Math.max(0, now() - startedAt),
  })
}

function approvalDenied(
  tool: LocalModelExecToolName,
  decision: Exclude<LocalModelExecApprovalDecision, "approved">,
): LocalModelToolResult {
  const errorCode =
    decision === "denied"
      ? "approval-denied"
      : decision === "timed-out"
        ? "approval-timeout"
        : "approval-cancelled"
  return denied(tool, errorCode, `The execution approval was ${decision}.`)
}

function failedNetwork(tool: LocalModelExecToolName, content: string): ExecutionResult {
  return {
    value: denied(tool, "network-denied", content),
    auditStatus: "failed",
    outputBytes: 0,
    truncated: false,
  }
}

function denied(
  tool: string,
  errorCode: LocalModelToolResult["errorCode"],
  content: string,
): LocalModelToolResult {
  return { ok: false, tool, content, truncated: false, errorCode }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExecArgumentsError("Tool arguments must be an object.")
  }
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).length !== keys.length ||
    Object.keys(record).some((key) => !keys.includes(key))
  ) {
    throw new ExecArgumentsError("Tool arguments contain missing or unknown fields.")
  }
  return record
}

function stringValue(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value || value.includes("\0") || value.length > maxLength) {
    throw new ExecArgumentsError(`${name} is invalid.`)
  }
  return value
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ExecArgumentsError("args must be an array of strings.")
  }
  return value.map((item) => stringValue(item, "argument", 4_096))
}

function verifiedRoot(rootPath: string, verifyRoot: (rootPath: string) => string): string {
  const canonical = verifyRoot(rootPath)
  if (!canonical || !isAbsolute(canonical)) throw new RootBindingError()
  return resolve(canonical)
}

function tierName(tool: LocalModelExecToolName): string {
  if (tool === "shell_exec") return "Shell"
  if (tool === "git_exec") return "Git"
  return "Network"
}

function toolSchema(
  name: LocalModelExecToolName,
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

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value!)))
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  )
}
