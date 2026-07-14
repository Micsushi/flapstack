import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { randomUUID } from "node:crypto"
import { and, desc, eq, isNull } from "drizzle-orm"
import { app, BrowserWindow, ipcMain } from "electron"
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import {
  agentRuns,
  chats,
  checkpoints,
  fileChangeManifests,
  getDatabase,
  getDatabasePath,
  projects,
  subChats,
} from "../db"
import { createAgentOrchestrationService } from "../agent-orchestration/service"
import { DEFAULT_CLAUDE_MODEL_ID, normalizeOpencodeModelId } from "../../../shared/model-catalog"
import {
  OPENCODE_HARNESSES,
  type HarnessProvider,
  type OpencodeHarness,
} from "../../../shared/harness-types"
import { DEV_AGENT_INPUT_CHANNEL, type DevAgentInputPayload } from "../../../shared/dev-agent-input"
import {
  DEV_TEST_CONTROL_VIEW_CHANNEL,
  type DevTestControlViewPayload,
} from "../../../shared/dev-test-control"
import { buildReasoningTimerState } from "../../../shared/reasoning-duration"
import { agentInputLifecycle } from "../agent-input/service"
import {
  bindFilesystemRootIdentity,
  bindRegisteredFilesystemRoot,
} from "../git/security/path-validation"
import { getAgentInputCapability } from "../harness/input-capabilities"
import {
  DEV_RENDERER_CONTROL_REQUEST_CHANNEL,
  DEV_RENDERER_CONTROL_RESPONSE_CHANNEL,
  parseDevRendererControlResponse,
  type DevRendererControlCommand,
} from "../../../shared/dev-renderer-control"
import {
  discoverProviderExtensions,
  mutateProviderExtension,
  type ProviderExtensionKind,
  type ProviderExtensionProvider,
} from "../provider-extensions"
import {
  getAvailableProviderModels,
  getCredentialStatusAsync,
  sanitizeOpencodeAuditValue,
} from "../harness/opencode-sidecar"
import {
  cancelActiveOpencodeRun,
  getActiveOpencodeRunStartedAt,
  listPendingOpencodeApprovals,
  replyPendingOpencodeApproval,
  startOpencodeDevRun,
} from "../trpc/routers/opencode"
import { cancelActiveCursorRun, startCursorDevRun } from "../trpc/routers/cursor"
import { SAFE_CHATGPT_CODEX_MODEL } from "./codex-status"
import {
  listPendingCodexPermissionRequests,
  replyPendingCodexPermissionRequest,
} from "../codex/permission-bridge"
import { devMcpExposedTools } from "./registry"
import { getHarnessStatus } from "./harness-status"
import { listDevAgentInputRendererStates } from "./renderer-state"
import {
  authorizeMcpDispatchRetry,
  listMcpAuditRecords,
  listMcpDispatchRecoveryClaims,
  reconcileMcpDispatchClaim,
  recoverMcpDispatchClaims,
  type McpAuditStatus,
} from "../mcp-control/audit-storage"
import {
  getChatMcpExposureStatus,
  registerActiveProductMcpSession,
  setChatMcpExposure,
} from "../mcp-control/exposure"
import { decideMcpApproval, listPendingMcpApprovals } from "../mcp-control/approval-coordinator"
import { buildMcpStdioRegistration, type McpStdioRegistration } from "../mcp-control/registration"
import { getPermissionPreferences } from "../permissions"
import {
  appendUserMessage,
  findLastAssistantMessage,
  getMessageText,
  parseStoredMessages,
  summarizeMessages,
} from "./messages"
import {
  getBundledNodePathPrefix,
  redactSecretLikeText,
  redactShellResult,
  runShellCommand,
  withRecommendedNodePath,
} from "./shell"
export { getSettingsState, getVisibleCopySearchState } from "./settings"

function notifyTestControlView(payload: DevTestControlViewPayload) {
  if (!BrowserWindow || typeof BrowserWindow.getAllWindows !== "function") return
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(DEV_TEST_CONTROL_VIEW_CHANNEL, payload)
  }
}

function notifyAgentInput(payload: DevAgentInputPayload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(DEV_AGENT_INPUT_CHANNEL, payload)
  }
}

export function listAgentInputRequests(input?: { chatId?: string }) {
  return agentInputLifecycle.list(input?.chatId)
}

export function getRendererAgentInputState(input?: { subChatId?: string }) {
  const states = listDevAgentInputRendererStates()
  return input?.subChatId ? states.filter((state) => state.subChatId === input.subChatId) : states
}

export function injectAgentInputRequest(input: {
  subChatId: string
  harness: HarnessProvider
  model?: string
  timeoutMs?: number
  questions: Array<{
    question: string
    header?: string
    options?: Array<{ label: string; description?: string }>
    multiSelect?: boolean
    allowCustom?: boolean
  }>
}) {
  const db = getDatabase()
  const subChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
  if (!subChat) throw new Error("Sub-chat not found")
  const requestId = `dev-input-${randomUUID()}`
  const runId = `dev-input-run-${randomUUID()}`
  const createdAt = Date.now()
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 60_000, 1_000), 300_000)
  const request = {
    requestId,
    chatId: subChat.id,
    runId,
    origin: {
      harness: input.harness,
      ...(input.model ? { model: input.model } : {}),
      toolName: "request_user_input",
    },
    capability: getAgentInputCapability(input.harness),
    questions: input.questions.map((question, questionIndex) => ({
      id: `question-${questionIndex + 1}`,
      question: question.question,
      ...(question.header ? { header: question.header } : {}),
      options: (question.options ?? []).map((option, optionIndex) => ({
        id: `option-${optionIndex + 1}`,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      })),
      multiSelect: question.multiSelect === true,
      allowCustom: question.allowCustom !== false,
    })),
    status: "pending" as const,
    createdAt,
    expiresAt: createdAt + timeoutMs,
  }

  void agentInputLifecycle.create(request, { timeoutMs }).then((resolution) => {
    notifyAgentInput({
      type: "agent-input-status",
      event: {
        requestId,
        chatId: request.chatId,
        runId,
        status: resolution.status,
        at: Date.now(),
        ...(resolution.status === "answered"
          ? { response: resolution.response }
          : { message: resolution.message }),
      },
    })
  })
  notifyAgentInput({ type: "agent-input-request", request })
  return request
}

export function replyAgentInputRequest(input: {
  requestId: string
  action: "answer" | "skip" | "cancel"
  mode?: "structured" | "chat"
  answers?: Record<string, string[]>
}) {
  if (input.action === "skip") return { ok: agentInputLifecycle.skip(input.requestId) }
  if (input.action === "cancel") return { ok: agentInputLifecycle.cancel(input.requestId) }
  return {
    ok: agentInputLifecycle.answer({
      requestId: input.requestId,
      mode: input.mode ?? "structured",
      answers: input.answers ?? {},
      submittedAt: Date.now(),
    }),
  }
}

type ProductMcpTestCall = {
  id: string
  chatId: string
  runId: string
  toolName: string
  status: "running" | "completed" | "failed" | "cancelled"
  response: unknown
  error: string | null
  startedAt: string
  finishedAt: string | null
  sessionKey: string
}

const productMcpTestCalls = new Map<string, ProductMcpTestCall>()

type ProductMcpTestSession = {
  key: string
  chatId: string
  runId: string
  client: Client
  transport: StdioClientTransport
  connected: Promise<void>
  release: () => void
  closed: boolean
}

const productMcpTestSessions = new Map<string, ProductMcpTestSession>()

