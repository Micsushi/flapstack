import { createACPProvider, type ACPProvider } from "@mcpc-tech/acp-ai-provider"
import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import { observable } from "@trpc/server/observable"
import { streamText } from "ai"
import { and, eq, isNull, ne } from "drizzle-orm"
import { app } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, delimiter, dirname, join, sep } from "node:path"
import { z } from "zod"
import {
  normalizeCodexAssistantMessage,
  normalizeCodexStreamChunk,
} from "../../../../shared/codex-tool-normalizer"
import {
  DEFAULT_CHATGPT_CODEX_MODEL_WITH_REASONING,
  DEFAULT_CODEX_MODEL_WITH_REASONING,
  formatCodexModelForAcp,
} from "../../../../shared/model-catalog"
import { captureCheckpoint, captureNoChangeManifest } from "../../checkpoints"
import { getClaudeShellEnvironment } from "../../claude/env"
import { resolveProjectPathFromWorktree } from "../../claude-config"
import {
  appendUniqueReasoningOutputParts,
  codexReasoningEventsToParts,
  extractLatestCodexReasoningEvents,
} from "../../codex/reasoning"
import { resolveCodexStdioLaunch } from "../../codex/mcp-stdio"
import {
  allowCodexPermissionRequest,
  createCodexPermissionDecision,
  rejectCodexPermissionRequest,
  registerPendingCodexPermissionRequest,
  removePendingCodexPermissionRequest,
  replyPendingCodexPermissionRequest,
  rejectPendingCodexPermissionRequests,
} from "../../codex/permission-bridge"
import {
  agentRuns,
  chats,
  getDatabase,
  getDatabasePath,
  projects as projectsTable,
  subChats,
} from "../../db"
import { CODEX_TRANSPORT_DECISION } from "../../harness/codex-transport-decision"
import {
  buildHarnessContextBundle,
  getLastHarnessContextFingerprint,
  prependStartupContext,
} from "../../harness/launch-context"
import { getChatMcpExposure, registerActiveProductMcpSession } from "../../mcp-control/exposure"
import {
  buildMcpStdioRegistration,
  FLAPSTACK_MCP_SERVER_NAME,
  renameProductMcpServerCollisions,
} from "../../mcp-control/registration"
import { resolveProviderMcpPermission } from "../../mcp-control/provider-permissions"
import { fetchMcpTools, fetchMcpToolsStdio, type McpToolInfo } from "../../mcp-auth"
import { mergeMessagesPreservingSpokenText } from "../../speech/history"
import {
  buildCodexPermissionApplication,
  getGlobalDefault,
  isCustomToolAllowed,
  mapCodexAcpModeId,
  parseCustomPermissionToggles,
  parsePermissionMode,
  type PermissionMode,
} from "../../permissions"
import { updateSubChatRunStatusIfAuthoritative } from "../../run-status-authority"
import { publicProcedure, router } from "../index"
import { getCredentialService } from "../../credential-service"
import { projectVaultSectionIds } from "../../project-vaults/registry"
import {
  buildProjectVaultRunContext,
  persistProjectVaultContextManifest,
  ProjectVaultContextRejectedError,
} from "../../project-vaults/run-context"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

function parseCustomPermissionTogglesJson(value: string | null) {
  if (!value) return null
  try {
    return parseCustomPermissionToggles(JSON.parse(value))
  } catch {
    return null
  }
}

type CodexProviderSession = {
  provider: ACPProvider
  cwd: string
  authFingerprint: string | null
  mcpFingerprint: string
  reasoningEnabled: boolean
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" | null
}

type CodexLoginSessionState = "running" | "success" | "error" | "cancelled"

type CodexLoginSession = {
  id: string
  process: ChildProcess | null
  state: CodexLoginSessionState
  output: string
  url: string | null
  error: string | null
  exitCode: number | null
}

type CodexIntegrationState = "connected_chatgpt" | "connected_api_key" | "not_logged_in" | "unknown"

type CodexMcpServerForSession =
  | {
      name: string
      type: "stdio"
      command: string
      args: string[]
      env: Array<{ name: string; value: string }>
    }
  | {
      name: string
      type: "http"
      url: string
      headers: Array<{ name: string; value: string }>
    }

type CodexMcpServerForSettings = {
  name: string
  status: "connected" | "failed" | "pending" | "needs-auth"
  tools: McpToolInfo[]
  needsAuth: boolean
  config: Record<string, unknown>
  serverInfo?: { name: string; version: string; icons?: Array<{ src: string }> }
  error?: string
}

type CodexMcpSnapshot = {
  mcpServersForSession: CodexMcpServerForSession[]
  groups: Array<{
    groupName: string
    projectPath: string | null
    mcpServers: CodexMcpServerForSettings[]
  }>
  fingerprint: string
  fetchedAt: number
  toolsResolved: boolean
}

const providerSessions = new Map<string, CodexProviderSession>()
type ActiveCodexStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

const activeStreams = new Map<string, ActiveCodexStream>()
type CodexPermissionHandler = (
  request: RequestPermissionRequest,
) => Promise<RequestPermissionResponse>
const codexPermissionHandlers = new Map<string, { runId: string; handle: CodexPermissionHandler }>()

/** Check if there are any active Codex streaming sessions */
export function hasActiveCodexStreams(): boolean {
  return activeStreams.size > 0
}

/** Abort all active Codex streams so their cleanup saves partial state */
export function abortAllCodexStreams(): void {
  for (const [subChatId, stream] of activeStreams) {
    console.log(`[codex] Aborting stream ${subChatId} before reload`)
    stream.controller.abort()
  }
  // Keep ownership until each async finalizer persists cancellation and removes
  // its own entry. App shutdown waits for that durable boundary before DB close.
}

export function cancelActiveCodexRun(input: { subChatId: string; runId: string }): {
  cancelled: boolean
  ignoredStale: boolean
} {
  const activeStream = activeStreams.get(input.subChatId)
  if (!activeStream) return { cancelled: false, ignoredStale: false }
  if (activeStream.runId !== input.runId) return { cancelled: false, ignoredStale: true }
  activeStream.cancelRequested = true
  activeStream.controller.abort()
  rejectPendingCodexPermissionRequests(input.subChatId, input.runId)
  return { cancelled: true, ignoredStale: false }
}

const loginSessions = new Map<string, CodexLoginSession>()
const codexMcpCache = new Map<string, CodexMcpSnapshot>()

const URL_CANDIDATE_REGEX = /https?:\/\/[^\s]+/g
const ANSI_ESCAPE_REGEX = /\u001B\[[0-?]*[ -/]*[@-~]/g
const ANSI_OSC_REGEX = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g

const AUTH_HINTS = [
  "not logged in",
  "authentication required",
  "auth required",
  "login required",
  "missing credentials",
  "no credentials",
  "unauthorized",
  "forbidden",
  "codex login",
  "401",
  "403",
]
const DEFAULT_CODEX_MODEL = DEFAULT_CODEX_MODEL_WITH_REASONING
const CODEX_MCP_TOOLS_FETCH_TIMEOUT_MS = 40_000
const CODEX_USAGE_POLL_ATTEMPTS = 3
const CODEX_USAGE_POLL_INTERVAL_MS = 200

type CodexTokenUsage = {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
}

type CodexTokenCountInfo = {
  last_token_usage?: CodexTokenUsage
  model_context_window?: number
}

type CodexUsageMetadata = {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  modelContextWindow?: number
}

type CodexRunStatus = "success" | "failure" | "cancelled"

const codexMcpListEntrySchema = z
  .object({
    name: z.string(),
    enabled: z.boolean(),
    disabled_reason: z.string().nullable().optional(),
    transport: z
      .object({
        type: z.string(),
        command: z.string().nullable().optional(),
        args: z.array(z.string()).nullable().optional(),
        env: z.record(z.string()).nullable().optional(),
        env_vars: z.array(z.string()).nullable().optional(),
        cwd: z.string().nullable().optional(),
        url: z.string().nullable().optional(),
        bearer_token_env_var: z.string().nullable().optional(),
        http_headers: z.record(z.string()).nullable().optional(),
        env_http_headers: z.record(z.string()).nullable().optional(),
      })
      .passthrough(),
    auth_status: z.string().nullable().optional(),
  })
  .passthrough()

type CodexMcpListEntry = z.infer<typeof codexMcpListEntrySchema>

function toUnpackedAsarPath(filePath: string): string {
  const unpackedPath = filePath.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)

  if (unpackedPath !== filePath && existsSync(unpackedPath)) {
    return unpackedPath
  }

  return filePath
}

function resolveCodexAcpBinaryPath(): string {
  const codexPackageRoot = dirname(require.resolve("@agentclientprotocol/codex-acp/package.json"))
  const resolvedPath = require.resolve("@agentclientprotocol/codex-acp/dist/index.js", {
    // Resolve relative to the wrapper package so nested optional deps work in packaged apps.
    paths: [codexPackageRoot],
  })

  return toUnpackedAsarPath(resolvedPath)
}

