import { and, desc, eq, isNull } from "drizzle-orm"
import { app, BrowserWindow } from "electron"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import {
  agentRuns,
  chats,
  checkpoints,
  fileChangeManifests,
  getDatabase,
  projects,
  subChats,
} from "../db"
import { DEFAULT_CLAUDE_MODEL_ID } from "../../../shared/model-catalog"
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
import { SAFE_CHATGPT_CODEX_MODEL } from "./codex-status"
import { devMcpExposedTools } from "./registry"
import { getHarnessStatus } from "./harness-status"
import { listDevAgentInputRendererStates } from "./renderer-state"
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

function notifyTestControlView(payload: DevTestControlViewPayload) {
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
      updatedAt: project.updatedAt?.toISOString() ?? null,
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
      updatedAt: chat.updatedAt?.toISOString() ?? null,
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
      updatedAt: subChat.updatedAt?.toISOString() ?? null,
    })),
  }
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
      updatedAt: subChat.updatedAt?.toISOString() ?? null,
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
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    beforeCheckpointId: run.beforeCheckpointId,
    afterCheckpointId: run.afterCheckpointId,
  }
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
  provider: OpencodeHarness
  model: string
  permissionMode?: string
}) {
  const db = getDatabase()
  const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get()
  if (!project) throw new Error("Project not found")
  const permissionMode = input.permissionMode ?? project.defaultPermissionMode
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
  provider?: OpencodeHarness
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
  if (!OPENCODE_HARNESSES.includes(provider as OpencodeHarness)) {
    return {
      launched: false,
      supportedHarnesses: [...OPENCODE_HARNESSES],
      reason: `Harness ${provider ?? "unknown"} does not expose a reusable dev launch service.`,
    }
  }
  const model = input.model ?? subChat.model ?? chat.model
  const cwd = input.cwd ?? subChat.worktreePath ?? chat.worktreePath
  if (!model) throw new Error("No model configured for this chat")
  if (!cwd) throw new Error("No worktree path configured for this chat")
  if (!input.prompt.trim()) throw new Error("Prompt cannot be empty")
  const credential = await getCredentialStatusAsync(provider as OpencodeHarness)
  if (!credential.configured) {
    return { launched: false, reason: `${provider} is not configured in this app session.` }
  }
  const { runId } = await startOpencodeDevRun({
    subChatId: subChat.id,
    chatId: chat.id,
    provider: provider as OpencodeHarness,
    model,
    prompt: input.prompt.trim(),
    cwd,
    projectPath: cwd,
    reasoningEnabled: input.reasoningEnabled,
    reasoningEffort: input.reasoningEffort,
  })
  return { launched: true, runId, subChatId: subChat.id, chatId: chat.id, provider, model, cwd }
}

export function replyApproval(input: {
  requestId: string
  reply: "once" | "always" | "reject"
  message?: string
}) {
  return replyPendingOpencodeApproval(input)
}

export function cancelRun(input: { subChatId: string; runId: string }) {
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
          completedAt: latestRun.completedAt?.toISOString() ?? null,
        }
      : null,
    checkpoints: runCheckpoints.map((checkpoint) => ({
      id: checkpoint.id,
      kind: checkpoint.kind,
      worktreePath: checkpoint.worktreePath,
      gitCommit: checkpoint.gitCommit,
      createdAt: checkpoint.createdAt?.toISOString() ?? null,
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