export async function requestDevRendererControl(input: DevRendererControlCommand) {
  const windows = BrowserWindow?.getAllWindows?.() ?? []
  const window = BrowserWindow?.getFocusedWindow?.() ?? windows.find((item) => !item.isDestroyed())
  if (!window || window.isDestroyed()) throw new Error("No live renderer is available")

  const requestId = randomUUID()
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener(DEV_RENDERER_CONTROL_RESPONSE_CHANNEL, handleResponse)
      reject(new Error("Live renderer control timed out"))
    }, 5_000)
    const handleResponse = (event: Electron.IpcMainEvent, raw: unknown) => {
      if (event.sender.id !== window.webContents.id) return
      const response = parseDevRendererControlResponse(raw)
      if (!response || response.requestId !== requestId) return
      clearTimeout(timeout)
      ipcMain.removeListener(DEV_RENDERER_CONTROL_RESPONSE_CHANNEL, handleResponse)
      if (!response.ok) reject(new Error(response.error ?? "Renderer control failed"))
      else resolve(response.state)
    }
    ipcMain.on(DEV_RENDERER_CONTROL_RESPONSE_CHANNEL, handleResponse)
    window.webContents.send(DEV_RENDERER_CONTROL_REQUEST_CHANNEL, { ...input, requestId })
  })
}

export async function getLiveSettingsState() {
  return requestDevRendererControl({ command: "settings.get" })
}

export async function getLiveSettingsLegacyState() {
  return requestDevRendererControl({ command: "settings.legacy.get" })
}

export async function mutateLiveSettingsLegacyState(input: {
  activeTab?: string
  ctrlTabTarget?: "workspaces" | "agents"
}) {
  return requestDevRendererControl({ command: "settings.legacy.mutate", ...input })
}

export async function getPermissionUiState() {
  return requestDevRendererControl({ command: "permissions.ui.get" })
}

export async function controlPermissionUi(input: {
  operation:
    | "select-mode"
    | "set-scope"
    | "set-remember"
    | "set-custom-capability"
    | "set-custom-reviewed"
    | "apply"
    | "cancel"
  mode?: "read-only" | "ask-before-edits" | "auto-edit-project-only" | "full-access" | "custom"
  scope?: "all-chats" | "current-chat"
  enabled?: boolean
  capability?: string
}) {
  return requestDevRendererControl({ command: "permissions.ui.control", ...input })
}

export async function getProductMcpRendererState(input: { chatId: string }) {
  requireProductMcpTestCaller(input.chatId)
  return requestDevRendererControl({ command: "mcp.get", chatId: input.chatId })
}

export async function controlProductMcpRenderer(input: {
  chatId: string
  operation: "open-audit" | "close-audit"
}) {
  requireProductMcpTestCaller(input.chatId)
  return requestDevRendererControl({ command: "mcp.control", ...input })
}

export async function controlSettings(input: {
  operation: "open" | "close" | "navigate" | "search" | "select-project"
  tab?: string
  query?: string
  targetId?: string
  projectId?: string | null
}) {
  let project: { id: string; name: string; path: string } | null | undefined
  if (input.operation === "select-project") {
    if (input.projectId === null) {
      project = null
    } else {
      const row = getDatabase()
        .select({ id: projects.id, name: projects.name, path: projects.path })
        .from(projects)
        .where(eq(projects.id, input.projectId ?? ""))
        .get()
      if (!row) throw new Error("Project not found")
      project = row
    }
  }
  return requestDevRendererControl({
    command: "settings.control",
    operation: input.operation,
    tab: input.tab,
    query: input.query,
    targetId: input.targetId,
    project,
  })
}

export function createTestOrchestration(
  input: unknown,
  options: { deferScheduling?: boolean } = {},
) {
  const service = createAgentOrchestrationService(getDatabasePath())
  // deferScheduling persists paused in the same transaction as task creation.
  // The independent scheduler can never observe this fixture as launchable.
  const created = service.create(input, undefined, options)
  notifyTestOrchestrationChanged(created.orchestration.taskId)
  return created
}

function notifyTestOrchestrationChanged(taskId: string) {
  const chatIds = getDatabase()
    .select({ id: chats.id })
    .from(chats)
    .where(eq(chats.taskId, taskId))
    .all()
    .map((chat) => chat.id)
    .slice(0, 100)
  notifyTestControlView({ action: "orchestration-changed", taskId, chatIds })
}

export function createTestOrchestrationFixture(input: {
  projectPath: string
  projectName?: string
  chatName?: string
  harness?: "codex" | "claude-code"
}) {
  const requestedPath = resolve(input.projectPath)
  if (!existsSync(requestedPath) || !statSync(requestedPath).isDirectory()) {
    throw new Error("Orchestration fixture project path must be an existing directory")
  }
  const projectPath = realpathSync(requestedPath)
  const db = getDatabase()
  const existingProject = db.select().from(projects).where(eq(projects.path, projectPath)).get()
  if (existingProject?.archivedAt) throw new Error("Orchestration fixture project is archived")
  const harness = input.harness ?? "codex"
  const permissionMode = "read-only"
  const created = db.transaction((tx) => {
    const project =
      existingProject ??
      tx
        .insert(projects)
        .values({
          name: input.projectName?.trim() || "Orchestration MCP fixture",
          path: projectPath,
        })
        .returning()
        .get()
    const chat = tx
      .insert(chats)
      .values({
        name: input.chatName?.trim() || "Orchestration MCP fixture",
        projectId: project.id,
        scope: "project",
        harness,
        permissionMode,
        worktreePath: project.path,
        ancestorChatIds: "[]",
      })
      .returning()
      .get()
    tx.update(chats).set({ initiatorChatId: chat.id }).where(eq(chats.id, chat.id)).run()
    const subChat = tx
      .insert(subChats)
      .values({
        chatId: chat.id,
        name: chat.name,
        mode: "agent",
        harness,
        permissionMode,
        worktreePath: project.path,
        messages: "[]",
      })
      .returning()
      .get()
    return { project, chat, subChat }
  })
  notifyTestControlView({ action: "chat-created", chatId: created.chat.id })
  return {
    projectId: created.project.id,
    projectCreated: !existingProject,
    chatId: created.chat.id,
    subChatId: created.subChat.id,
    projectPath,
    harness,
    permissionMode,
  }
}

export function getTestOrchestration(input: { taskId: string }) {
  const service = createAgentOrchestrationService(getDatabasePath())
  return {
    overview: service.getOverview(input.taskId),
    lineage: service.getLineage(input.taskId),
  }
}

export function mutateTestOrchestration(input: {
  taskId: string
  action:
    "tick" | "pause" | "resume" | "stop" | "retry" | "replace" | "add" | "progress" | "archive"
  agentId?: string
  payload?: unknown
}) {
  const service = createAgentOrchestrationService(getDatabasePath())
  let result: unknown
  switch (input.action) {
    case "tick":
      service.tickAll()
      result = service.getOverview(input.taskId)
      break
    case "pause":
    case "resume":
    case "stop":
      result = service.control(input.taskId, input.action)
      break
    case "retry":
      if (!input.agentId) throw new Error("retry requires agentId")
      result = service.retryAgent(input.taskId, input.agentId)
      break
    case "replace": {
      if (!input.agentId) throw new Error("replace requires agentId")
      const payload = objectPayload(input.payload)
      result = service.replaceAgent(input.taskId, input.agentId, payload.agent)
      break
    }
    case "add":
      result = service.addAgent({ ...objectPayload(input.payload), taskId: input.taskId })
      break
    case "progress":
      result = service.reportProgress({ ...objectPayload(input.payload), taskId: input.taskId })
      break
    case "archive":
      result = service.archiveTerminal(input.taskId)
      break
  }
  notifyTestOrchestrationChanged(input.taskId)
  return result
}

function objectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("orchestration action requires an object payload")
  }
  return value as Record<string, unknown>
}

export function getTestEnvironment(repoPath = process.cwd()) {
  const userDataPath = app.getPath("userData")
  const dbPath = join(userDataPath, "data", "agents.db")
  const bundledNodePath = getBundledNodePathPrefix()

  return {
    app: {
      name: app.getName(),
      isPackaged: app.isPackaged,
      userDataPath,
      databasePath: dbPath,
      databaseExists: existsSync(dbPath),
    },
    repo: {
      path: repoPath,
      packageJsonExists: existsSync(join(repoPath, "package.json")),
      openspecChangePath: join(repoPath, "openspec", "changes", "add-dev-test-control-mcp"),
    },
    runtime: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      bundledNodePath,
      recommendedCheckEnv:
        bundledNodePath === null ? null : `PATH="${bundledNodePath}:$PATH" npm run check`,
    },
    tools: devMcpExposedTools,
  }
}

export function listTestTargets() {
  const db = getDatabase()
  const projectRows = db.select().from(projects).orderBy(desc(projects.updatedAt)).all()
  const chatRows = db.select().from(chats).orderBy(desc(chats.updatedAt)).all()
  const subChatRows = db.select().from(subChats).orderBy(desc(subChats.updatedAt)).all()

  return {
    projects: projectRows.map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
      updatedAt: compactTimestamp(project.updatedAt),
    })),
    chats: chatRows.map((chat) => ({
      id: chat.id,
      name: chat.name,
      projectId: chat.projectId,
      taskId: chat.taskId,
      scope: chat.scope,
      harness: chat.harness,
      model: chat.model,
      permissionMode: chat.permissionMode,
      worktreePath: chat.worktreePath,
      branch: chat.branch,
      archived: Boolean(chat.archivedAt),
      updatedAt: compactTimestamp(chat.updatedAt),
    })),
    subChats: subChatRows.map((subChat) => ({
      id: subChat.id,
      name: subChat.name,
      chatId: subChat.chatId,
      mode: subChat.mode,
      harness: subChat.harness,
      model: subChat.model,
      permissionMode: subChat.permissionMode,
      worktreePath: subChat.worktreePath,
      runStatus: subChat.runStatus,
      sessionId: subChat.sessionId,
      streamId: subChat.streamId,
      messages: summarizeMessages(subChat.messages),
      updatedAt: compactTimestamp(subChat.updatedAt),
    })),
  }
}

export function prepareProductMcpCaller(input: {
  harness: "codex" | "claude"
  name?: string
  repoPath?: string
  permissionMode?: "read-only" | "ask-before-edits" | "auto-edit-project-only" | "full-access"
}) {
  const db = getDatabase()
  const chatId = randomUUID()
  const subChatId = randomUUID()
  const runId = randomUUID()
  const harness = input.harness === "claude" ? "claude-code" : "codex"
  const model = harness === "codex" ? SAFE_CHATGPT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL_ID
  const worktreePath = resolveProductMcpTestRepoPath(input.repoPath)
  const permissionMode = input.permissionMode ?? "full-access"
  const name = `MCP live test ${input.harness}${input.name?.trim() ? `: ${input.name.trim()}` : ""}`
  const created = db.transaction((tx) => {
    const chat = tx
      .insert(chats)
      .values({
        id: chatId,
        name,
        scope: "global",
        harness,
        model,
        permissionMode,
        worktreePath,
        mcpExposureEnabled: false,
      })
      .returning()
      .get()
    const subChat = tx
      .insert(subChats)
      .values({
        id: subChatId,
        chatId,
        name,
        mode: "agent",
        harness,
        model,
        permissionMode,
        worktreePath,
        runStatus: "running",
        messages: "[]",
      })
      .returning()
      .get()
    const run = tx
      .insert(agentRuns)
      .values({
        id: runId,
        chatId,
        subChatId,
        harness,
        model,
        permissionMode,
        worktreePath,
        status: "running",
        startedAt: new Date(),
      })
      .returning()
      .get()
    return { chat, subChat, run }
  })
  notifyTestControlView({ action: "chat-created", chatId })
  return {
    chatId: created.chat.id,
    subChatId: created.subChat.id,
    runId: created.run.id,
    harness: created.chat.harness,
    model: created.chat.model,
    permissionMode: created.chat.permissionMode,
    worktreePath: created.chat.worktreePath,
    exposure: getChatMcpExposureStatus(chatId),
  }
}

function resolveProductMcpTestRepoPath(repoPath: string | undefined) {
  if (!repoPath) return null
  const requested = realpathSync(repoPath)
  const checkout = realpathSync(app.getAppPath())
  if (requested !== checkout || !statSync(requested).isDirectory()) {
    throw new Error("Product MCP test repo path must match the running dev checkout.")
  }
  return requested
}

export function setProductMcpTestExposure(input: { chatId: string; enabled: boolean }) {
  requireProductMcpTestCaller(input.chatId)
  setChatMcpExposure(input.chatId, input.enabled)
  return getChatMcpExposureStatus(input.chatId)
}

export function startProductMcpTestCall(
  input: { chatId: string; runId: string; toolName: string; arguments?: Record<string, unknown> },
  options: { registration?: McpStdioRegistration } = {},
) {
  const db = getDatabase()
  requireProductMcpTestCaller(input.chatId)
  const run = db.select().from(agentRuns).where(eq(agentRuns.id, input.runId)).get()
  if (!run || run.chatId !== input.chatId || run.status !== "running") {
    throw new Error("Product MCP test caller run is missing or stale.")
  }
  const exposure = getChatMcpExposureStatus(input.chatId)
  if (!exposure.enabled) throw new Error("Product MCP exposure is disabled for the test caller.")

  pruneProductMcpTestCalls()
  const registration =
    options.registration ??
    buildMcpStdioRegistration(
      {
        chatId: input.chatId,
        runId: input.runId,
        permissionMode: run.permissionMode ?? "full-access",
      },
      {
        executablePath: process.execPath,
        mainDirectory: __dirname,
        databasePath: getDatabasePath(),
      },
    )
  const session = getOrCreateProductMcpTestSession(input.chatId, input.runId, registration)
  const id = randomUUID()
  const call: ProductMcpTestCall = {
    id,
    chatId: input.chatId,
    runId: input.runId,
    toolName: input.toolName,
    status: "running",
    response: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    sessionKey: session.key,
  }
  productMcpTestCalls.set(id, call)
  void (async () => {
    try {
      await session.connected
      const response = await session.client.callTool({
        name: input.toolName,
        arguments: input.arguments ?? {},
      })
      if (call.status !== "cancelled") {
        call.status = response.isError ? "failed" : "completed"
        call.response = response.structuredContent ?? { isError: response.isError === true }
        call.finishedAt = new Date().toISOString()
      }
    } catch (error) {
      if (call.status !== "cancelled") {
        call.status = "failed"
        call.error = redactSecretLikeText(
          error instanceof Error ? error.message : "Product MCP test call failed.",
        )
        call.finishedAt = new Date().toISOString()
      }
    }
  })()
  return productMcpTestCallDto(call)
}