function resolveBundledCodexCliPath(): string {
  const binaryName = process.platform === "win32" ? "codex.exe" : "codex"
  const resourcesDir = app.isPackaged
    ? join(process.resourcesPath, "bin")
    : join(app.getAppPath(), "resources", "bin", `${process.platform}-${process.arch}`)

  const binaryPath = join(resourcesDir, binaryName)
  if (existsSync(binaryPath)) {
    return binaryPath
  }

  // Local dev may use the user's installed, macOS-approved Codex binary. This
  // avoids downloading stale pinned binaries solely for development. Packaged
  // releases still fail closed unless their verified bundled binary exists.
  if (!app.isPackaged) {
    for (const directory of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
      const installedPath = join(directory, binaryName)
      if (existsSync(installedPath)) return installedPath
    }
  }

  const hint = app.isPackaged
    ? "Binary is missing from bundled resources."
    : "Install Codex on PATH for local dev."

  throw new Error(`[codex] Bundled Codex CLI not found at ${binaryPath}. ${hint}`)
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_OSC_REGEX, "").replace(ANSI_ESCAPE_REGEX, "")
}

function isLocalhostHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".localhost")
  )
}

function extractFirstNonLocalhostUrl(output: string): string | null {
  const matches = stripAnsi(output).match(URL_CANDIDATE_REGEX)
  if (!matches) return null

  for (const match of matches) {
    try {
      const parsedUrl = new URL(match.trim().replace(/[),.;!?]+$/, ""))
      if (!isLocalhostHostname(parsedUrl.hostname)) {
        return parsedUrl.toString()
      }
    } catch {
      // Ignore invalid URL candidates.
    }
  }

  return null
}

function appendLoginOutput(session: CodexLoginSession, chunk: string): void {
  const cleanChunk = stripAnsi(chunk)
  if (!cleanChunk) return

  session.output += cleanChunk

  if (!session.url) {
    session.url = extractFirstNonLocalhostUrl(session.output)
  }
}

function toLoginSessionResponse(session: CodexLoginSession) {
  return {
    sessionId: session.id,
    state: session.state,
    url: session.url,
    output: session.output,
    error: session.error,
    exitCode: session.exitCode,
  }
}

function getActiveLoginSession(): CodexLoginSession | null {
  for (const session of loginSessions.values()) {
    if (session.state === "running" && session.process && !session.process.killed) {
      return session
    }
  }

  return null
}

function extractCodexError(error: unknown): { message: string; code?: string } {
  const anyError = error as any
  const message =
    anyError?.data?.message ||
    anyError?.errorText ||
    anyError?.message ||
    anyError?.error ||
    String(error)
  const code = anyError?.data?.code || anyError?.code

  return {
    message: typeof message === "string" ? message : String(message),
    code: typeof code === "string" ? code : undefined,
  }
}

function isCodexAuthError(params: { message?: string | null; code?: string | null }): boolean {
  const searchableText = `${params.code || ""} ${params.message || ""}`.toLowerCase()
  return AUTH_HINTS.some((hint) => searchableText.includes(hint))
}

type RunCodexCliOptions = {
  cwd?: string
}

async function runCodexCli(
  args: string[],
  options?: RunCodexCliOptions,
): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
}> {
  const codexCliPath = resolveBundledCodexCliPath()
  const cwd = options?.cwd?.trim()

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(codexCliPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: cwd && cwd.length > 0 ? cwd : undefined,
      env: process.env,
      windowsHide: true,
    })

    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8")
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
    })

    child.once("error", (error) => {
      rejectPromise(
        new Error(`[codex] Failed to execute \`codex ${args.join(" ")}\`: ${error.message}`),
      )
    })

    child.once("close", (exitCode) => {
      resolvePromise({
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
        exitCode,
      })
    })
  })
}

async function runCodexCliChecked(
  args: string[],
  options?: RunCodexCliOptions,
): Promise<{
  stdout: string
  stderr: string
}> {
  const result = await runCodexCli(args, options)
  if (result.exitCode === 0) {
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }

  const message =
    result.stderr.trim() ||
    result.stdout.trim() ||
    `Codex command failed with exit code ${result.exitCode ?? "unknown"}`
  throw new Error(message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function toNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined
  }
  return Math.trunc(value)
}

function toTimestampMs(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return undefined
  }
  return parsed
}

function resolveSessionsRoot(): string {
  // Match provider env precedence: shell-derived env overrides process.env.
  const shellCodexHome = getClaudeShellEnvironment().CODEX_HOME?.trim()
  if (shellCodexHome) {
    return join(shellCodexHome, "sessions")
  }

  const processCodexHome = process.env.CODEX_HOME?.trim()
  if (processCodexHome) {
    return join(processCodexHome, "sessions")
  }

  return join(homedir(), ".codex", "sessions")
}

async function findSessionFileById(sessionId: string): Promise<string | null> {
  const sessionsRoot = resolveSessionsRoot()
  const fileSuffix = `-${sessionId}.jsonl`
  const sortDesc = (values: string[]) =>
    values.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  const listNames = async (dirPath: string): Promise<string[]> => {
    try {
      return await readdir(dirPath, { encoding: "utf8" })
    } catch {
      return []
    }
  }
  const years = sortDesc((await listNames(sessionsRoot)).filter((name) => /^\d{4}$/.test(name)))

  for (const year of years) {
    const yearPath = join(sessionsRoot, year)
    const months = sortDesc((await listNames(yearPath)).filter((name) => /^\d{2}$/.test(name)))
    for (const month of months) {
      const monthPath = join(yearPath, month)
      const days = sortDesc((await listNames(monthPath)).filter((name) => /^\d{2}$/.test(name)))
      for (const day of days) {
        const dayPath = join(monthPath, day)
        const fileName = (await listNames(dayPath)).find((name) => name.endsWith(fileSuffix))
        if (fileName) {
          return join(dayPath, fileName)
        }
      }
    }
  }

  return null
}

async function readLatestTokenCountInfo(
  filePath: string,
  options?: { notBeforeTimestampMs?: number },
): Promise<CodexTokenCountInfo | null> {
  let rawContent = ""
  try {
    rawContent = await readFile(filePath, "utf8")
  } catch {
    return null
  }

  const lines = rawContent.split("\n")
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const rawLine = lines[index]?.trim()
    if (!rawLine) continue

    let parsedLine: any
    try {
      parsedLine = JSON.parse(rawLine)
    } catch {
      continue
    }

    if (parsedLine?.type !== "event_msg" || parsedLine?.payload?.type !== "token_count") {
      continue
    }

    const eventTimestampMs = toTimestampMs(parsedLine?.timestamp)
    const notBeforeTimestampMs = options?.notBeforeTimestampMs
    if (
      notBeforeTimestampMs !== undefined &&
      (eventTimestampMs === undefined || eventTimestampMs < notBeforeTimestampMs)
    ) {
      continue
    }

    const rawInfo = parsedLine.payload?.info
    if (!rawInfo || typeof rawInfo !== "object") continue

    const rawTokenUsage = (rawInfo as any).last_token_usage
    let lastTokenUsage: CodexTokenUsage | undefined
    if (rawTokenUsage && typeof rawTokenUsage === "object") {
      const tokenUsage = rawTokenUsage as any
      const parsedTokenUsage: CodexTokenUsage = {
        input_tokens: toNonNegativeInt(tokenUsage.input_tokens),
        cached_input_tokens: toNonNegativeInt(tokenUsage.cached_input_tokens),
        output_tokens: toNonNegativeInt(tokenUsage.output_tokens),
        reasoning_output_tokens: toNonNegativeInt(tokenUsage.reasoning_output_tokens),
        total_tokens: toNonNegativeInt(tokenUsage.total_tokens),
      }
      if (Object.values(parsedTokenUsage).some((tokenCount) => tokenCount !== undefined)) {
        lastTokenUsage = parsedTokenUsage
      }
    }

    const modelContextWindow = toNonNegativeInt((rawInfo as any).model_context_window)

    const info: CodexTokenCountInfo = {
      last_token_usage: lastTokenUsage,
      model_context_window: modelContextWindow,
    }
    if (!info.last_token_usage && info.model_context_window === undefined) continue

    return info
  }

  return null
}

function mapToUsageMetadata(info: CodexTokenCountInfo): CodexUsageMetadata | null {
  const perMessageUsage = info.last_token_usage

  if (!perMessageUsage && info.model_context_window === undefined) {
    return null
  }

  const inputTokens =
    perMessageUsage?.input_tokens !== undefined
      ? Math.max(0, perMessageUsage.input_tokens - (perMessageUsage.cached_input_tokens ?? 0))
      : undefined
  const outputTokens = perMessageUsage?.output_tokens
  const reasoningTokens = perMessageUsage?.reasoning_output_tokens
  const totalTokens =
    perMessageUsage?.total_tokens ??
    (perMessageUsage?.input_tokens !== undefined || perMessageUsage?.output_tokens !== undefined
      ? (perMessageUsage?.input_tokens ?? 0) + (perMessageUsage?.output_tokens ?? 0)
      : undefined)

  const usageMetadata: CodexUsageMetadata = {}
  if (inputTokens !== undefined) usageMetadata.inputTokens = inputTokens
  if (outputTokens !== undefined) usageMetadata.outputTokens = outputTokens
  if (reasoningTokens !== undefined) usageMetadata.reasoningTokens = reasoningTokens
  if (totalTokens !== undefined) usageMetadata.totalTokens = totalTokens
  if (info.model_context_window !== undefined) {
    usageMetadata.modelContextWindow = info.model_context_window
  }

  return Object.keys(usageMetadata).length > 0 ? usageMetadata : null
}

async function pollUsage(
  sessionId: string,
  options?: { notBeforeTimestampMs?: number },
): Promise<CodexUsageMetadata | null> {
  let sessionFilePath: string | null = null

  for (let attempt = 0; attempt < CODEX_USAGE_POLL_ATTEMPTS; attempt += 1) {
    if (!sessionFilePath) {
      sessionFilePath = await findSessionFileById(sessionId)
    }

    if (sessionFilePath) {
      const latestInfo = await readLatestTokenCountInfo(sessionFilePath, options)
      if (latestInfo) {
        const usageMetadata = mapToUsageMetadata(latestInfo)
        if (usageMetadata) {
          return usageMetadata
        }
      }
    }

    if (attempt < CODEX_USAGE_POLL_ATTEMPTS - 1) {
      await sleep(CODEX_USAGE_POLL_INTERVAL_MS)
    }
  }

  return null
}

async function pollCodexReasoning(sessionId: string, options?: { notBeforeTimestampMs?: number }) {
  let sessionFilePath: string | null = null

  for (let attempt = 0; attempt < CODEX_USAGE_POLL_ATTEMPTS; attempt += 1) {
    if (!sessionFilePath) {
      sessionFilePath = await findSessionFileById(sessionId)
    }

    if (sessionFilePath) {
      try {
        const rawContent = await readFile(sessionFilePath, "utf8")
        const parts = codexReasoningEventsToParts(
          extractLatestCodexReasoningEvents(rawContent, options),
        )
        if (parts.length > 0) return parts
      } catch {
        // Session files are written asynchronously. Retry below.
      }
    }

    if (attempt < CODEX_USAGE_POLL_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, CODEX_USAGE_POLL_INTERVAL_MS))
    }
  }

  return []
}

function getCodexMcpAuthState(authStatus: string | null | undefined): {
  supportsAuth: boolean
  authenticated: boolean
  needsAuth: boolean
} {
  const normalized = (authStatus || "").trim().toLowerCase()

  // Exact CLI values from codex-rs/protocol/src/protocol.rs (McpAuthStatus):
  // unsupported | not_logged_in | bearer_token | o_auth
  switch (normalized) {
    case "":
    case "none":
    case "unsupported":
      return { supportsAuth: false, authenticated: false, needsAuth: false }
    case "not_logged_in":
      return { supportsAuth: true, authenticated: false, needsAuth: true }
    case "bearer_token":
    case "o_auth":
      return { supportsAuth: true, authenticated: true, needsAuth: false }
    default:
      // Unknown/forward-compatible value: don't force needs-auth.
      return { supportsAuth: true, authenticated: false, needsAuth: false }
  }
}

function objectToPairs(
  value: Record<string, string> | null | undefined,
): Array<{ name: string; value: string }> | undefined {
  if (!value) return undefined
  const pairs = Object.entries(value)
    .filter(([name, val]) => typeof name === "string" && typeof val === "string")
    .map(([name, val]) => ({ name, value: val }))

  return pairs.length > 0 ? pairs : undefined
}