function getOrCreateProductMcpTestSession(
  chatId: string,
  runId: string,
  registration: McpStdioRegistration,
) {
  const key = `${chatId}\u0000${runId}`
  const current = productMcpTestSessions.get(key)
  if (current && !current.closed) return current

  const transport = new StdioClientTransport({
    command: registration.command,
    args: registration.args,
    env: { PATH: process.env.PATH ?? "", ...registration.env },
    stderr: "pipe",
  })
  const client = new Client({ name: "flapstack-dev-test-control", version: "1.0.0" })
  let session!: ProductMcpTestSession
  const release = registerActiveProductMcpSession({
    chatId,
    runId,
    revoke: () => closeProductMcpTestSession(session, "Product MCP exposure was disabled."),
  })
  session = {
    key,
    chatId,
    runId,
    client,
    transport,
    connected: client.connect(transport),
    release,
    closed: false,
  }
  productMcpTestSessions.set(key, session)
  return session
}

function closeProductMcpTestSession(session: ProductMcpTestSession, reason?: string) {
  if (session.closed) return
  session.closed = true
  if (productMcpTestSessions.get(session.key) === session) {
    productMcpTestSessions.delete(session.key)
  }
  if (reason) {
    const finishedAt = new Date().toISOString()
    for (const call of productMcpTestCalls.values()) {
      if (call.sessionKey !== session.key || call.status !== "running") continue
      call.status = "cancelled"
      call.error = reason
      call.finishedAt = finishedAt
    }
  }
  session.release()
  void session.client.close().catch(() => session.transport.close().catch(() => undefined))
}

export function getProductMcpTestCall(input: { callId: string }) {
  const call = productMcpTestCalls.get(input.callId)
  if (!call) throw new Error("Product MCP test call not found.")
  return productMcpTestCallDto(call)
}

export function replyProductMcpApproval(input: {
  approvalId: string
  decision: "approve" | "deny"
  grantSession?: boolean
}) {
  const approval = listPendingMcpApprovals(getDatabase()).find(
    (candidate) => candidate.id === input.approvalId,
  )
  if (!approval) throw new Error("Pending product MCP test approval not found.")
  requireProductMcpTestCaller(approval.chatId)
  return {
    resolved: decideMcpApproval(getDatabase(), {
      id: input.approvalId,
      decision: input.decision,
      grantSession: input.grantSession === true,
    }),
  }
}

export function getProductMcpState(input: {
  chatId: string
  toolName?: string
  decision?: McpAuditStatus
  from?: string
  to?: string
  cursor?: string
  limit?: number
}) {
  const db = getDatabase()
  const caller = requireProductMcpTestCaller(input.chatId)
  const from = parseProductMcpAuditTime(input.from, "from")
  const to = parseProductMcpAuditTime(input.to, "to")
  if (from && to && from > to) {
    throw new Error("Product MCP audit from time must not be after to time.")
  }
  const runs = db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.chatId, input.chatId))
    .orderBy(desc(agentRuns.startedAt))
    .all()
  const children = db
    .select()
    .from(chats)
    .where(eq(chats.parentChatId, input.chatId))
    .orderBy(desc(chats.createdAt))
    .all()
    .map((chat) => ({
      id: chat.id,
      harness: chat.harness,
      parentChatId: chat.parentChatId,
      initiatorChatId: chat.initiatorChatId,
      parentRunId: chat.parentRunId,
      ancestorChatIds: chat.ancestorChatIds,
      archived: Boolean(chat.archivedAt),
      runs: db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.chatId, chat.id))
        .orderBy(desc(agentRuns.startedAt))
        .all()
        .map(compactRun),
    }))
  return {
    caller: {
      id: caller.id,
      harness: caller.harness,
      permissionMode: caller.permissionMode,
      archived: Boolean(caller.archivedAt),
    },
    exposure: getChatMcpExposureStatus(input.chatId),
    runs: runs.map(compactRun),
    pendingApprovals: listPendingMcpApprovals(db).filter(
      (approval) => approval.chatId === input.chatId,
    ),
    audit: listMcpAuditRecords(db, {
      callerChatId: input.chatId,
      toolName: input.toolName,
      decision: input.decision,
      from,
      to,
      cursor: input.cursor,
      limit: input.limit,
    }),
    children,
    calls: [...productMcpTestCalls.values()]
      .filter((call) => call.chatId === input.chatId)
      .map(productMcpTestCallDto),
  }
}