function resolveCodexStdioEnv(
  transport: CodexMcpListEntry["transport"],
): Record<string, string> | undefined {
  const merged: Record<string, string> = {}

  if (transport.env) {
    for (const [name, value] of Object.entries(transport.env)) {
      if (typeof name === "string" && typeof value === "string") {
        merged[name] = value
      }
    }
  }

  if (Array.isArray(transport.env_vars)) {
    for (const envName of transport.env_vars) {
      const value = process.env[envName]
      if (typeof value === "string" && value.length > 0 && !merged[envName]) {
        merged[envName] = value
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function resolveCodexHttpHeaders(
  transport: CodexMcpListEntry["transport"],
): Record<string, string> | undefined {
  const merged: Record<string, string> = {}

  if (transport.http_headers) {
    for (const [name, value] of Object.entries(transport.http_headers)) {
      if (typeof name === "string" && typeof value === "string") {
        merged[name] = value
      }
    }
  }

  if (transport.env_http_headers) {
    for (const [headerName, envName] of Object.entries(transport.env_http_headers)) {
      if (typeof headerName !== "string" || typeof envName !== "string") continue
      const value = process.env[envName]
      if (typeof value === "string" && value.length > 0) {
        merged[headerName] = value
      }
    }
  }

  const bearerEnvVar = transport.bearer_token_env_var?.trim()
  if (bearerEnvVar && !merged.Authorization) {
    const token = process.env[bearerEnvVar]?.trim()
    if (token) {
      merged.Authorization = `Bearer ${token}`
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function normalizeCodexTools(tools: McpToolInfo[]): McpToolInfo[] {
  const unique = new Map<string, McpToolInfo>()
  for (const tool of tools) {
    if (typeof tool?.name === "string" && tool.name.trim()) {
      const name = tool.name.trim()
      unique.set(name, {
        name,
        ...(tool.description ? { description: tool.description } : {}),
      })
    }
  }
  return [...unique.values()]
}

async function fetchCodexMcpTools(entry: CodexMcpListEntry): Promise<McpToolInfo[]> {
  const transportType = entry.transport.type.trim().toLowerCase()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CODEX_MCP_TOOLS_FETCH_TIMEOUT_MS)

  const fetchPromise = (async (): Promise<McpToolInfo[]> => {
    if (transportType === "stdio") {
      const launch = resolveCodexStdioLaunch(entry.transport)
      const command = launch.command
      if (!command) return []
      return await fetchMcpToolsStdio(
        {
          command,
          args: launch.args,
          env: resolveCodexStdioEnv(entry.transport),
          cwd: launch.cwd,
        },
        controller.signal,
      )
    }

    if (
      transportType === "streamable_http" ||
      transportType === "http" ||
      transportType === "sse"
    ) {
      const url = entry.transport.url?.trim()
      if (!url) return []
      return await fetchMcpTools(url, resolveCodexHttpHeaders(entry.transport), controller.signal)
    }

    return []
  })()

  try {
    const tools = await fetchPromise
    return normalizeCodexTools(tools)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

function resolveCodexLookupPath(pathCandidate: string | null | undefined): string {
  return pathCandidate && pathCandidate.trim() ? pathCandidate.trim() : "__global__"
}

function getCodexMcpFingerprint(servers: CodexMcpServerForSession[]): string {
  return createHash("sha256").update(JSON.stringify(servers)).digest("hex")
}

async function resolveCodexMcpSnapshot(params: {
  lookupPath?: string | null
  forceRefresh?: boolean
  includeTools?: boolean
}): Promise<CodexMcpSnapshot> {
  const lookupPath = resolveCodexLookupPath(params.lookupPath)
  const cached = codexMcpCache.get(lookupPath)
  const shouldIncludeTools = Boolean(params.includeTools)
  if (cached && !params.forceRefresh && (!shouldIncludeTools || cached.toolsResolved)) {
    return cached
  }

  const result = await runCodexCliChecked(["mcp", "list", "--json"], {
    cwd: lookupPath === "__global__" ? undefined : lookupPath,
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    throw new Error("Failed to parse Codex MCP list JSON output.")
  }

  const entries = z.array(codexMcpListEntrySchema).parse(parsed)
  const mcpServersForSession: CodexMcpServerForSession[] = []
  const mcpServersForSettings: CodexMcpServerForSettings[] = []

  const convertedEntries = await Promise.all(
    entries.map(async (entry) => {
      const transportType = entry.transport.type.trim().toLowerCase()
      const authState = getCodexMcpAuthState(entry.auth_status)
      const includeInSession = entry.enabled
      const resolvedStdioEnv = resolveCodexStdioEnv(entry.transport)
      const resolvedHttpHeaders = resolveCodexHttpHeaders(entry.transport)
      let status: CodexMcpServerForSettings["status"] = !entry.enabled
        ? "failed"
        : authState.needsAuth
          ? "needs-auth"
          : "connected"

      const settingsConfig: Record<string, unknown> = {
        transportType: entry.transport.type,
        authStatus: entry.auth_status ?? "unknown",
        enabled: entry.enabled,
        disabledReason: entry.disabled_reason ?? undefined,
      }

      let sessionServer: CodexMcpServerForSession | null = null
      if (transportType === "stdio") {
        const launch = resolveCodexStdioLaunch(entry.transport)
        const command = launch.command
        const args = launch.args
        if (includeInSession && command) {
          const envPairs = objectToPairs(resolvedStdioEnv) || []
          sessionServer = {
            name: entry.name,
            type: "stdio",
            command,
            args,
            env: envPairs,
          }
        }

        settingsConfig.command = command
        settingsConfig.args = args
        settingsConfig.env = entry.transport.env || undefined
        settingsConfig.envVars = entry.transport.env_vars || undefined
        settingsConfig.cwd = launch.cwd
      } else if (
        transportType === "streamable_http" ||
        transportType === "http" ||
        transportType === "sse"
      ) {
        const url = entry.transport.url || undefined
        const headers = objectToPairs(resolvedHttpHeaders)
        if (includeInSession && url) {
          sessionServer = {
            name: entry.name,
            type: "http",
            url,
            headers: headers || [],
          }
        }

        settingsConfig.url = url
        settingsConfig.headers = entry.transport.http_headers || undefined
        settingsConfig.envHttpHeaders = entry.transport.env_http_headers || undefined
        settingsConfig.bearerTokenEnvVar = entry.transport.bearer_token_env_var || undefined
      }

      const shouldProbeTools =
        shouldIncludeTools &&
        includeInSession &&
        !authState.needsAuth &&
        // Probe unauthenticated/public servers and stdio servers.
        (!authState.supportsAuth ||
          transportType === "stdio" ||
          // For auth-capable HTTP, only probe if explicit auth header is available.
          Boolean(resolvedHttpHeaders?.Authorization))
      const tools = shouldProbeTools ? await fetchCodexMcpTools(entry) : []
      if (shouldProbeTools && tools.length === 0) {
        status = "failed"
      }

      return {
        sessionServer,
        settingsServer: {
          name: entry.name,
          status,
          tools,
          needsAuth: authState.needsAuth,
          config: settingsConfig,
        } satisfies CodexMcpServerForSettings,
      }
    }),
  )

  for (const converted of convertedEntries) {
    if (converted.sessionServer) {
      mcpServersForSession.push(converted.sessionServer)
    }
    mcpServersForSettings.push(converted.settingsServer)
  }

  const snapshot: CodexMcpSnapshot = {
    mcpServersForSession,
    groups: [
      {
        groupName: "Global",
        projectPath: null,
        mcpServers: mcpServersForSettings,
      },
    ],
    fingerprint: getCodexMcpFingerprint(mcpServersForSession),
    fetchedAt: Date.now(),
    toolsResolved: shouldIncludeTools,
  }

  codexMcpCache.set(lookupPath, snapshot)
  return snapshot
}

function clearCodexMcpCache(): void {
  codexMcpCache.clear()
}

function getCodexServerIdentity(server: CodexMcpServerForSettings): string {
  const config = server.config as Record<string, unknown>
  return JSON.stringify({
    enabled: config.enabled ?? null,
    disabledReason: config.disabledReason ?? null,
    transportType: config.transportType ?? null,
    command: config.command ?? null,
    args: config.args ?? null,
    env: config.env ?? null,
    envVars: config.envVars ?? null,
    url: config.url ?? null,
    headers: config.headers ?? null,
    envHttpHeaders: config.envHttpHeaders ?? null,
    bearerTokenEnvVar: config.bearerTokenEnvVar ?? null,
    authStatus: config.authStatus ?? null,
  })
}

export async function getAllCodexMcpConfigHandler() {
  const globalSnapshot = await resolveCodexMcpSnapshot({ includeTools: true })
  const globalServers = globalSnapshot.groups[0]?.mcpServers || []
  const globalByName = new Map(
    globalServers.map((server) => [server.name, getCodexServerIdentity(server)]),
  )

  const groups: CodexMcpSnapshot["groups"] = [...globalSnapshot.groups]

  // Only enumerate projects the app knows about (DB-backed projects).
  // Do not scan ~/.codex/config.toml project entries.
  const projectPathSet = new Set<string>()

  try {
    const db = getDatabase()
    const dbProjects = db.select({ path: projectsTable.path }).from(projectsTable).all()
    for (const project of dbProjects) {
      if (typeof project.path === "string" && project.path.trim().length > 0) {
        projectPathSet.add(project.path)
      }
    }
  } catch (error) {
    console.error("[codex.getAllMcpConfig] Failed to read projects from DB:", error)
  }

  const projectPaths = [...projectPathSet].sort((a, b) => a.localeCompare(b))
  const projectResults = await Promise.allSettled(
    projectPaths.map(async (projectPath) => {
      const projectSnapshot = await resolveCodexMcpSnapshot({
        lookupPath: projectPath,
        includeTools: true,
      })
      const effectiveServers = projectSnapshot.groups[0]?.mcpServers || []
      const projectOnlyServers = effectiveServers.filter((server) => {
        const globalIdentity = globalByName.get(server.name)
        if (!globalIdentity) return true
        return globalIdentity !== getCodexServerIdentity(server)
      })

      if (projectOnlyServers.length === 0) {
        return null
      }

      return {
        groupName: basename(projectPath) || projectPath,
        projectPath,
        mcpServers: projectOnlyServers,
      }
    }),
  )

  for (const result of projectResults) {
    if (result.status === "fulfilled" && result.value) {
      groups.push(result.value)
      continue
    }
    if (result.status === "rejected") {
      console.error(
        "[codex.getAllMcpConfig] Failed to resolve project MCP snapshot:",
        result.reason,
      )
    }
  }

  return { groups }
}

function normalizeCodexIntegrationState(rawOutput: string): CodexIntegrationState {
  const normalizedOutput = rawOutput.toLowerCase()

  if (normalizedOutput.includes("logged in using chatgpt")) {
    return "connected_chatgpt"
  }

  if (
    normalizedOutput.includes("logged in using an api key") ||
    normalizedOutput.includes("logged in using api key")
  ) {
    return "connected_api_key"
  }

  if (normalizedOutput.includes("not logged in")) {
    return "not_logged_in"
  }

  return "unknown"
}

function parseStoredMessages(raw: string | null | undefined): any[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function resolveCodexPermissionMode(params: {
  subChatPermissionMode?: string | null
  chatPermissionMode?: string | null
}): PermissionMode {
  return (
    parsePermissionMode(params.subChatPermissionMode) ||
    parsePermissionMode(params.chatPermissionMode) ||
    getGlobalDefault()
  )
}

async function createCodexRun(params: {
  runId: string
  chatId: string
  subChatId: string
  model: string
  permissionMode: PermissionMode
  customPermissions: string | null
  worktreePath: string | null
  promptMessageId?: string
}) {
  const db = getDatabase()
  const existingRun = db.select().from(agentRuns).where(eq(agentRuns.id, params.runId)).get()

  if (existingRun) {
    return existingRun
  }

  db.update(agentRuns)
    .set({
      status: "cancelled",
      completedAt: new Date(),
    })
    .where(
      and(
        eq(agentRuns.subChatId, params.subChatId),
        eq(agentRuns.status, "running"),
        ne(agentRuns.id, params.runId),
      ),
    )
    .run()

  const run = db
    .insert(agentRuns)
    .values({
      id: params.runId,
      chatId: params.chatId,
      subChatId: params.subChatId,
      harness: "codex",
      model: params.model,
      permissionMode: params.permissionMode,
      customPermissions: params.customPermissions,
      worktreePath: params.worktreePath,
      promptMessageId: params.promptMessageId,
      status: "running",
    })
    .returning()
    .get()

  db.update(subChats)
    .set({
      harness: "codex",
      model: params.model,
      permissionMode: params.permissionMode,
      worktreePath: params.worktreePath,
      runStatus: "running",
      updatedAt: new Date(),
    })
    .where(eq(subChats.id, params.subChatId))
    .run()

  // Keep the chat-level identity chip in sync with the latest run
  db.update(chats)
    .set({ harness: "codex", model: params.model })
    .where(eq(chats.id, params.chatId))
    .run()

  const before = await captureCheckpoint(run.id, params.worktreePath, "before")
  return db
    .update(agentRuns)
    .set({ beforeCheckpointId: before.id })
    .where(eq(agentRuns.id, run.id))
    .returning()
    .get()
}

async function completeCodexRun(params: {
  runId: string
  subChatId: string
  status: CodexRunStatus
}) {
  const db = getDatabase()
  const run = db.select().from(agentRuns).where(eq(agentRuns.id, params.runId)).get()
  if (!run || run.completedAt) return run

  let afterCheckpointId: string | undefined
  try {
    const after = await captureCheckpoint(run.id, run.worktreePath, "after")
    afterCheckpointId = after.id
    await captureNoChangeManifest(run.id)
  } catch (error) {
    console.warn("[codex] Failed to capture after checkpoint/manifest:", error)
  }

  const completedRun = db
    .update(agentRuns)
    .set({
      status: params.status,
      completedAt: new Date(),
      ...(afterCheckpointId && { afterCheckpointId }),
    })
    .where(
      and(
        eq(agentRuns.id, params.runId),
        eq(agentRuns.status, "running"),
        isNull(agentRuns.completedAt),
      ),
    )
    .returning()
    .get()

  if (!completedRun) {
    return db.select().from(agentRuns).where(eq(agentRuns.id, params.runId)).get()
  }

  updateSubChatRunStatusIfAuthoritative(db, {
    runId: params.runId,
    subChatId: params.subChatId,
    status: params.status,
    updatedAt: new Date(),
  })

  return completedRun
}

function extractPromptFromStoredMessage(message: any): string {
  if (!message || !Array.isArray(message.parts)) return ""

  const textParts: string[] = []
  const fileContents: string[] = []

  for (const part of message.parts) {
    if (part?.type === "text" && typeof part.text === "string") {
      textParts.push(part.text)
    } else if (part?.type === "file-content") {
      const filePath = typeof part.filePath === "string" ? part.filePath : undefined
      const fileName = filePath?.split("/").pop() || filePath || "file"
      const content = typeof part.content === "string" ? part.content : ""
      fileContents.push(`\n--- ${fileName} ---\n${content}`)
    }
  }

  return textParts.join("\n") + fileContents.join("")
}

function getLastSessionId(messages: any[]): string | undefined {
  const lastAssistant = [...messages].reverse().find((message) => message?.role === "assistant")
  const sessionId = lastAssistant?.metadata?.sessionId
  return typeof sessionId === "string" ? sessionId : undefined
}

function extractCodexModelId(rawModel: unknown): string | undefined {
  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return undefined
  }

  const normalizedModel = rawModel.trim()

  if (!normalizedModel || normalizedModel === "codex") {
    return undefined
  }

  return normalizedModel
}

function preprocessCodexModelName(params: {
  modelId: string
  authConfig?: { apiKey: string }
}): string {
  const hasAppManagedApiKey = Boolean(params.authConfig?.apiKey?.trim())
  if (!hasAppManagedApiKey) {
    return params.modelId
  }

  // All model IDs now match the real API; pass through as-is
  return params.modelId
}

function getAuthFingerprint(authConfig?: { apiKey: string }): string | null {
  const apiKey = authConfig?.apiKey?.trim()
  if (!apiKey) return null
  return createHash("sha256").update(apiKey).digest("hex")
}

function buildCodexProviderEnv(
  authConfig?: { apiKey: string },
  reasoningEnabled = true,
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh",
): Record<string, string> {
  // Prefer shell-derived values (notably PATH) so stdio MCP dependencies
  // like pipx/npx resolve the same way as in MCP tool probing.
  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value
    }
  }

  const shellEnv = getClaudeShellEnvironment()
  for (const [key, value] of Object.entries(shellEnv)) {
    if (typeof value === "string") {
      env[key] = value
    }
  }

  let existingConfig: Record<string, unknown> = {}
  try {
    if (env.CODEX_CONFIG) existingConfig = JSON.parse(env.CODEX_CONFIG)
  } catch {
    existingConfig = {}
  }
  env.CODEX_CONFIG = JSON.stringify({
    ...existingConfig,
    model_reasoning_summary: reasoningEnabled ? "detailed" : "none",
    model_supports_reasoning_summaries: reasoningEnabled,
    show_raw_agent_reasoning: reasoningEnabled,
    hide_agent_reasoning: !reasoningEnabled,
    ...(reasoningEffort ? { model_reasoning_effort: reasoningEffort } : {}),
  })

  const apiKey = authConfig?.apiKey?.trim()
  if (!apiKey) {
    return env
  }

  return {
    ...env,
    CODEX_API_KEY: apiKey,
  }
}

function getCodexAuthMethodId(authConfig?: { apiKey: string }): "codex-api-key" | undefined {
  const apiKey = authConfig?.apiKey?.trim()
  if (!apiKey) {
    return undefined
  }

  // codex-acp advertises auth methods:
  // - chatgpt
  // - codex-api-key
  // - openai-api-key
  // For app-managed API key path we want deterministic key auth.
  return "codex-api-key"
}

function buildUserParts(
  prompt: string,
  images:
    | Array<{
        base64Data?: string
        mediaType?: string
        filename?: string
      }>
    | undefined,
): any[] {
  const parts: any[] = [{ type: "text", text: prompt }]

  if (images && images.length > 0) {
    for (const image of images) {
      if (!image.base64Data || !image.mediaType) continue
      parts.push({
        type: "data-image",
        data: {
          base64Data: image.base64Data,
          mediaType: image.mediaType,
          filename: image.filename,
        },
      })
    }
  }

  return parts
}

function buildModelMessageContent(
  prompt: string,
  images:
    | Array<{
        base64Data?: string
        mediaType?: string
        filename?: string
      }>
    | undefined,
): any[] {
  const content: any[] = [{ type: "text", text: prompt }]

  if (images && images.length > 0) {
    for (const image of images) {
      if (!image.base64Data || !image.mediaType) continue
      content.push({
        type: "file",
        mediaType: image.mediaType,
        data: image.base64Data,
        ...(image.filename ? { filename: image.filename } : {}),
      })
    }
  }

  return content
}

function getOrCreateProvider(params: {
  subChatId: string
  cwd: string
  mcpServers: CodexMcpServerForSession[]
  mcpFingerprint: string
  existingSessionId?: string
  authConfig?: {
    apiKey: string
  }
  reasoningEnabled: boolean
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh"
}): ACPProvider {
  const authFingerprint = getAuthFingerprint(params.authConfig)
  const existing = providerSessions.get(params.subChatId)

  if (
    existing &&
    existing.cwd === params.cwd &&
    existing.authFingerprint === authFingerprint &&
    existing.mcpFingerprint === params.mcpFingerprint &&
    existing.reasoningEnabled === params.reasoningEnabled &&
    existing.reasoningEffort === (params.reasoningEffort ?? null)
  ) {
    return existing.provider
  }

  if (existing) {
    existing.provider.cleanup()
    providerSessions.delete(params.subChatId)
  }

  const hasAppManagedApiKey = Boolean(params.authConfig?.apiKey?.trim())
  // When app-managed key auth is used, avoid resuming older persisted session IDs.
  // Those can be tied to unauthenticated/CLI-auth state and trigger auth loops.
  const existingSessionIdForProvider = hasAppManagedApiKey ? undefined : params.existingSessionId

  const provider = createACPProvider({
    command: resolveCodexAcpBinaryPath(),
    env: buildCodexProviderEnv(params.authConfig, params.reasoningEnabled, params.reasoningEffort),
    authMethodId: getCodexAuthMethodId(params.authConfig),
    permissionRequestHandler: async (request) => {
      const active = codexPermissionHandlers.get(params.subChatId)
      return active ? active.handle(request) : rejectCodexPermissionRequest(request)
    },
    session: {
      cwd: params.cwd,
      mcpServers: params.mcpServers,
    },
    ...(existingSessionIdForProvider ? { existingSessionId: existingSessionIdForProvider } : {}),
    persistSession: true,
  })

  providerSessions.set(params.subChatId, {
    provider,
    cwd: params.cwd,
    authFingerprint,
    mcpFingerprint: params.mcpFingerprint,
    reasoningEnabled: params.reasoningEnabled,
    reasoningEffort: params.reasoningEffort ?? null,
  })

  return provider
}

function cleanupProvider(subChatId: string): void {
  const existing = providerSessions.get(subChatId)
  if (!existing) return

  existing.provider.cleanup()
  providerSessions.delete(subChatId)
}

function cleanupAllCodexProviders(): void {
  for (const subChatId of [...providerSessions.keys()]) cleanupProvider(subChatId)
}

export const codexRouter = router({
  getIntegration: publicProcedure.query(async () => {
    const result = await runCodexCli(["login", "status"])
    const combinedOutput = [result.stdout, result.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
      .trim()

    const storedApiKey = getCredentialService().status("codex.api-key").configured
    const state = storedApiKey
      ? ("connected_api_key" as const)
      : normalizeCodexIntegrationState(combinedOutput)

    return {
      state,
      isConnected: state === "connected_chatgpt" || state === "connected_api_key",
      rawOutput: combinedOutput,
      exitCode: result.exitCode,
    }
  }),

  removeApiKey: publicProcedure.mutation(() => {
    const service = getCredentialService()
    if (service.status("codex.api-key").configured) {
      service.remove("codex.api-key")
      cleanupAllCodexProviders()
    }
    return service.status("codex.api-key")
  }),

  logout: publicProcedure.mutation(async () => {
    const hadStoredApiKey = getCredentialService().status("codex.api-key").configured
    if (hadStoredApiKey) {
      getCredentialService().remove("codex.api-key")
      cleanupAllCodexProviders()
    }
    const logoutResult = await runCodexCli(["logout"])
    const statusResult = await runCodexCli(["login", "status"])

    const statusOutput = [statusResult.stdout, statusResult.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
      .trim()

    const state = normalizeCodexIntegrationState(statusOutput)
    const isConnected = state === "connected_chatgpt" || state === "connected_api_key"

    if (isConnected) {
      throw new Error("Failed to log out from Codex. Please try again.")
    }

    const logoutOutput = [logoutResult.stdout, logoutResult.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
      .trim()

    return {
      success: true,
      state,
      isConnected: false,
      logoutExitCode: logoutResult.exitCode,
      logoutOutput,
      statusOutput,
    }
  }),

  startLogin: publicProcedure.mutation(() => {
    const existingSession = getActiveLoginSession()
    if (existingSession) {
      return toLoginSessionResponse(existingSession)
    }

    const codexCliPath = resolveBundledCodexCliPath()
    const sessionId = crypto.randomUUID()

    const child = spawn(codexCliPath, ["login"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      windowsHide: true,
    })

    const session: CodexLoginSession = {
      id: sessionId,
      process: child,
      state: "running",
      output: "",
      url: null,
      error: null,
      exitCode: null,
    }

    const handleChunk = (chunk: Buffer | string) => {
      appendLoginOutput(session, chunk.toString("utf8"))
    }

    child.stdout.on("data", handleChunk)
    child.stderr.on("data", handleChunk)

    child.once("error", (error) => {
      session.state = "error"
      session.error = `[codex] Failed to start login flow: ${error.message}`
      session.process = null
    })

    child.once("close", (exitCode) => {
      session.exitCode = exitCode
      session.process = null

      if (session.state === "cancelled") {
        return
      }

      if (exitCode === 0) {
        session.state = "success"
        session.error = null
      } else {
        session.state = "error"
        session.error = session.error || `Codex login exited with code ${exitCode ?? "unknown"}`
      }
    })

    loginSessions.set(sessionId, session)

    return toLoginSessionResponse(session)
  }),

  getLoginSession: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
      }),
    )
    .query(({ input }) => {
      const session = loginSessions.get(input.sessionId)
      if (!session) {
        throw new Error("Codex login session not found")
      }

      return toLoginSessionResponse(session)
    }),

  cancelLogin: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const session = loginSessions.get(input.sessionId)
      if (!session) {
        return { success: true, found: false }
      }

      session.state = "cancelled"
      session.error = null

      if (session.process && !session.process.killed) {
        session.process.kill("SIGTERM")
      }

      return { success: true, found: true, session: toLoginSessionResponse(session) }
    }),

  getAllMcpConfig: publicProcedure.query(async () => {
    try {
      return await getAllCodexMcpConfigHandler()
    } catch (error) {
      console.error("[codex.getAllMcpConfig] Error:", error)
      return {
        groups: [],
        error: extractCodexError(error).message,
      }
    }
  }),

  refreshMcpConfig: publicProcedure.mutation(() => {
    clearCodexMcpCache()
    return { success: true }
  }),

  addMcpServer: publicProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1)
          .regex(
            /^[a-zA-Z0-9_-]+$/,
            "Name must contain only letters, numbers, underscores, and hyphens",
          ),
        scope: z.enum(["global", "project"]),
        transport: z.enum(["stdio", "http"]),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        url: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.scope !== "global") {
        throw new Error("Codex MCP currently supports global scope only.")
      }

      const args = ["mcp", "add", input.name.trim()]
      if (input.transport === "http") {
        const url = input.url?.trim()
        if (!url) {
          throw new Error("URL is required for HTTP servers.")
        }
        args.push("--url", url)
      } else {
        const command = input.command?.trim()
        if (!command) {
          throw new Error("Command is required for stdio servers.")
        }

        args.push("--", command, ...(input.args || []))
      }

      await runCodexCliChecked(args)
      clearCodexMcpCache()
      return { success: true }
    }),

  removeMcpServer: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        scope: z.enum(["global", "project"]).default("global"),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.scope !== "global") {
        throw new Error("Codex MCP currently supports global scope only.")
      }

      await runCodexCliChecked(["mcp", "remove", input.name.trim()])
      clearCodexMcpCache()
      return { success: true }
    }),

  startMcpOAuth: publicProcedure
    .input(
      z.object({
        serverName: z.string().min(1),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const projectPath = input.projectPath?.trim()
        await runCodexCliChecked(["mcp", "login", input.serverName.trim()], {
          cwd: projectPath && projectPath.length > 0 ? projectPath : undefined,
        })
        clearCodexMcpCache()
        return { success: true as const }
      } catch (error) {
        return {
          success: false as const,
          error: extractCodexError(error).message,
        }
      }
    }),

  logoutMcpServer: publicProcedure
    .input(
      z.object({
        serverName: z.string().min(1),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const projectPath = input.projectPath?.trim()
        await runCodexCliChecked(["mcp", "logout", input.serverName.trim()], {
          cwd: projectPath && projectPath.length > 0 ? projectPath : undefined,
        })
        clearCodexMcpCache()
        return { success: true as const }
      } catch (error) {
        return {
          success: false as const,
          error: extractCodexError(error).message,
        }
      }
    }),

  chat: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        chatId: z.string(),
        runId: z.string(),
        prompt: z.string(),
        model: z.string().optional(),
        cwd: z.string(),
        projectPath: z.string().optional(),
        mode: z.enum(["plan", "agent"]).default("agent"),
        sessionId: z.string().optional(),
        forceNewSession: z.boolean().optional(),
        reasoningEnabled: z.boolean().default(true),
        reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
        images: z.array(imageAttachmentSchema).optional(),
        vaultContextSectionIds: z.array(z.enum(projectVaultSectionIds)).optional(),
      }),
    )
    .subscription(({ input }) => {
      return observable<any>((emit) => {
        const existingStream = activeStreams.get(input.subChatId)
        if (existingStream) {
          const existingSubChat = getDatabase()
            .select()
            .from(subChats)
            .where(eq(subChats.id, input.subChatId))
            .get()
          const existingMessages = parseStoredMessages(existingSubChat?.messages)
          const lastMessage = existingMessages[existingMessages.length - 1]
          const isDuplicateActivePrompt =
            lastMessage?.role === "user" &&
            extractPromptFromStoredMessage(lastMessage) === input.prompt

          if (isDuplicateActivePrompt) {
            console.warn("[codex] Ignoring duplicate active stream request", {
              subChatId: input.subChatId,
              runId: input.runId,
              activeRunId: existingStream.runId,
            })
            queueMicrotask(() => {
              emit.next({ type: "finish" })
              emit.complete()
            })
            return () => {}
          }

          existingStream.cancelRequested = true
          existingStream.controller.abort()
          // Ensure old run cannot continue emitting after supersede.
          cleanupProvider(input.subChatId)
        }

        const abortController = new AbortController()
        const productMcpEnabledAtLaunch = getChatMcpExposure(input.chatId)
        const releaseProductMcpSession = productMcpEnabledAtLaunch
          ? registerActiveProductMcpSession({
              chatId: input.chatId,
              runId: input.runId,
              revoke: () => abortController.abort(),
            })
          : () => undefined
        activeStreams.set(input.subChatId, {
          runId: input.runId,
          controller: abortController,
          cancelRequested: false,
        })

        let isActive = true
        let runCompletionStatus: CodexRunStatus = "failure"
        let runCompleted = false

        const completeRunOnce = async (status: CodexRunStatus) => {
          if (runCompleted) return
          runCompleted = true
          try {
            await completeCodexRun({
              runId: input.runId,
              subChatId: input.subChatId,
              status,
            })
          } catch (runError) {
            console.error("[codex] Failed to complete run:", runError)
          }
        }

        const safeEmit = (chunk: any) => {
          if (!isActive) return
          if (!input.reasoningEnabled && String(chunk?.type).startsWith("reasoning-")) return
          try {
            emit.next(chunk)
          } catch {
            isActive = false
          }
        }

        const safeComplete = () => {
          if (!isActive) return
          isActive = false
          try {
            emit.complete()
          } catch {
            // Ignore double completion
          }
        }

        ;(async () => {
          try {
            const storedApiKey = getCredentialService().resolve("codex.api-key")
            const authConfig = storedApiKey ? { apiKey: storedApiKey } : undefined
            const db = getDatabase()

            const existingSubChat = db
              .select()
              .from(subChats)
              .where(eq(subChats.id, input.subChatId))
              .get()

            if (!existingSubChat) {
              throw new Error("Sub-chat not found")
            }

            const existingChat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
            if (!existingChat) {
              throw new Error("Chat not found")
            }

            const existingMessages = parseStoredMessages(existingSubChat.messages)
            const storedSessionId = getLastSessionId(existingMessages)
            if (input.sessionId && input.sessionId !== storedSessionId) {
              console.warn(`[codex] Ignoring sessionId not stored on sub-chat ${input.subChatId}`)
            }
            const ownedSessionId = input.forceNewSession ? undefined : storedSessionId
            const contextBundle = await buildHarnessContextBundle({
              cwd: input.cwd,
              projectPath: input.projectPath,
              harness: "codex",
              userPrompt: input.prompt,
              sessionMode: ownedSessionId ? "resumed" : "new",
              previousSourceFingerprint: getLastHarnessContextFingerprint(existingMessages),
            })
            let vaultContext
            try {
              vaultContext = await buildProjectVaultRunContext(db, {
                chatId: input.chatId,
                runId: input.runId,
                harness: "codex",
                ...(input.vaultContextSectionIds
                  ? { runSectionIds: input.vaultContextSectionIds }
                  : {}),
              })
            } catch (error) {
              if (error instanceof ProjectVaultContextRejectedError) {
                persistProjectVaultContextManifest(db, {
                  runId: input.runId,
                  manifest: error.manifest,
                  ...(input.vaultContextSectionIds
                    ? { runSectionIds: input.vaultContextSectionIds }
                    : {}),
                })
              }
              throw error
            }
            const promptForModel = prependStartupContext(
              input.prompt,
              [contextBundle.context, vaultContext.context].filter(Boolean).join("\n\n"),
            )
            const fallbackModel = authConfig?.apiKey?.trim()
              ? DEFAULT_CODEX_MODEL
              : DEFAULT_CHATGPT_CODEX_MODEL_WITH_REASONING
            const requestedModelId = extractCodexModelId(input.model) || fallbackModel
            const selectedModelId = preprocessCodexModelName({
              modelId: requestedModelId,
              authConfig,
            })
            const acpModelId = formatCodexModelForAcp(selectedModelId)
            const metadataModel = selectedModelId
            const persistedRunSnapshot = db
              .select({
                permissionMode: agentRuns.permissionMode,
                customPermissions: agentRuns.customPermissions,
                promptMessageId: agentRuns.promptMessageId,
              })
              .from(agentRuns)
              .where(eq(agentRuns.id, input.runId))
              .get()
            const permissionMode =
              parsePermissionMode(persistedRunSnapshot?.permissionMode) ??
              resolveCodexPermissionMode({
                subChatPermissionMode: existingSubChat.permissionMode,
                chatPermissionMode: existingChat.permissionMode,
              })
            const permissionApplication = buildCodexPermissionApplication({
              permissionMode,
              cwd: input.cwd,
              customPermissions:
                permissionMode === "custom"
                  ? parseCustomPermissionTogglesJson(
                      persistedRunSnapshot?.customPermissions ?? existingChat.customPermissions,
                    )
                  : null,
            })
            const customPermissions =
              permissionMode === "custom"
                ? parseCustomPermissionTogglesJson(
                    persistedRunSnapshot?.customPermissions ?? existingChat.customPermissions,
                  )
                : null

            const lastMessage = existingMessages[existingMessages.length - 1]
            const isDuplicatePrompt =
              lastMessage?.role === "user" &&
              extractPromptFromStoredMessage(lastMessage) === input.prompt

            let messagesForStream = existingMessages
            let promptMessageId =
              isDuplicatePrompt && typeof lastMessage?.id === "string" ? lastMessage.id : undefined
            const isAuthoritativeRun = () => {
              const currentStream = activeStreams.get(input.subChatId)
              return currentStream?.runId === input.runId
            }

            const persistSubChatMessages = (messages: any[]) => {
              if (!isAuthoritativeRun()) {
                return false
              }

              const latestSubChat = db
                .select({ messages: subChats.messages })
                .from(subChats)
                .where(eq(subChats.id, input.subChatId))
                .get()
              const mergedMessages = mergeMessagesPreservingSpokenText(
                parseStoredMessages(latestSubChat?.messages),
                messages,
              )
              db.update(subChats)
                .set({
                  messages: JSON.stringify(mergedMessages),
                  updatedAt: new Date(),
                })
                .where(eq(subChats.id, input.subChatId))
                .run()
              return true
            }

            const cleanAssistantMessageForPersistence = (message: any) => {
              if (!message || message.role !== "assistant") return message
              if (!Array.isArray(message.parts)) return message

              const cleanedParts = message.parts
                .filter((part: any) => part?.state !== "input-streaming")
                .map((part: any) =>
                  part?.type === "text" && part?.state === "streaming"
                    ? { ...part, state: "done" }
                    : part,
                )

              if (cleanedParts.length === 0) {
                return null
              }

              const cleanedMessage = {
                ...message,
                parts: cleanedParts,
              }

              return normalizeCodexAssistantMessage(cleanedMessage, {
                normalizeState: true,
              })
            }

            if (!isDuplicatePrompt) {
              const userMessage = {
                id: persistedRunSnapshot?.promptMessageId ?? crypto.randomUUID(),
                role: "user",
                parts: buildUserParts(input.prompt, input.images),
                metadata: { model: metadataModel },
              }
              promptMessageId = userMessage.id

              messagesForStream = [...existingMessages, userMessage]

              db.update(subChats)
                .set({
                  messages: JSON.stringify(messagesForStream),
                  updatedAt: new Date(),
                })
                .where(eq(subChats.id, input.subChatId))
                .run()
            }

            await createCodexRun({
              runId: input.runId,
              chatId: input.chatId,
              subChatId: input.subChatId,
              model: metadataModel,
              permissionMode,
              customPermissions: customPermissions ? JSON.stringify(customPermissions) : null,
              worktreePath: input.cwd || null,
              promptMessageId,
            })
            persistProjectVaultContextManifest(db, {
              runId: input.runId,
              manifest: vaultContext.manifest,
              ...(input.vaultContextSectionIds
                ? { runSectionIds: input.vaultContextSectionIds }
                : {}),
            })

            if (input.forceNewSession) {
              cleanupProvider(input.subChatId)
            }

            let mcpSnapshot: CodexMcpSnapshot = {
              mcpServersForSession: [],
              groups: [],
              fingerprint: getCodexMcpFingerprint([]),
              fetchedAt: Date.now(),
              toolsResolved: false,
            }
            try {
              const resolvedProjectPathFromCwd = resolveProjectPathFromWorktree(input.cwd)
              const mcpLookupPath = input.projectPath || resolvedProjectPathFromCwd || input.cwd
              mcpSnapshot = await resolveCodexMcpSnapshot({
                lookupPath: mcpLookupPath,
              })
              if (productMcpEnabledAtLaunch) {
                const registration = buildMcpStdioRegistration(
                  { chatId: input.chatId, runId: input.runId, permissionMode },
                  {
                    executablePath: process.execPath,
                    mainDirectory: __dirname,
                    databasePath: getDatabasePath(),
                  },
                )
                const collisionAliases = renameProductMcpServerCollisions(
                  mcpSnapshot.mcpServersForSession,
                )
                if (collisionAliases.length > 0) {
                  console.warn(
                    `[codex] Renamed third-party MCP collision "${FLAPSTACK_MCP_SERVER_NAME}" to ${collisionAliases.join(", ")} for this run.`,
                  )
                }
                mcpSnapshot.mcpServersForSession.push({
                  name: FLAPSTACK_MCP_SERVER_NAME,
                  type: "stdio",
                  command: registration.command,
                  args: registration.args,
                  env: Object.entries(registration.env).map(([name, value]) => ({ name, value })),
                })
                mcpSnapshot.fingerprint = getCodexMcpFingerprint(mcpSnapshot.mcpServersForSession)
              }
            } catch (mcpError) {
              console.error("[codex] Failed to resolve MCP servers:", mcpError)
            }

            const handleCodexPermissionRequest: CodexPermissionHandler = async (request) => {
              const providerMcpDecision = resolveProviderMcpPermission({
                permissionMode,
                correlationId: request.toolCall.toolCallId,
                providerToolName: request.toolCall.title,
                metadata: request.toolCall.rawInput ?? request._meta,
                isMcpToolApproval: request._meta?.is_mcp_tool_approval === true,
                trustedProductServerName: productMcpEnabledAtLaunch
                  ? FLAPSTACK_MCP_SERVER_NAME
                  : null,
                customPermissions,
              })
              if (providerMcpDecision?.decision === "deny") {
                return rejectCodexPermissionRequest(request)
              }
              if (providerMcpDecision?.decision === "allow") {
                return allowCodexPermissionRequest(request)
              }
              if (
                permissionMode === "custom" &&
                !isCustomToolAllowed(customPermissions, request.toolCall.title ?? "unknown")
              ) {
                return rejectCodexPermissionRequest(request)
              }
              if (permissionMode === "read-only" || abortController.signal.aborted || !isActive) {
                return rejectCodexPermissionRequest(request)
              }
              if (permissionMode === "full-access") {
                return allowCodexPermissionRequest(request)
              }

              const requestId = crypto.randomUUID()
              const decision = createCodexPermissionDecision({
                request,
                signal: abortController.signal,
              })
              registerPendingCodexPermissionRequest(requestId, {
                subChatId: input.subChatId,
                runId: input.runId,
                request,
                resolve: decision.resolve,
              })
              safeEmit({
                type: "codex-permission-request",
                requestId,
                runId: input.runId,
                toolCallId: request.toolCall.toolCallId,
                title: request.toolCall.title ?? "Codex tool",
                kind: request.toolCall.kind ?? "other",
                options: request.options.map((option) => ({
                  optionId: option.optionId,
                  name: option.name,
                  kind: option.kind,
                })),
              })
              if (!isActive) decision.reject()
              return decision.promise.finally(() => removePendingCodexPermissionRequest(requestId))
            }
            codexPermissionHandlers.set(input.subChatId, {
              runId: input.runId,
              handle: handleCodexPermissionRequest,
            })

            const provider = getOrCreateProvider({
              subChatId: input.subChatId,
              cwd: input.cwd,
              mcpServers: mcpSnapshot.mcpServersForSession,
              mcpFingerprint: mcpSnapshot.fingerprint,
              existingSessionId: ownedSessionId,
              authConfig,
              reasoningEnabled: input.reasoningEnabled,
              reasoningEffort: input.reasoningEffort,
            })

            const startedAt = Date.now()
            let latestSessionId = provider.getSessionId() || ownedSessionId
            let usagePromise: Promise<CodexUsageMetadata | null> | null = null
            let reasoningPromise: ReturnType<typeof pollCodexReasoning> | null = null

            const resolveUsageOnce = (): Promise<CodexUsageMetadata | null> => {
              if (usagePromise) return usagePromise

              const sessionId = latestSessionId || provider.getSessionId()
              if (!sessionId) {
                return Promise.resolve(null)
              }

              usagePromise = pollUsage(sessionId, {
                notBeforeTimestampMs: startedAt,
              }).catch(() => null)
              return usagePromise
            }

            const resolveReasoningOnce = (): ReturnType<typeof pollCodexReasoning> => {
              if (!input.reasoningEnabled) return Promise.resolve([])
              if (reasoningPromise) return reasoningPromise

              const sessionId = latestSessionId || provider.getSessionId()
              if (!sessionId) {
                return Promise.resolve([])
              }

              reasoningPromise = pollCodexReasoning(sessionId, {
                notBeforeTimestampMs: startedAt,
              }).catch(() => [])
              return reasoningPromise
            }

            const result = streamText({
              model: provider.languageModel(acpModelId, mapCodexAcpModeId(permissionMode)),
              messages: [
                {
                  role: "user",
                  content: buildModelMessageContent(promptForModel, input.images),
                },
              ],
              tools: provider.tools,
              abortSignal: abortController.signal,
            })

            const uiStream = result.toUIMessageStream({
              originalMessages: messagesForStream,
              generateMessageId: () => crypto.randomUUID(),
              messageMetadata: ({ part }) => {
                const sessionId = provider.getSessionId() || undefined
                if (sessionId) {
                  latestSessionId = sessionId
                }

                if (part.type === "finish") {
                  return {
                    harness: "codex",
                    model: metadataModel,
                    permissionMode,
                    permissionApplication,
                    runId: input.runId,
                    sessionId,
                    context: contextBundle.metadata,
                    vaultContext: vaultContext.manifest,
                    transport: CODEX_TRANSPORT_DECISION.selectedAdapter,
                    durationMs: Date.now() - startedAt,
                    resultSubtype: part.finishReason === "error" ? "error" : "success",
                  }
                }

                if (sessionId) {
                  return {
                    harness: "codex",
                    model: metadataModel,
                    permissionMode,
                    permissionApplication,
                    runId: input.runId,
                    sessionId,
                    context: contextBundle.metadata,
                    vaultContext: vaultContext.manifest,
                    transport: CODEX_TRANSPORT_DECISION.selectedAdapter,
                  }
                }

                return {
                  harness: "codex",
                  model: metadataModel,
                  permissionMode,
                  permissionApplication,
                  runId: input.runId,
                  context: contextBundle.metadata,
                  vaultContext: vaultContext.manifest,
                  transport: CODEX_TRANSPORT_DECISION.selectedAdapter,
                }
              },
              onFinish: async ({ responseMessage, isContinuation }) => {
                try {
                  const [usageMetadata, reasoningParts] = await Promise.all([
                    resolveUsageOnce(),
                    resolveReasoningOnce(),
                  ])
                  const responseWithReasoning = appendUniqueReasoningOutputParts(
                    responseMessage as any,
                    reasoningParts,
                  )
                  const responseWithUsage = usageMetadata
                    ? {
                        ...responseWithReasoning,
                        metadata: {
                          ...((responseWithReasoning as any)?.metadata || {}),
                          harness: "codex",
                          model: metadataModel,
                          permissionMode,
                          permissionApplication,
                          runId: input.runId,
                          context: contextBundle.metadata,
                          vaultContext: vaultContext.manifest,
                          transport: CODEX_TRANSPORT_DECISION.selectedAdapter,
                          ...usageMetadata,
                        },
                      }
                    : {
                        ...responseWithReasoning,
                        metadata: {
                          ...((responseWithReasoning as any)?.metadata || {}),
                          harness: "codex",
                          model: metadataModel,
                          permissionMode,
                          permissionApplication,
                          runId: input.runId,
                          context: contextBundle.metadata,
                          vaultContext: vaultContext.manifest,
                          transport: CODEX_TRANSPORT_DECISION.selectedAdapter,
                        },
                      }
                  const cleanedResponseMessage =
                    cleanAssistantMessageForPersistence(responseWithUsage)

                  if (!cleanedResponseMessage) {
                    const fallbackResponseMessage = {
                      id: crypto.randomUUID(),
                      role: "assistant",
                      parts: [
                        {
                          type: "text",
                          text: "Codex finished without returning a visible response. Retry the message; if it repeats, switch models or check Codex logs.",
                          state: "done",
                        },
                      ],
                      metadata: {
                        ...((responseMessage as any)?.metadata || {}),
                        harness: "codex",
                        model: metadataModel,
                        permissionMode,
                        permissionApplication,
                        runId: input.runId,
                        context: contextBundle.metadata,
                        vaultContext: vaultContext.manifest,
                        transport: CODEX_TRANSPORT_DECISION.selectedAdapter,
                        resultSubtype: "empty-response",
                        ...usageMetadata,
                      },
                    }

                    console.warn("[codex] Empty assistant response persisted as fallback", {
                      subChatId: input.subChatId,
                      runId: input.runId,
                      promptMessageId,
                    })

                    persistSubChatMessages([
                      ...(isContinuation ? messagesForStream.slice(0, -1) : messagesForStream),
                      fallbackResponseMessage,
                    ])
                    return
                  }

                  const messagesToPersist = [
                    ...(isContinuation ? messagesForStream.slice(0, -1) : messagesForStream),
                    cleanedResponseMessage,
                  ]

                  persistSubChatMessages(messagesToPersist)
                } catch (error) {
                  console.error("[codex] Failed to persist messages:", error)
                }
              },
              onError: (error) => extractCodexError(error).message,
            })

            const reader = uiStream.getReader()
            let pendingFinishChunk: any | null = null
            let terminalProviderFailure = false
            const streamedReasoningOutputTexts = new Set<string>()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              const valueType = (value as { type?: string } | undefined)?.type

              if (valueType === "error" || valueType === "auth-error") {
                const normalized = extractCodexError(value)
                // Provider/auth errors are terminal even if the transport later emits finish.
                terminalProviderFailure = true

                if (isCodexAuthError(normalized)) {
                  safeEmit({ ...value, type: "auth-error", errorText: normalized.message })
                } else {
                  safeEmit({ ...value, errorText: normalized.message })
                }
                continue
              }

              if (valueType === "finish") {
                const finishValue = value as {
                  finishReason?: string
                  messageMetadata?: { resultSubtype?: string }
                }
                if (
                  finishValue.finishReason === "error" ||
                  finishValue.messageMetadata?.resultSubtype === "error"
                ) {
                  terminalProviderFailure = true
                }
                pendingFinishChunk = value
                continue
              }

              const normalizedForTracking = normalizeCodexStreamChunk(value) as any
              if (
                normalizedForTracking?.toolName === "ReasoningOutput" &&
                typeof normalizedForTracking?.input?.text === "string"
              ) {
                streamedReasoningOutputTexts.add(normalizedForTracking.input.text)
              }

              safeEmit(value)
            }

            if (pendingFinishChunk) {
              const [usageMetadata, reasoningParts] = await Promise.all([
                resolveUsageOnce(),
                resolveReasoningOnce(),
              ])
              for (const part of reasoningParts) {
                if (streamedReasoningOutputTexts.has(part.input.text)) continue
                safeEmit({
                  type: "tool-input-available",
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  input: { ...part.input, label: part.label },
                })
                safeEmit({
                  type: "tool-output-available",
                  toolCallId: part.toolCallId,
                  output: part.output,
                })
              }
              safeEmit({
                type: "message-metadata",
                messageMetadata: {
                  runId: input.runId,
                  context: contextBundle.metadata,
                  vaultContext: vaultContext.manifest,
                  transport: CODEX_TRANSPORT_DECISION.selectedAdapter,
                  ...(usageMetadata ?? {}),
                },
              })
              safeEmit(pendingFinishChunk)
            } else {
              safeEmit({ type: "finish" })
            }

            const activeStream = activeStreams.get(input.subChatId)
            runCompletionStatus =
              abortController.signal.aborted || activeStream?.cancelRequested
                ? "cancelled"
                : terminalProviderFailure
                  ? "failure"
                  : "success"
            await completeRunOnce(runCompletionStatus)
            safeComplete()
          } catch (error) {
            const normalized = extractCodexError(error)
            runCompletionStatus =
              abortController.signal.aborted ||
              activeStreams.get(input.subChatId)?.cancelRequested === true
                ? "cancelled"
                : "failure"

            console.error("[codex] chat stream error:", error)
            if (isCodexAuthError(normalized)) {
              safeEmit({ type: "auth-error", errorText: normalized.message })
            } else {
              safeEmit({ type: "error", errorText: normalized.message })
            }
            await completeRunOnce(runCompletionStatus)
            safeEmit({ type: "finish" })
            safeComplete()
          } finally {
            releaseProductMcpSession()
            const permissionHandler = codexPermissionHandlers.get(input.subChatId)
            if (permissionHandler?.runId === input.runId) {
              codexPermissionHandlers.delete(input.subChatId)
            }
            rejectPendingCodexPermissionRequests(input.subChatId, input.runId)
            const activeStream = activeStreams.get(input.subChatId)
            if (!runCompleted) {
              const finalStatus =
                abortController.signal.aborted || activeStream?.cancelRequested
                  ? "cancelled"
                  : runCompletionStatus
              await completeRunOnce(finalStatus)
            }
            if (activeStream?.runId === input.runId) {
              const shouldCleanupProvider =
                abortController.signal.aborted || activeStream.cancelRequested
              if (shouldCleanupProvider) {
                cleanupProvider(input.subChatId)
              }
              activeStreams.delete(input.subChatId)
            }
          }
        })()

        return () => {
          isActive = false
          abortController.abort()
          releaseProductMcpSession()

          const activeStream = activeStreams.get(input.subChatId)
          if (activeStream?.runId === input.runId) {
            activeStream.cancelRequested = true
          }
        }
      })
    }),

  replyPermission: publicProcedure
    .input(z.object({ requestId: z.string(), optionId: z.string() }))
    .mutation(({ input }) => replyPendingCodexPermissionRequest(input)),

  cancel: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        runId: z.string(),
      }),
    )
    .mutation(({ input }) => cancelActiveCodexRun(input)),

  cleanup: publicProcedure.input(z.object({ subChatId: z.string() })).mutation(({ input }) => {
    codexPermissionHandlers.delete(input.subChatId)
    rejectPendingCodexPermissionRequests(input.subChatId)
    cleanupProvider(input.subChatId)

    const activeStream = activeStreams.get(input.subChatId)
    if (activeStream) {
      activeStream.controller.abort()
      activeStreams.delete(input.subChatId)
    }

    return { success: true }
  }),
})