function parseProductMcpAuditTime(value: string | undefined, field: "from" | "to") {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Product MCP audit ${field} time must be a valid ISO timestamp.`)
  }
  return parsed
}

export function manageProductMcpRecovery(input: {
  chatId: string
  action: "list" | "authorize-retry" | "reconcile-completed" | "reconcile-failed"
  invocationId?: string
}) {
  const db = getDatabase()
  requireProductMcpTestCaller(input.chatId)
  recoverMcpDispatchClaims(db)
  const claims = listMcpDispatchRecoveryClaims(db).filter(
    (claim) => claim.callerChatId === input.chatId,
  )
  let changed: boolean | null = null
  if (input.action !== "list") {
    if (!input.invocationId) throw new Error("Recovery action requires an invocation ID.")
    if (!claims.some((claim) => claim.invocationId === input.invocationId)) {
      throw new Error("Recovery claim does not belong to this product MCP test caller.")
    }
    changed =
      input.action === "authorize-retry"
        ? authorizeMcpDispatchRetry(db, input.invocationId)
        : reconcileMcpDispatchClaim(
            db,
            input.invocationId,
            input.action === "reconcile-completed" ? "completed" : "failed",
          )
  }
  return {
    changed,
    claims: listMcpDispatchRecoveryClaims(db).filter(
      (claim) => claim.callerChatId === input.chatId,
    ),
  }
}

export function cleanupProductMcpCaller(input: { chatId: string }) {
  const db = getDatabase()
  requireProductMcpTestCaller(input.chatId)
  setChatMcpExposure(input.chatId, false)
  const now = new Date()
  db.transaction((tx) => {
    tx.update(agentRuns)
      .set({ status: "cancelled", completedAt: now })
      .where(and(eq(agentRuns.chatId, input.chatId), eq(agentRuns.status, "running")))
      .run()
    tx.update(subChats)
      .set({ runStatus: "cancelled", updatedAt: now })
      .where(eq(subChats.chatId, input.chatId))
      .run()
    tx.update(chats)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(chats.id, input.chatId))
      .run()
  })
  notifyTestControlView({ action: "chat-archived", chatId: input.chatId })
  const children = db.select().from(chats).where(eq(chats.parentChatId, input.chatId)).all()
  const archivedChildren: string[] = []
  const activeChildren: string[] = []
  for (const child of children) {
    db.update(agentRuns)
      .set({ status: "cancelled", completedAt: now })
      .where(and(eq(agentRuns.chatId, child.id), eq(agentRuns.status, "pending")))
      .run()
    db.update(subChats)
      .set({ runStatus: "cancelled", updatedAt: now })
      .where(and(eq(subChats.chatId, child.id), eq(subChats.runStatus, "pending")))
      .run()
    const active = db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(eq(agentRuns.chatId, child.id), eq(agentRuns.status, "running")))
      .get()
    if (active) {
      activeChildren.push(child.id)
      continue
    }
    db.update(chats).set({ archivedAt: now, updatedAt: now }).where(eq(chats.id, child.id)).run()
    archivedChildren.push(child.id)
    notifyTestControlView({ action: "chat-archived", chatId: child.id })
  }
  return { chatId: input.chatId, archived: true, archivedChildren, activeChildren }
}

export async function cancelProductMcpChildRun(input: {
  chatId: string
  childChatId: string
  runId: string
}) {
  const db = getDatabase()
  requireProductMcpTestCaller(input.chatId)
  const child = db
    .select({ id: chats.id, parentChatId: chats.parentChatId })
    .from(chats)
    .where(eq(chats.id, input.childChatId))
    .get()
  if (!child || child.parentChatId !== input.chatId) {
    throw new Error("Product MCP child does not belong to this test caller.")
  }
  const foundRun = db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, input.runId), eq(agentRuns.chatId, input.childChatId)))
    .get()
  if (!foundRun) throw new Error("Product MCP child run not found.")
  let run = foundRun
  if (run.status === "pending") {
    const pendingRun = run
    if (!pendingRun.subChatId) throw new Error("Product MCP child run has no conversation.")
    const subChatId = pendingRun.subChatId
    const now = new Date()
    const cancelled = db.transaction((tx) => {
      const updated = tx
        .update(agentRuns)
        .set({ status: "cancelled", completedAt: now })
        .where(and(eq(agentRuns.id, pendingRun.id), eq(agentRuns.status, "pending")))
        .run()
      if (updated.changes !== 1) return false
      tx.update(subChats)
        .set({ runStatus: "cancelled", updatedAt: now })
        .where(eq(subChats.id, subChatId))
        .run()
      return true
    })
    if (cancelled) {
      return { cancelled: true, ignoredStale: false, status: "cancelled" as const }
    }
    const refreshed = db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.id, input.runId), eq(agentRuns.chatId, input.childChatId)))
      .get()
    if (!refreshed) throw new Error("Product MCP child run disappeared during cancellation.")
    run = refreshed
  }
  if (!run.subChatId) throw new Error("Product MCP child run has no conversation.")
  if (run.status !== "running") {
    return { cancelled: false, ignoredStale: true, status: run.status }
  }
  const outcome =
    run.harness === "codex"
      ? (await import("../trpc/routers/codex")).cancelActiveCodexRun({
          subChatId: run.subChatId,
          runId: run.id,
        })
      : run.harness === "claude-code"
        ? (await import("../trpc/routers/claude")).cancelActiveClaudeSession({
            subChatId: run.subChatId,
            runId: run.id,
          })
        : { cancelled: false, ignoredStale: true }
  return { ...outcome, status: run.status }
}

function requireProductMcpTestCaller(chatId: string) {
  const db = getDatabase()
  const caller = db.select().from(chats).where(eq(chats.id, chatId)).get()
  const fixtureConversation = db
    .select({ id: subChats.id, name: subChats.name })
    .from(subChats)
    .where(eq(subChats.chatId, chatId))
    .all()
    .some(
      (conversation) =>
        typeof conversation.name === "string" && conversation.name.startsWith("MCP live test "),
    )
  if (
    !caller ||
    caller.scope !== "global" ||
    caller.parentChatId !== null ||
    !fixtureConversation
  ) {
    throw new Error("Refusing an MCP test action for a non-test caller chat.")
  }
  return caller
}

function productMcpTestCallDto(call: ProductMcpTestCall) {
  return {
    id: call.id,
    chatId: call.chatId,
    runId: call.runId,
    toolName: call.toolName,
    status: call.status,
    response: call.response,
    error: call.error,
    startedAt: call.startedAt,
    finishedAt: call.finishedAt,
  }
}

function pruneProductMcpTestCalls() {
  const terminal = [...productMcpTestCalls.values()]
    .filter((call) => call.status !== "running")
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  for (const call of terminal.slice(0, Math.max(0, productMcpTestCalls.size - 50))) {
    productMcpTestCalls.delete(call.id)
  }
}

export async function resetProductMcpTestCallsForTests() {
  const sessions = [...productMcpTestSessions.values()]
  productMcpTestCalls.clear()
  productMcpTestSessions.clear()
  for (const session of sessions) closeProductMcpTestSession(session)
  await Promise.all(sessions.map((session) => session.client.close().catch(() => undefined)))
}

export async function getProviderStatus() {
  return Promise.all(
    OPENCODE_HARNESSES.map(async (provider) => {
      const credential = await getCredentialStatusAsync(provider)
      const models = getAvailableProviderModels(provider)
      return {
        provider,
        configured: credential.configured,
        sessionOnly: credential.sessionOnly === true,
        baseUrl: credential.baseUrl ?? null,
        modelSource: models.source,
        modelCount: models.models.length,
      }
    }),
  )
}

export function ensureTestProject(input?: { name?: string }, repoPath = process.cwd()) {
  const projectPath = resolve(repoPath)
  if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
    throw new Error("Active development checkout is not a directory")
  }
  const db = getDatabase()
  const existing = db.select().from(projects).where(eq(projects.path, projectPath)).get()
  const now = new Date()
  if (existing) {
    const project = db
      .update(projects)
      .set({
        archivedAt: null,
        updatedAt: now,
        ...(input?.name?.trim() ? { name: input.name.trim() } : {}),
      })
      .where(eq(projects.id, existing.id))
      .returning()
      .get()
    bindRegisteredFilesystemRoot(projectPath)
    notifyTestControlView({ action: "project-created", projectId: project!.id })
    return { project: project!, created: false, restored: Boolean(existing.archivedAt) }
  }

  bindFilesystemRootIdentity(projectPath)
  const project = db
    .insert(projects)
    .values({ name: input?.name?.trim() || basename(projectPath), path: projectPath })
    .returning()
    .get()
  notifyTestControlView({ action: "project-created", projectId: project!.id })
  return { project: project!, created: true, restored: false }
}

export function archiveTestProject(input: { projectId: string }) {
  const db = getDatabase()
  const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get()
  if (!project) throw new Error("Project not found")
  if (resolve(project.path) !== resolve(process.cwd())) {
    throw new Error("Only the active development checkout can be archived by test control")
  }
  const activeChat = db
    .select({ id: chats.id })
    .from(chats)
    .where(and(eq(chats.projectId, project.id), isNull(chats.archivedAt)))
    .get()
  if (activeChat) throw new Error(`Project has an active chat: ${activeChat.id}`)
  if (project.archivedAt) {
    return { archived: true, alreadyArchived: true, projectId: project.id }
  }
  const archivedAt = new Date()
  db.update(projects)
    .set({ archivedAt, updatedAt: archivedAt })
    .where(eq(projects.id, project.id))
    .run()
  notifyTestControlView({ action: "project-archived", projectId: project.id })
  return {
    archived: true,
    alreadyArchived: false,
    projectId: project.id,
    archivedAt: archivedAt.toISOString(),
  }
}

export async function listProviderExtensions(input?: { cwd?: string }) {
  const items = await discoverProviderExtensions({ cwd: input?.cwd })
  const counts = items.reduce<Record<string, number>>((result, item) => {
    const key = `${item.provider}:${item.kind}:${item.source}`
    result[key] = (result[key] ?? 0) + 1
    return result
  }, {})
  return {
    cwd: input?.cwd ?? null,
    total: items.length,
    counts,
    items: items.map(({ content: _content, ...item }) => item),
  }
}

export async function mutateProjectProviderExtension(input: {
  operation: "create" | "update" | "delete"
  provider: ProviderExtensionProvider
  kind: ProviderExtensionKind
  cwd: string
  sourceId?: string
  name: string
  description?: string
  content?: string
}) {
  return mutateProviderExtension({
    ...input,
    source: "project",
    description: input.description ?? "",
    content: input.content ?? "",
  })
}

function safeMessageMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return null
  const keys = [
    "harness",
    "model",
    "runId",
    "durationMs",
    "startedAt",
    "resultSubtype",
    "permissionMode",
    "permissionApplication",
    "reasoningControl",
    "limitations",
    "toolActivity",
    "approvalActivity",
    "usage",
    "inputTokens",
    "outputTokens",
    "reasoningTokens",
    "totalTokens",
    "totalCostUsd",
    "modelContextWindow",
    "sessionId",
  ]
  return sanitizeOpencodeAuditValue(
    Object.fromEntries(keys.filter((key) => key in metadata).map((key) => [key, metadata[key]])),
  )
}

function compactMessages(raw: string | null | undefined, limit = 30) {
  return parseStoredMessages(raw)
    .slice(-Math.min(Math.max(limit, 1), 100))
    .map((message) => ({
      id: message.id ?? null,
      role: message.role ?? null,
      text: getMessageText(message).slice(0, 8_000),
      partTypes: Array.isArray(message.parts)
        ? message.parts.map((part) => part.type).filter(Boolean)
        : [],
      metadata: safeMessageMetadata(message.metadata),
    }))
}

export function getChatState(input: { subChatId: string; messageLimit?: number }) {
  const db = getDatabase()
  const subChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
  if (!subChat) throw new Error("Sub-chat not found")
  const chat = db.select().from(chats).where(eq(chats.id, subChat.chatId)).get()
  const runs = db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.subChatId, input.subChatId))
    .orderBy(desc(agentRuns.startedAt))
    .limit(20)
    .all()
  return {
    chat: chat
      ? {
          id: chat.id,
          name: chat.name,
          harness: chat.harness,
          model: chat.model,
          permissionMode: chat.permissionMode,
          worktreePath: chat.worktreePath,
        }
      : null,
    subChat: {
      id: subChat.id,
      sessionId: subChat.sessionId,
      harness: subChat.harness,
      model: subChat.model,
      permissionMode: subChat.permissionMode,
      worktreePath: subChat.worktreePath,
      runStatus: subChat.runStatus,
      updatedAt: compactTimestamp(subChat.updatedAt),
    },
    messages: compactMessages(subChat.messages, input.messageLimit),
    runs: runs.map(compactRun),
    pendingApprovals: listPendingOpencodeApprovals().filter((approval) =>
      runs.some((run) => run.id === approval.runId),
    ),
  }
}

function compactRun(run: typeof agentRuns.$inferSelect) {
  return {
    id: run.id,
    chatId: run.chatId,
    subChatId: run.subChatId,
    harness: run.harness,
    model: run.model,
    permissionMode: run.permissionMode,
    worktreePath: run.worktreePath,
    status: run.status,
    startedAt: compactTimestamp(run.startedAt),
    completedAt: compactTimestamp(run.completedAt),
    beforeCheckpointId: run.beforeCheckpointId,
    afterCheckpointId: run.afterCheckpointId,
  }
}

function compactTimestamp(value: Date | null) {
  if (!value) return null
  // Some established raw-SQL launch paths store epoch milliseconds while
  // Drizzle's timestamp mapper expects seconds. Normalize the mapped 1000x
  // value for truthful dev-control evidence without rewriting durable data.
  const normalized = value.getUTCFullYear() > 9999 ? new Date(value.getTime() / 1000) : value
  return normalized.toISOString()
}

export function getRunState(input: { runId: string }) {
  const db = getDatabase()
  const run = db.select().from(agentRuns).where(eq(agentRuns.id, input.runId)).get()
  if (!run) return { found: false, run: null, assistant: null, pendingApprovals: [] }
  const subChat = run.subChatId
    ? db.select().from(subChats).where(eq(subChats.id, run.subChatId)).get()
    : null
  const assistant = subChat
    ? parseStoredMessages(subChat.messages)
        .filter((message) => message.role === "assistant" && message.metadata?.runId === run.id)
        .at(-1)
    : null
  return {
    found: true,
    run: compactRun(run),
    assistant: assistant
      ? {
          id: assistant.id ?? null,
          text: getMessageText(assistant).slice(0, 8_000),
          metadata: safeMessageMetadata(assistant.metadata),
        }
      : null,
    pendingApprovals: listPendingOpencodeApprovals(run.id),
  }
}

export function getReasoningTimerState(input: { runId: string; nowMs?: number }) {
  const db = getDatabase()
  const run = db.select().from(agentRuns).where(eq(agentRuns.id, input.runId)).get()
  if (!run) return { found: false, runId: input.runId, timer: null }

  const subChat = run.subChatId
    ? db.select().from(subChats).where(eq(subChats.id, run.subChatId)).get()
    : null
  const assistant = subChat
    ? parseStoredMessages(subChat.messages)
        .filter((message) => message.role === "assistant" && message.metadata?.runId === run.id)
        .at(-1)
    : null
  const metadata = assistant?.metadata as Record<string, unknown> | undefined
  const metadataStartedAt = typeof metadata?.startedAt === "number" ? metadata.startedAt : undefined
  const metadataDuration =
    typeof metadata?.durationMs === "number" ? metadata.durationMs : undefined
  const activeStartedAt = getActiveOpencodeRunStartedAt(run.id)

  return {
    found: true,
    runId: run.id,
    subChatId: run.subChatId,
    timer: buildReasoningTimerState({
      status: run.status,
      startedAtMs: metadataStartedAt ?? activeStartedAt ?? run.startedAt?.getTime(),
      completedAtMs: run.completedAt?.getTime(),
      durationMs: metadataDuration,
      nowMs: input.nowMs,
    }),
  }
}

export function listPendingApprovals(input?: { runId?: string }) {
  return listPendingOpencodeApprovals(input?.runId)
}

export function getOpencodeLogs(input?: { sessionId?: string; maxLines?: number }) {
  const maxLines = Math.min(Math.max(input?.maxLines ?? 120, 1), 500)
  const entries: Array<{ path: string; modifiedAt: string; lines: string[] }> = []
  let names: string[] = []
  try {
    names = readdirSync(tmpdir()).filter((name) => name.startsWith("flapstack-opencode-"))
  } catch {
    return { entries }
  }
  for (const name of names) {
    const path = join(tmpdir(), name, "xdg-data", "opencode", "log", "opencode.log")
    if (!existsSync(path)) continue
    try {
      const text = readFileSync(path, "utf8")
      if (input?.sessionId && !text.includes(input.sessionId)) continue
      entries.push({
        path,
        modifiedAt: statSync(path).mtime.toISOString(),
        lines: text
          .split("\n")
          .filter(Boolean)
          .slice(-maxLines)
          .map((line) => redactSecretLikeText(line).slice(0, 8_000)),
      })
    } catch {
      // A sidecar may remove its isolated directory while logs are being read.
    }
  }
  return {
    entries: entries
      .sort((left, right) => left.modifiedAt.localeCompare(right.modifiedAt))
      .slice(-10),
  }
}

export function createTestChat(input: {
  projectId: string
  name: string
  provider: OpencodeHarness | "cursor-agent"
  model: string
  permissionMode?: string
}) {
  const db = getDatabase()
  const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get()
  if (!project) throw new Error("Project not found")
  const permissionMode = input.permissionMode ?? project.defaultPermissionMode
  const permissionPreferences = getPermissionPreferences()
  const inheritedCustomPermissions =
    project.defaultCustomPermissions ??
    (permissionPreferences.globalCustomPermissions
      ? JSON.stringify(permissionPreferences.globalCustomPermissions)
      : null)
  if (permissionMode === "custom" && !inheritedCustomPermissions) {
    throw new Error("Custom test chats require project or global capability defaults")
  }
  const created = db.transaction((tx) => {
    const chat = tx
      .insert(chats)
      .values({
        name: input.name,
        projectId: project.id,
        scope: "project",
        harness: input.provider,
        model: input.model,
        permissionMode,
        customPermissions: permissionMode === "custom" ? inheritedCustomPermissions : null,
        worktreePath: project.path,
      })
      .returning()
      .get()
    const subChat = tx
      .insert(subChats)
      .values({
        chatId: chat.id,
        name: input.name,
        mode: "agent",
        harness: input.provider,
        model: input.model,
        permissionMode,
        worktreePath: project.path,
        messages: "[]",
      })
      .returning()
      .get()
    return { chat, subChat }
  })
  notifyTestControlView({ action: "chat-created", chatId: created.chat.id })
  return {
    chatId: created.chat.id,
    subChatId: created.subChat.id,
    projectId: project.id,
    name: input.name,
    provider: input.provider,
    model: input.model,
    permissionMode,
    worktreePath: project.path,
  }
}

export function openTestChat(input: { chatId: string }) {
  const db = getDatabase()
  const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
  if (!chat) throw new Error("Chat not found")
  if (chat.archivedAt) throw new Error("Archived chats must be restored before opening")
  const subChat = db
    .select({ id: subChats.id })
    .from(subChats)
    .where(eq(subChats.chatId, chat.id))
    .orderBy(desc(subChats.updatedAt))
    .get()
  notifyTestControlView({
    action: "chat-opened",
    chatId: chat.id,
    subChatId: subChat?.id ?? null,
  })
  return { opened: true, chatId: chat.id, subChatId: subChat?.id ?? null }
}

export function archiveTestChat(input: { chatId: string }) {
  const db = getDatabase()
  const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
  if (!chat) throw new Error("Chat not found")
  if (chat.archivedAt) return { archived: true, alreadyArchived: true, chatId: chat.id }
  const activeRun = db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.chatId, input.chatId), eq(agentRuns.status, "running")))
    .get()
  if (activeRun) throw new Error(`Chat has an active run: ${activeRun.id}`)

  const archivedAt = new Date()
  db.update(chats).set({ archivedAt, updatedAt: archivedAt }).where(eq(chats.id, chat.id)).run()
  notifyTestControlView({ action: "chat-archived", chatId: chat.id })
  return {
    archived: true,
    alreadyArchived: false,
    chatId: chat.id,
    archivedAt: archivedAt.toISOString(),
  }
}

export async function launchTestRun(input: {
  subChatId: string
  prompt: string
  provider?: OpencodeHarness | "cursor-agent"
  model?: string
  cwd?: string
  reasoningEnabled?: boolean
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh"
}) {
  const db = getDatabase()
  const subChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
  if (!subChat) throw new Error("Sub-chat not found")
  const chat = db.select().from(chats).where(eq(chats.id, subChat.chatId)).get()
  if (!chat) throw new Error("Chat not found")
  const provider = input.provider ?? subChat.harness ?? chat.harness
  if (provider !== "cursor-agent" && !OPENCODE_HARNESSES.includes(provider as OpencodeHarness)) {
    return {
      launched: false,
      supportedHarnesses: ["cursor-agent", ...OPENCODE_HARNESSES],
      reason: `Harness ${provider ?? "unknown"} does not expose a reusable dev launch service.`,
    }
  }
  const model = input.model ?? subChat.model ?? chat.model
  const cwd = input.cwd ?? subChat.worktreePath ?? chat.worktreePath
  if (!model) throw new Error("No model configured for this chat")
  if (!cwd) throw new Error("No worktree path configured for this chat")
  if (!input.prompt.trim()) throw new Error("Prompt cannot be empty")
  if (provider === "cursor-agent") {
    const { runId } = await startCursorDevRun({
      subChatId: subChat.id,
      chatId: chat.id,
      model,
      prompt: input.prompt.trim(),
      cwd,
      projectPath: cwd,
    })
    return { launched: true, runId, subChatId: subChat.id, chatId: chat.id, provider, model, cwd }
  }
  const credential = await getCredentialStatusAsync(provider as OpencodeHarness)
  if (!credential.configured) {
    return { launched: false, reason: `${provider} is not configured in this app session.` }
  }
  const normalizedModel = normalizeOpencodeModelId(provider as OpencodeHarness, model)
  const { runId } = await startOpencodeDevRun({
    subChatId: subChat.id,
    chatId: chat.id,
    provider: provider as OpencodeHarness,
    model: normalizedModel,
    prompt: input.prompt.trim(),
    cwd,
    projectPath: cwd,
    reasoningEnabled: input.reasoningEnabled,
    reasoningEffort: input.reasoningEffort,
  })
  return {
    launched: true,
    runId,
    subChatId: subChat.id,
    chatId: chat.id,
    provider,
    model: normalizedModel,
    cwd,
  }
}

export async function launchHarnessTestRun(input: {
  subChatId: string
  prompt: string
  harness?: "codex" | "claude-code"
  model?: string
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh"
}) {
  const db = getDatabase()
  const subChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
  if (!subChat) throw new Error("Sub-chat not found")
  const chat = db.select().from(chats).where(eq(chats.id, subChat.chatId)).get()
  if (!chat || chat.archivedAt) throw new Error("Active chat not found")
  if (!chat.projectId) throw new Error("Harness test runs require a persisted project")
  const project = db.select().from(projects).where(eq(projects.id, chat.projectId)).get()
  if (!project || project.archivedAt) throw new Error("Active project not found")
  const harness = input.harness ?? subChat.harness ?? chat.harness
  if (harness !== "codex" && harness !== "claude-code") {
    throw new Error("Harness test runs support Codex and Claude only")
  }
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error("Prompt cannot be empty")
  const runId = randomUUID()
  const model =
    input.model ??
    subChat.model ??
    chat.model ??
    (harness === "codex" ? SAFE_CHATGPT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL_ID)
  const run = {
    runId,
    chatId: chat.id,
    subChatId: subChat.id,
    harness,
    prompt,
    model,
    reasoningEffort: input.reasoningEffort ?? "minimal",
    permissionMode: subChat.permissionMode ?? chat.permissionMode ?? "ask-before-edits",
    customPermissions: chat.customPermissions ?? null,
    worktreePath: project.path,
    projectPath: project.path,
  } as const
  const { createMainRunLauncher } = await import("../main-run-launcher")
  void createMainRunLauncher()(run).catch((error: unknown) =>
    console.warn(
      `[dev-mcp] ${harness} test run ${runId} ended with:`,
      error instanceof Error ? error.message : "unknown failure",
    ),
  )
  return {
    launched: true,
    runId,
    chatId: chat.id,
    subChatId: subChat.id,
    harness,
    model,
    permissionMode: run.permissionMode,
    projectId: project.id,
  }
}

export function listCodexPermissionRequests(input?: { runId?: string }) {
  return listPendingCodexPermissionRequests(input).map((request) => ({
    ...request,
    title: redactSecretLikeText(request.title).slice(0, 500),
    options: request.options.map((option) => ({
      ...option,
      name: redactSecretLikeText(option.name).slice(0, 200),
    })),
  }))
}

export function replyCodexPermissionRequest(input: { requestId: string; optionId: string }) {
  return replyPendingCodexPermissionRequest(input)
}

export function replyApproval(input: {
  requestId: string
  reply: "once" | "always" | "reject"
  message?: string
}) {
  return replyPendingOpencodeApproval(input)
}

export function cancelRun(input: { subChatId: string; runId: string }) {
  const run = getDatabase().select().from(agentRuns).where(eq(agentRuns.id, input.runId)).get()
  if (run?.harness === "cursor-agent") return cancelActiveCursorRun(input)
  return cancelActiveOpencodeRun(input)
}

export async function waitForRunState(input: {
  runId: string
  timeoutMs?: number
  pollMs?: number
}) {
  const timeoutAt = Date.now() + Math.min(input.timeoutMs ?? 60_000, 300_000)
  const pollMs = Math.min(Math.max(input.pollMs ?? 500, 100), 10_000)
  while (Date.now() < timeoutAt) {
    const state = getRunState({ runId: input.runId })
    if (state.run && state.run.status !== "running") return { completed: true, ...state }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  return {
    completed: false,
    reason: "Timed out waiting for terminal run state.",
    ...getRunState(input),
  }
}

export function setChatRunConfig(input: {
  subChatId: string
  harness: "codex" | "claude-code"
  model?: string
  permissionMode?: string
  worktreePath?: string
}) {
  const db = getDatabase()
  const subChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
  if (!subChat) throw new Error("Sub-chat not found")

  const messages = parseStoredMessages(subChat.messages)
  const metadata = {
    devMcpRunConfig: {
      harness: input.harness,
      model:
        input.harness === "codex"
          ? input.model || SAFE_CHATGPT_CODEX_MODEL
          : input.model || DEFAULT_CLAUDE_MODEL_ID,
      permissionMode: input.permissionMode ?? null,
      worktreePath: input.worktreePath ?? null,
      updatedAt: new Date().toISOString(),
    },
  }
  const runConfig = metadata.devMcpRunConfig

  messages.push({
    id: `dev-mcp-config-${Date.now()}`,
    role: "system",
    parts: [{ type: "text", text: "Dev MCP test run config updated." }],
    metadata,
  })

  db.update(subChats)
    .set({
      harness: runConfig.harness,
      model: runConfig.model,
      permissionMode: runConfig.permissionMode,
      worktreePath: runConfig.worktreePath,
      messages: JSON.stringify(messages),
      updatedAt: new Date(),
    })
    .where(eq(subChats.id, input.subChatId))
    .run()

  const parentChat = db.select().from(chats).where(eq(chats.id, subChat.chatId)).get()
  if (parentChat) {
    db.update(chats)
      .set({
        harness: runConfig.harness,
        model: runConfig.model,
        permissionMode: runConfig.permissionMode ?? parentChat.permissionMode,
        worktreePath: runConfig.worktreePath ?? parentChat.worktreePath,
        updatedAt: new Date(),
      })
      .where(eq(chats.id, parentChat.id))
      .run()
  }

  return runConfig
}

export function sendTestPrompt(input: { subChatId: string; prompt: string; noEdit?: boolean }) {
  const db = getDatabase()
  const subChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
  if (!subChat) throw new Error("Sub-chat not found")

  const prompt = input.noEdit ? `${input.prompt.trim()}\n\nDo not edit files.` : input.prompt.trim()
  if (!prompt) throw new Error("Prompt cannot be empty")

  const messages = appendUserMessage(subChat.messages, prompt, {
    devMcpTestPrompt: true,
    noEdit: Boolean(input.noEdit),
  })

  db.update(subChats)
    .set({ messages, updatedAt: new Date() })
    .where(eq(subChats.id, input.subChatId))
    .run()

  return {
    subChatId: input.subChatId,
    prompt,
    appended: true,
  }
}

export async function waitForRun(input: {
  subChatId: string
  afterAssistantCount?: number
  timeoutMs?: number
  pollMs?: number
}) {
  const timeoutAt = Date.now() + (input.timeoutMs ?? 60_000)
  const pollMs = input.pollMs ?? 1_000

  while (Date.now() < timeoutAt) {
    const verified = verifyRunArtifacts({
      subChatId: input.subChatId,
      expectedAssistantText: undefined,
    })

    if (verified.messageCounts.assistant > (input.afterAssistantCount ?? 0)) {
      return { completed: true, ...verified }
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  return {
    completed: false,
    reason: "Timed out waiting for assistant reply.",
    ...verifyRunArtifacts({ subChatId: input.subChatId }),
  }
}

export function verifyRunArtifacts(input: {
  subChatId: string
  expectedAssistantText?: string
  noEditExpected?: boolean
}) {
  const db = getDatabase()
  const subChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
  if (!subChat) throw new Error("Sub-chat not found")

  const messages = parseStoredMessages(subChat.messages)
  const lastAssistant = findLastAssistantMessage(messages)
  const lastAssistantText = lastAssistant ? getMessageText(lastAssistant) : null
  const messageCounts = summarizeMessages(subChat.messages)
  const expectedTextMatched =
    input.expectedAssistantText === undefined
      ? null
      : Boolean(lastAssistantText?.includes(input.expectedAssistantText))
  const latestRun = db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.subChatId, input.subChatId))
    .orderBy(desc(agentRuns.startedAt))
    .get()
  const runCheckpoints = latestRun
    ? db.select().from(checkpoints).where(eq(checkpoints.runId, latestRun.id)).all()
    : []
  const manifest = latestRun
    ? db.select().from(fileChangeManifests).where(eq(fileChangeManifests.runId, latestRun.id)).all()
    : []
  const manifestHasOnlyNoChanges =
    manifest.length > 0 && manifest.every((entry) => entry.changeType === "none")

  return {
    subChatId: input.subChatId,
    sessionId: subChat.sessionId,
    streamId: subChat.streamId,
    runStatus: subChat.runStatus,
    hasAssistantReply: Boolean(lastAssistant),
    lastAssistantText,
    expectedTextMatched,
    noEditExpected: Boolean(input.noEditExpected),
    run: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          harness: latestRun.harness,
          model: latestRun.model,
          permissionMode: latestRun.permissionMode,
          worktreePath: latestRun.worktreePath,
          beforeCheckpointId: latestRun.beforeCheckpointId,
          afterCheckpointId: latestRun.afterCheckpointId,
          completedAt: compactTimestamp(latestRun.completedAt),
        }
      : null,
    checkpoints: runCheckpoints.map((checkpoint) => ({
      id: checkpoint.id,
      kind: checkpoint.kind,
      worktreePath: checkpoint.worktreePath,
      gitCommit: checkpoint.gitCommit,
      createdAt: compactTimestamp(checkpoint.createdAt),
    })),
    manifest: manifest.map((entry) => ({
      id: entry.id,
      filePath: entry.filePath,
      changeType: entry.changeType,
      additions: entry.additions,
      deletions: entry.deletions,
    })),
    noEditMatched: input.noEditExpected ? manifestHasOnlyNoChanges : null,
    messageCounts,
  }
}

export async function runProjectCheck(input: { repoPath?: string; timeoutMs?: number }) {
  const repoPath = input.repoPath ?? process.cwd()
  const result = await runShellCommand("npm", ["run", "check"], {
    cwd: repoPath,
    timeoutMs: input.timeoutMs ?? 180_000,
    env: withRecommendedNodePath(),
  })

  return redactShellResult(result)
}

export async function openspecValidate(input: { repoPath?: string; timeoutMs?: number }) {
  const repoPath = input.repoPath ?? process.cwd()
  const result = await runShellCommand(
    "npx",
    [
      "-y",
      "@fission-ai/openspec",
      "validate",
      "add-stage1-workspace-core",
      "--strict",
      "--no-interactive",
    ],
    {
      cwd: repoPath,
      timeoutMs: input.timeoutMs ?? 120_000,
      env: {
        ...withRecommendedNodePath(),
        OPENSPEC_TELEMETRY: "0",
      },
    },
  )

  return redactShellResult(result)
}

export async function getHarnessStatusForRepo(input?: { probeCli?: boolean; repoPath?: string }) {
  return getHarnessStatus(input)
}
