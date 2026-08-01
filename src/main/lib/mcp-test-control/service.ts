import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { createHash, randomUUID } from "node:crypto"
import { and, asc, desc, eq, isNull } from "drizzle-orm"
import { app, BrowserWindow, ipcMain } from "electron"
import { sleep } from "../../../shared/sleep"
import { orchestrationTemplateDefinitionSchema } from "../../../shared/orchestration-operations"
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import {
  agentRuns,
  agentActivityEvents,
  agentProfiles,
  agentProfileStandaloneLaunches,
  chats,
  checkpoints,
  fileChangeManifests,
  getDatabase,
  getDatabasePath,
  orchestrationWorkflowRuns,
  projects,
  savedWorkspaces,
  subChats,
  taskOrchestrations,
  tasks,
} from "../db"
import { createAgentOrchestrationService } from "../agent-orchestration/service"
import { getAgentActivityStore } from "../agent-runtime/activity-service"
import { constructRuntimeSnapshot, runtimePermissionSnapshot } from "../agent-runtime/snapshot"
import { isPreviewExecutable, resolveFlapstackProtocol } from "./lifecycle"
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
  getStage6ElectronMeasurementContract,
  type Stage6ElectronMeasurementAction,
  type Stage6ElectronMeasurementOperation,
} from "../../../shared/stage6-electron-performance-control"
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
import { requireVoiceUiFixture } from "./carryover-controls"
import { listDevAgentInputRendererStates } from "./renderer-state"
import { getLastProtocolReceipt } from "../protocol-receipt"
import { resolveCanonicalProjectPath } from "../projects/project-path"
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
import { ensureOperationWorkspace } from "../saved-workspaces/operations"
import {
  appendUserMessage,
  buildActivityAssistant,
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
import {
  getStage4ProfileState as getStage4ProfileStateForDatabase,
  getStage4RuntimeState as getStage4RuntimeStateForDatabase,
  mutateStage4Profile as mutateStage4ProfileForDatabase,
  mutateStage4Runtime as mutateStage4RuntimeForDatabase,
  type Stage4ProfileMutationInput,
  type Stage4ProfileReadInput,
  type Stage4RuntimeControlInput,
} from "./stage4-runtime-profiles"
import { sanitizeStage4ControlBoundary } from "./stage4-boundary"
import {
  assertStage4FixtureProject,
  cleanupPersistedStage4Ownership,
  getOwnedStage4ProfileState,
  getOwnedStage4RuntimeState,
  mutateOwnedStage4Profile,
  mutateOwnedStage4Runtime,
  registerStage4Fixture,
  registerStage4FixtureProject,
  registerStage4FixtureWorkflows,
  stage4FixtureIdentity,
} from "./stage4-ownership"
export { getSettingsState, getVisibleCopySearchState } from "./settings"
export {
  getStage4OperationalState,
  mutateStage4OperationalState,
  redactStage4ErrorMessage,
  STAGE4_OPERATIONAL_ACTIONS,
} from "./stage4-operations"
import { registerStage4TestProject } from "./stage4-operations"
import { createElectronPerformanceBuildIdentity } from "../performance/electron-control"

export function getStage4RuntimeState(input: {
  fixtureHandle: string
  activityRunHandle?: string
  activityLimit?: number
}) {
  return sanitizeStage4ControlBoundary(
    getOwnedStage4RuntimeState(input, (ownedInput) =>
      getStage4RuntimeStateForDatabase(getDatabase(), ownedInput, getAgentActivityStore()),
    ),
  )
}

export function mutateStage4Runtime(input: Stage4RuntimeControlInput) {
  return sanitizeStage4ControlBoundary(
    mutateOwnedStage4Runtime(
      input,
      (ownedInput) =>
        mutateStage4RuntimeForDatabase(
          getDatabase(),
          ownedInput as Stage4RuntimeControlInput,
          getAgentActivityStore(),
        ),
      (ownedInput) =>
        getStage4RuntimeStateForDatabase(getDatabase(), ownedInput, getAgentActivityStore()),
    ),
  )
}

export function getStage4ProfileState(input: Stage4ProfileReadInput) {
  return sanitizeStage4ControlBoundary(
    getOwnedStage4ProfileState(input, (ownedInput) =>
      getStage4ProfileStateForDatabase(
        getDatabase(),
        getDatabasePath(),
        ownedInput as Stage4ProfileReadInput,
      ),
    ),
  )
}

export async function mutateStage4Profile(input: Stage4ProfileMutationInput) {
  return sanitizeStage4ControlBoundary(
    await mutateOwnedStage4Profile(
      input,
      (ownedInput) =>
        mutateStage4ProfileForDatabase(
          getDatabase(),
          getDatabasePath(),
          ownedInput as Stage4ProfileMutationInput,
        ),
      (ownedInput) =>
        getStage4ProfileStateForDatabase(
          getDatabase(),
          getDatabasePath(),
          ownedInput as Stage4ProfileReadInput,
        ),
    ),
  )
}

export async function cleanupOwnedStage4RuntimeProfiles() {
  const database = () => getDatabase()
  return sanitizeStage4ControlBoundary(
    await cleanupPersistedStage4Ownership({
      mutateRuntime: (input) =>
        mutateStage4RuntimeForDatabase(
          database(),
          input as Stage4RuntimeControlInput,
          getAgentActivityStore(),
        ),
      readRuntime: (input) =>
        getStage4RuntimeStateForDatabase(database(), input, getAgentActivityStore()),
      mutateProfile: (input) =>
        mutateStage4ProfileForDatabase(
          database(),
          getDatabasePath(),
          input as Stage4ProfileMutationInput,
        ),
      profileStatus: (profileId) => {
        const profile = database()
          .select({
            currentVersion: agentProfiles.currentVersion,
            archivedAt: agentProfiles.archivedAt,
            projectId: agentProfiles.projectId,
          })
          .from(agentProfiles)
          .where(eq(agentProfiles.id, profileId))
          .get()
        return {
          missing: !profile,
          archived: Boolean(profile?.archivedAt),
          currentVersion: profile?.currentVersion ?? null,
          projectId: profile?.projectId ?? null,
        }
      },
      fixtureRelationshipValid: ({ projectId, chatId, subChatId }) => {
        const chat = database()
          .select({ projectId: chats.projectId })
          .from(chats)
          .where(eq(chats.id, chatId))
          .get()
        const subChat = database()
          .select({ chatId: subChats.chatId })
          .from(subChats)
          .where(eq(subChats.id, subChatId))
          .get()
        return chat?.projectId === projectId && subChat?.chatId === chatId
      },
      continuationRelationshipValid: ({ projectId, sourceChatId, targetChatId }) => {
        const source = database()
          .select({ projectId: chats.projectId })
          .from(chats)
          .where(eq(chats.id, sourceChatId))
          .get()
        const target = database()
          .select({ projectId: chats.projectId, parentChatId: chats.parentChatId })
          .from(chats)
          .where(eq(chats.id, targetChatId))
          .get()
        return (
          source?.projectId === projectId &&
          target?.projectId === projectId &&
          target?.parentChatId === sourceChatId
        )
      },
      standaloneRelationshipValid: ({ projectId, launchId, chatId }) => {
        const launch = database()
          .select({
            chatId: agentProfileStandaloneLaunches.chatId,
            sourceKind: agentProfileStandaloneLaunches.sourceKind,
            sourceId: agentProfileStandaloneLaunches.sourceId,
          })
          .from(agentProfileStandaloneLaunches)
          .where(eq(agentProfileStandaloneLaunches.id, launchId))
          .get()
        const chat = database()
          .select({ projectId: chats.projectId })
          .from(chats)
          .where(eq(chats.id, chatId))
          .get()
        return (
          launch?.chatId === chatId &&
          launch?.sourceKind === "studio" &&
          launch?.sourceId === projectId &&
          chat?.projectId === projectId
        )
      },
      workflowRelationshipValid: ({ projectId, initiatingChatId, taskId, workflowRunId }) => {
        const workflow = database()
          .select({ taskId: orchestrationWorkflowRuns.taskId })
          .from(orchestrationWorkflowRuns)
          .where(eq(orchestrationWorkflowRuns.id, workflowRunId))
          .get()
        const task = database()
          .select({ projectId: tasks.projectId })
          .from(tasks)
          .where(eq(tasks.id, taskId))
          .get()
        const orchestration = database()
          .select({ initiatingChatId: taskOrchestrations.initiatingChatId })
          .from(taskOrchestrations)
          .where(eq(taskOrchestrations.taskId, taskId))
          .get()
        return (
          workflow?.taskId === taskId &&
          task?.projectId === projectId &&
          orchestration?.initiatingChatId === initiatingChatId
        )
      },
      launchMissing: (launchId) =>
        !database()
          .select({ id: agentProfileStandaloneLaunches.id })
          .from(agentProfileStandaloneLaunches)
          .where(eq(agentProfileStandaloneLaunches.id, launchId))
          .get(),
      chatMissingOrArchived: (chatId) => {
        const chat = database()
          .select({ archivedAt: chats.archivedAt })
          .from(chats)
          .where(eq(chats.id, chatId))
          .get()
        return !chat || Boolean(chat.archivedAt)
      },
      taskMissingOrArchived: (taskId) => {
        const task = database()
          .select({ archivedAt: tasks.archivedAt })
          .from(tasks)
          .where(eq(tasks.id, taskId))
          .get()
        return !task || Boolean(task.archivedAt)
      },
      archiveChat: (chatId) => archiveTestChat({ chatId }),
      archiveTask: (taskId) => archiveTestTask({ taskId }),
    }),
  )
}

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

export function getRendererAgentInputNavigationState() {
  return requestDevRendererControl({ command: "agent-input.get" })
}

export function getRendererUsageUiState() {
  return requestDevRendererControl({ command: "usage-ui.get" })
}

export function getRendererVoiceUiState(input: { historyId: string }) {
  requireVoiceUiFixture(input.historyId)
  return requestDevRendererControl({ command: "voice-ui.get", historyId: input.historyId })
}

export function controlRendererVoiceUi(input: {
  operation:
    | "open"
    | "search"
    | "copy-history"
    | "play-history"
    | "insert-history"
    | "delete-history"
    | "preview"
    | "stop"
    | "set-stt"
    | "set-tts"
    | "set-rate"
  value?: string
  historyId?: string
}) {
  if (
    ["copy-history", "play-history", "insert-history", "delete-history"].includes(input.operation)
  ) {
    if (!input.historyId) throw new Error(`${input.operation} requires a Voice fixture ID`)
    requireVoiceUiFixture(input.historyId)
  }
  return requestDevRendererControl({ command: "voice-ui.control", ...input })
}

export function controlRendererUsageUi(input: {
  operation:
    | "open"
    | "select-provider"
    | "set-scope"
    | "set-history-mode"
    | "set-history-range"
    | "open-monitoring"
    | "show-all"
    | "scroll-to"
  value?: string
  target?: "provider-states" | "alerts" | "samples" | "cycles"
}) {
  return requestDevRendererControl({ command: "usage-ui.control", ...input })
}

export function navigateAgentInputNotification(input: { requestId: string }) {
  const request = agentInputLifecycle
    .list()
    .find((candidate) => candidate.requestId === input.requestId)
  if (!request) throw new Error("Pending agent input request not found")
  const parentChatId = getDatabase()
    .select({ chatId: subChats.chatId })
    .from(subChats)
    .where(eq(subChats.id, request.chatId))
    .get()?.chatId
  if (!parentChatId) throw new Error("Agent input request chat context not found")
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
  if (windows.length === 0) throw new Error("Renderer window is unavailable")
  for (const window of windows) {
    window.webContents.send("app:notification-clicked", {
      chatId: parentChatId,
      subChatId: request.chatId,
    })
  }
  return {
    requestId: request.requestId,
    parentChatId,
    subChatId: request.chatId,
    rendererCount: windows.length,
  }
}

type RendererNavigationState = {
  selectedChatId?: unknown
  activeSubChatId?: unknown
  desktopView?: unknown
}

const RENDERER_CAPTURE_CHECKOUT_PREFIX = `flapstack-renderer-evidence-${createHash("sha256")
  .update(process.cwd())
  .digest("hex")
  .slice(0, 12)}-`
const RENDERER_CAPTURE_PREFIX = `${RENDERER_CAPTURE_CHECKOUT_PREFIX}${process.pid}-${randomUUID()}-`
const LEGACY_RENDERER_CAPTURE_PREFIX = "flapstack-renderer-evidence-"
const RENDERER_CAPTURE_TTL_MS = 15 * 60_000
const rendererCaptures = new Map<
  string,
  { directory: string; path: string; expiry: ReturnType<typeof setTimeout> }
>()

function releaseRendererCapture(captureId: string) {
  const capture = rendererCaptures.get(captureId)
  if (!capture) return false
  rendererCaptures.delete(captureId)
  clearTimeout(capture.expiry)
  rmSync(capture.directory, { recursive: true, force: true })
  return true
}

export function cleanupAllTestRendererCaptures() {
  for (const captureId of [...rendererCaptures.keys()]) releaseRendererCapture(captureId)
  for (const entry of readdirSync(tmpdir(), { withFileTypes: true })) {
    if (!entry.name.startsWith(LEGACY_RENDERER_CAPTURE_PREFIX)) continue
    const path = join(tmpdir(), entry.name)
    try {
      const belongsToThisInstance = entry.name.startsWith(RENDERER_CAPTURE_PREFIX)
      const isExpired = Date.now() - statSync(path).mtimeMs >= RENDERER_CAPTURE_TTL_MS
      if (belongsToThisInstance || isExpired) rmSync(path, { recursive: true, force: true })
    } catch {
      // A concurrent cleanup can remove the directory between listing and inspection.
    }
  }
}

export function cleanupTestRendererCapture(input: { captureId: string }) {
  return { captureId: input.captureId, deleted: releaseRendererCapture(input.captureId) }
}

async function requireExactRendererNavigation(
  window: BrowserWindow,
  chatId: string,
  expectedSubChatId?: string,
) {
  if (window.isDestroyed()) throw new Error("Renderer window is unavailable")
  const navigation = (await requestDevRendererControlForWindow(
    { command: "agent-input.get" },
    window,
  )) as RendererNavigationState
  if (navigation.selectedChatId !== chatId || navigation.desktopView !== null) {
    throw new Error("Renderer capture requires the exact active chat with no full-page overlay")
  }
  if (typeof navigation.activeSubChatId !== "string") {
    throw new Error("Renderer capture requires an active conversation")
  }
  if (expectedSubChatId && navigation.activeSubChatId !== expectedSubChatId) {
    throw new Error("Renderer capture navigation changed during capture")
  }
  const activeConversation = getDatabase()
    .select({ id: subChats.id })
    .from(subChats)
    .where(and(eq(subChats.id, navigation.activeSubChatId), eq(subChats.chatId, chatId)))
    .get()
  if (!activeConversation) throw new Error("Renderer capture conversation does not match chat")
  return navigation.activeSubChatId
}

export async function captureTestRenderer(input: { chatId: string }) {
  const target = getDatabase()
    .select({ projectName: projects.name, projectPath: projects.path })
    .from(chats)
    .innerJoin(projects, eq(chats.projectId, projects.id))
    .where(and(eq(chats.id, input.chatId), isNull(chats.archivedAt)))
    .get()
  if (!target) throw new Error("Active test chat not found")

  const projectPath = realpathSync(target.projectPath)
  const checkoutPath = realpathSync(process.cwd())
  const tempRoot = realpathSync(tmpdir())
  const isCheckoutProject = projectPath === checkoutPath
  const isCarryoverFixture =
    target.projectName === "Carryover run fixture" &&
    join(projectPath, "..") === tempRoot &&
    basename(projectPath).startsWith("flapstack-carryover-run-")
  if (!isCheckoutProject && !isCarryoverFixture) {
    throw new Error("Renderer capture is limited to this checkout or an isolated carryover fixture")
  }

  const window = getDevRendererWindow()
  const activeSubChatId = await requireExactRendererNavigation(window, input.chatId)

  const image = await window.webContents.capturePage()
  if (image.isEmpty()) throw new Error("Renderer capture was empty")
  await requireExactRendererNavigation(window, input.chatId, activeSubChatId)
  const captureId = randomUUID()
  const directory = mkdtempSync(join(tmpdir(), RENDERER_CAPTURE_PREFIX))
  const outputPath = join(directory, "capture.png")
  writeFileSync(outputPath, image.toPNG(), { mode: 0o600 })
  const expiry = setTimeout(() => releaseRendererCapture(captureId), RENDERER_CAPTURE_TTL_MS)
  expiry.unref()
  rendererCaptures.set(captureId, { directory, path: outputPath, expiry })
  const size = image.getSize()
  return { captureId, path: outputPath, width: size.width, height: size.height }
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
  closePromise?: Promise<void>
}

const productMcpTestSessions = new Map<string, ProductMcpTestSession>()
const productMcpTestClosingSessions = new Set<Promise<void>>()

function getDevRendererWindow() {
  const windows = BrowserWindow?.getAllWindows?.() ?? []
  const window = BrowserWindow?.getFocusedWindow?.() ?? windows.find((item) => !item.isDestroyed())
  if (!window || window.isDestroyed()) throw new Error("No live renderer is available")
  return window
}

const MAX_DEV_RENDERER_CONTROL_TIMEOUT_MS = 180_000

export function resolveDevRendererControlTimeoutMs(
  timeoutMs: number | undefined,
  platform = process.platform,
): number {
  if (timeoutMs === undefined) return platform === "win32" ? 15_000 : 5_000
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_DEV_RENDERER_CONTROL_TIMEOUT_MS
  ) {
    throw new Error(
      `Live renderer control timeout must be between 1 and ${MAX_DEV_RENDERER_CONTROL_TIMEOUT_MS} milliseconds.`,
    )
  }
  return timeoutMs
}

export function stage6PerformanceRendererSelectionTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  return env.FLAPSTACK_STAGE6_PERFORMANCE_PROFILE === "1"
    ? MAX_DEV_RENDERER_CONTROL_TIMEOUT_MS
    : undefined
}

function requestDevRendererControlForWindow(
  input: DevRendererControlCommand,
  window: Electron.BrowserWindow,
  options: { timeoutMs?: number } = {},
) {
  const requestId = randomUUID()
  const timeoutMs = resolveDevRendererControlTimeoutMs(options.timeoutMs)
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener(DEV_RENDERER_CONTROL_RESPONSE_CHANNEL, handleResponse)
      reject(new Error("Live renderer control timed out"))
    }, timeoutMs)
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

export async function requestDevRendererControl(
  input: DevRendererControlCommand,
  options: { timeoutMs?: number } = {},
) {
  return requestDevRendererControlForWindow(input, getDevRendererWindow(), options)
}

let electronExecutableSha256: Promise<string> | undefined

export async function controlElectronPerformanceMeasurement(input: {
  budgetId: string
  action: Stage6ElectronMeasurementAction
  operation: Stage6ElectronMeasurementOperation
}) {
  const contract = getStage6ElectronMeasurementContract(input.budgetId)
  const buildType = app.isPackaged ? "package" : "dev"
  if (contract.buildType !== buildType) {
    throw new Error(
      `Electron performance budget ${input.budgetId} does not match running ${buildType} build.`,
    )
  }
  if (input.action !== contract.action) {
    throw new Error("Stage 6 Electron performance action does not match its budget.")
  }
  const window = getDevRendererWindow()
  electronExecutableSha256 ??= sha256File(process.execPath)
  const [state, executableSha256, applicationSha256] = await Promise.all([
    requestDevRendererControlForWindow({ command: "performance.measure", ...input }, window, {
      timeoutMs: stage6PerformanceRendererSelectionTimeoutMs(),
    }),
    electronExecutableSha256,
    runningApplicationManifestSha256(),
  ])
  const electronVersion = process.versions.electron
  if (!electronVersion) throw new Error("Electron version is unavailable in the main process.")
  return {
    state,
    buildIdentity: createElectronPerformanceBuildIdentity({
      appVersion: app.getVersion(),
      electronVersion,
      buildType,
      executableSha256,
      applicationSha256,
      rendererProcessId: window.webContents.getOSProcessId(),
    }),
  }
}

async function runningApplicationManifestSha256(): Promise<string> {
  if (app.isPackaged) {
    const candidates = [join(process.resourcesPath, "app.asar"), app.getAppPath()]
    const artifact = candidates.find((entry) => {
      try {
        return existsSync(entry) && statSync(entry).isFile()
      } catch {
        return false
      }
    })
    if (!artifact) {
      throw new Error("Running Electron application artifact is unavailable for identity capture.")
    }
    return sha256File(artifact)
  }

  const root = app.getAppPath()
  const rendererManifestRoot = process.env.ELECTRON_RENDERER_URL ? "src/renderer" : "out/renderer"
  const manifestRoots = [
    "out/main",
    "out/preload",
    rendererManifestRoot,
    "src/shared",
    "electron.vite.config.ts",
    "package-lock.json",
  ]
  const files = manifestRoots
    .flatMap((relativePath) => collectApplicationManifestFiles(root, relativePath))
    .sort((left, right) => left.localeCompare(right))
  if (files.length === 0 || files.length > 50_000) {
    throw new Error("Running Electron development manifest has an invalid file count.")
  }
  let byteLength = 0
  const hash = createHash("sha256")
  hash.update("stage6-electron-dev-build-v1\0")
  for (const relativePath of files) {
    const absolutePath = join(root, ...relativePath.split("/"))
    const bytes = readFileSync(absolutePath)
    byteLength += bytes.byteLength
    if (byteLength > 256 * 1024 * 1024) {
      throw new Error("Running Electron development manifest exceeds 256 MiB.")
    }
    hash.update(relativePath)
    hash.update("\0")
    hash.update(String(bytes.byteLength))
    hash.update("\0")
    hash.update(createHash("sha256").update(bytes).digest("hex"))
    hash.update("\0")
  }
  return hash.digest("hex")
}

function collectApplicationManifestFiles(root: string, relativePath: string): string[] {
  const normalized = relativePath.replaceAll("\\", "/")
  const absolutePath = join(root, ...normalized.split("/"))
  const stat = statSync(absolutePath)
  if (stat.isFile()) return [normalized]
  if (!stat.isDirectory()) return []
  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) {
      throw new Error("Running Electron development manifest cannot contain symbolic links.")
    }
    const child = `${normalized}/${entry.name}`
    return entry.isDirectory()
      ? collectApplicationManifestFiles(root, child)
      : entry.isFile()
        ? [child]
        : []
  })
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(filePath)
    stream.on("error", reject)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("end", () => resolve(hash.digest("hex")))
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
  options: { deferScheduling?: boolean; stage4FixtureHandle?: string } = {},
) {
  if (options.stage4FixtureHandle) {
    const fixture = stage4FixtureIdentity(options.stage4FixtureHandle)
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Owned orchestration request must be an object")
    }
    const request = input as {
      projectId?: unknown
      initiatingChatId?: unknown
      task?: unknown
    }
    if (request.projectId !== fixture.projectId || request.initiatingChatId !== fixture.chatId) {
      throw new Error("Owned orchestration must use its fixture project and initiating chat")
    }
    if (
      !request.task ||
      typeof request.task !== "object" ||
      Array.isArray(request.task) ||
      (request.task as { mode?: unknown }).mode !== "create" ||
      "taskId" in request.task
    ) {
      throw new Error("Owned orchestration must create a new fixture task")
    }
  }
  const service = createAgentOrchestrationService(getDatabasePath())
  // deferScheduling persists paused in the same transaction as task creation.
  // The independent scheduler can never observe this fixture as launchable.
  const created = service.create(input, undefined, options)
  notifyTestOrchestrationChanged(created.orchestration.taskId)
  if (!options.stage4FixtureHandle) return created
  const operationWorkspaceResult = ensureOperationWorkspace(
    getDatabasePath(),
    created.orchestration.taskId,
  )
  const operationWorkspace = {
    id: operationWorkspaceResult.workspaceId,
    state: "live" as const,
    created: operationWorkspaceResult.created,
  }
  let workflowRows = getDatabase()
    .select({
      workflowRunId: orchestrationWorkflowRuns.id,
      definitionJson: orchestrationWorkflowRuns.definitionJson,
    })
    .from(orchestrationWorkflowRuns)
    .where(eq(orchestrationWorkflowRuns.taskId, created.orchestration.taskId))
    .all()
  if (workflowRows.length === 0) {
    const sourceAgent = created.agents[0]?.definition
    if (!sourceAgent) throw new Error("Owned orchestration did not create a fixture agent")
    const workflowRunId = randomUUID()
    const stepId = `stage4-profile-step-${randomUUID()}`
    const definitionId = sourceAgent.definitionId ?? `stage4-profile-agent-${randomUUID()}`
    const definition = orchestrationTemplateDefinitionSchema.parse({
      schemaVersion: 1,
      engine: "workflow",
      agents: [
        {
          ...sourceAgent,
          definitionId,
        },
      ],
      policy: {
        maxParallelAgents: created.orchestration.maxParallelAgents,
        maxDepth: created.orchestration.maxDepth,
        maxTotalAgents: Math.max(1, created.agents.length),
        maxTotalTokens: null,
        maxCostUsdMicros: null,
        allowSpawn: false,
      },
      workflow: {
        schemaVersion: 1,
        steps: [
          {
            id: stepId,
            kind: "agent",
            agentDefinitionId: definitionId,
            dependsOn: [],
            childStepIds: [],
            condition: null,
            thenStepIds: [],
            elseStepIds: [],
            bodyStepIds: [],
            maxIterations: 1,
            timeoutMs: null,
            maxRetries: 0,
            outputSchema: null,
          },
        ],
      },
      presentationStyle: null,
    })
    const now = Math.floor(Date.now() / 1_000)
    getDatabase()
      .insert(orchestrationWorkflowRuns)
      .values({
        id: workflowRunId,
        taskId: created.orchestration.taskId,
        status: "paused",
        definitionJson: JSON.stringify(definition),
        approvalAuditId: null,
        stopIntent: false,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    workflowRows = [{ workflowRunId, definitionJson: JSON.stringify(definition) }]
  }
  const stage4WorkflowHandles = registerStage4FixtureWorkflows(
    options.stage4FixtureHandle,
    workflowRows.map((row) => {
      const parsed = JSON.parse(row.definitionJson) as {
        workflow?: { steps?: Array<{ id?: unknown }> }
      }
      return {
        workflowRunId: row.workflowRunId,
        taskId: created.orchestration.taskId,
        stepIds: (parsed.workflow?.steps ?? [])
          .map((step) => step.id)
          .filter((stepId): stepId is string => typeof stepId === "string"),
      }
    }),
  )
  return { ...created, stage4WorkflowHandles, operationWorkspace }
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
  chatName?: string
  harness?: "codex" | "claude-code"
}) {
  if ("projectPath" in input || "projectId" in input || "projectName" in input) {
    throw new Error("Stage 4 fixture project identity is derived from ensure_test_project")
  }
  const projectPath = resolveCanonicalProjectPath(resolve(process.cwd()))
  const db = getDatabase()
  const existingProject = db.select().from(projects).where(eq(projects.path, projectPath)).get()
  if (!existingProject) {
    throw new Error("Run ensure_test_project before creating a Stage 4 fixture")
  }
  if (existingProject?.archivedAt) throw new Error("Orchestration fixture project is archived")
  assertStage4FixtureProject({ projectId: existingProject.id, projectPath })
  const harness = input.harness ?? "codex"
  const permissionMode = "read-only"
  const created = db.transaction((tx) => {
    const project = existingProject
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
        mode: "write",
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
  const stage4FixtureHandle = registerStage4Fixture({
    projectId: created.project.id,
    chatId: created.chat.id,
    subChatId: created.subChat.id,
    harness,
  })
  return {
    projectId: created.project.id,
    projectCreated: false,
    chatId: created.chat.id,
    subChatId: created.subChat.id,
    projectPath,
    harness,
    permissionMode,
    stage4FixtureHandle,
  }
}

export function getTestOrchestration(input: { taskId: string }) {
  const service = createAgentOrchestrationService(getDatabasePath())
  const base = service.getOverview(input.taskId)
  const database = getDatabase()
  const operationWorkspace = database
    .select({ id: savedWorkspaces.id })
    .from(savedWorkspaces)
    .where(
      and(
        eq(savedWorkspaces.taskId, input.taskId),
        eq(savedWorkspaces.ownerKind, "orchestration"),
        isNull(savedWorkspaces.archivedAt),
      ),
    )
    .get()
  const initiatingChat = base
    ? database
        .select({ id: chats.id, archivedAt: chats.archivedAt })
        .from(chats)
        .where(eq(chats.id, base.orchestration.initiatingChatId))
        .get()
    : null
  return {
    overview: base
      ? {
          ...base,
          operationWorkspace: {
            id: operationWorkspace?.id ?? null,
            state: operationWorkspace ? ("live" as const) : ("missing" as const),
          },
          initiatingChat: {
            id: base.orchestration.initiatingChatId,
            state: !initiatingChat
              ? ("missing" as const)
              : initiatingChat.archivedAt
                ? ("archived" as const)
                : ("live" as const),
          },
        }
      : null,
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
  const isDev = !app.isPackaged
  const isPreview = app.isPackaged && isPreviewExecutable()

  return {
    app: {
      version: app.getVersion(),
      name: app.getName(),
      isPackaged: app.isPackaged,
      channel: isDev ? "development" : isPreview ? "preview" : "production",
      protocol: resolveFlapstackProtocol(isDev, isPreview),
      userDataPath,
      databasePath: dbPath,
      databaseExists: existsSync(dbPath),
      processId: process.pid,
      executablePath: process.execPath,
      appPath: app.getAppPath(),
      defaultApp: Boolean(process.defaultApp),
      windowCount: BrowserWindow.getAllWindows().length,
      lastProtocolEvent: getLastProtocolReceipt(),
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
        mode: "write",
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
        ...constructRuntimeSnapshot(db, {
          chatId,
          harness,
          model,
          permission: runtimePermissionSnapshot(permissionMode, null),
        }),
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
  if (session.closePromise) return session.closePromise
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
  session.closePromise = session.client
    .close()
    .catch(() => session.transport.close().catch(() => undefined))
  productMcpTestClosingSessions.add(session.closePromise)
  void session.closePromise.finally(() =>
    productMcpTestClosingSessions.delete(session.closePromise!),
  )
  return session.closePromise
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
      mcpExposureEnabled: Boolean(chat.mcpExposureEnabled),
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
  await Promise.all([...productMcpTestClosingSessions])
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
  const requestedPath = resolve(repoPath)
  if (!existsSync(requestedPath) || !statSync(requestedPath).isDirectory()) {
    throw new Error("Active development checkout is not a directory")
  }
  const projectPath = resolveCanonicalProjectPath(requestedPath)
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
    registerStage4FixtureProject({ projectId: project!.id, projectPath })
    registerStage4TestProject({ projectId: project!.id, projectPath })
    notifyTestControlView({ action: "project-created", projectId: project!.id })
    return { project: project!, created: false, restored: Boolean(existing.archivedAt) }
  }

  bindFilesystemRootIdentity(projectPath)
  const project = db
    .insert(projects)
    .values({ name: input?.name?.trim() || basename(projectPath), path: projectPath })
    .returning()
    .get()
  registerStage4FixtureProject({ projectId: project!.id, projectPath })
  registerStage4TestProject({ projectId: project!.id, projectPath })
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
  const activityAssistant = assistant
    ? null
    : buildActivityAssistant(
        db
          .select({
            eventId: agentActivityEvents.eventId,
            sequence: agentActivityEvents.sequence,
            kind: agentActivityEvents.kind,
            phase: agentActivityEvents.phase,
            providerMessageId: agentActivityEvents.providerMessageId,
            payloadJson: agentActivityEvents.payloadJson,
          })
          .from(agentActivityEvents)
          .where(eq(agentActivityEvents.runId, run.id))
          .orderBy(asc(agentActivityEvents.sequence))
          .all(),
      )
  return {
    found: true,
    run: compactRun(run),
    assistant: assistant
      ? {
          id: assistant.id ?? null,
          text: getMessageText(assistant).slice(0, 8_000),
          metadata: safeMessageMetadata(assistant.metadata),
        }
      : activityAssistant,
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
        mode: "write",
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

export function buildStage6PerformanceMessages(messageCount: 1 | 200) {
  return Array.from({ length: messageCount }, (_, index) => ({
    id: `stage6-performance-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    parts: [
      {
        type: "text",
        text: `${
          index % 2 === 0
            ? `Stage 6 user request ${index}: Please review the current project state, explain the important behavior in plain language, and identify the next useful action. Keep the response grounded in the visible evidence, preserve relevant context, and call out any limitation that changes the decision.`
            : `Stage 6 assistant response ${index}: I reviewed the available project evidence and summarized the important behavior, current result, and next useful action. The response keeps the relevant context visible, distinguishes verified facts from limitations, and avoids dropping details that would change the user's decision.`
        }${
          index === messageCount - 1
            ? ` This final paragraph contains the deterministic search anchor stage6-target-${index}.`
            : ""
        }`,
      },
    ],
  }))
}

export function provisionStage6PerformanceFixture(input: {
  messageCount: 1 | 200
  paneCount: 1 | 4
}) {
  if (process.env.FLAPSTACK_STAGE6_PERFORMANCE_PROFILE !== "1") {
    throw new Error("Stage 6 performance fixtures require an isolated performance profile.")
  }
  const project = ensureTestProject({ name: "Stage 6 Performance Fixture" })
  const messages = buildStage6PerformanceMessages(input.messageCount)
  const serializedMessages = JSON.stringify(messages)
  const createdFixtures = Array.from({ length: input.paneCount }, (_, paneIndex) => {
    const created = createTestChat({
      projectId: project.project.id,
      name:
        input.messageCount === 200
          ? "Stage 6 100-Exchange Transcript"
          : `Stage 6 Grid Transcript ${paneIndex + 1}`,
      provider: "cursor-agent",
      model: "stage6-fixture",
    })
    getDatabase()
      .update(subChats)
      .set({ messages: serializedMessages, updatedAt: new Date() })
      .where(eq(subChats.id, created.subChatId))
      .run()
    return created
  })
  const created = createdFixtures[0]!
  notifyTestControlView({
    action: "chat-opened",
    chatId: created.chatId,
    subChatId: created.subChatId,
  })
  return {
    ...created,
    messageCount: messages.length,
    paneCount: input.paneCount,
    chatIds: createdFixtures.map((entry) => entry.chatId),
    subChatIds: createdFixtures.map((entry) => entry.subChatId),
    targetMessageId: `stage6-performance-${input.messageCount - 1}`,
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

export function archiveTestTask(input: { taskId: string }) {
  const db = getDatabase()
  const task = db.select().from(tasks).where(eq(tasks.id, input.taskId)).get()
  if (!task) throw new Error("Task not found")

  const taskChats = db
    .select({ id: chats.id, archivedAt: chats.archivedAt })
    .from(chats)
    .where(eq(chats.taskId, input.taskId))
    .all()
  const activeChatIds = taskChats.filter((chat) => !chat.archivedAt).map((chat) => chat.id)
  if (task.archivedAt && activeChatIds.length === 0) {
    return {
      archived: true,
      alreadyArchived: true,
      taskId: task.id,
      archivedChatIds: [],
      archivedAt: task.archivedAt.toISOString(),
    }
  }
  if (activeChatIds.length > 0) {
    const activeRun = db
      .select({ id: agentRuns.id, chatId: agentRuns.chatId })
      .from(agentRuns)
      .where(and(eq(agentRuns.status, "running"), isNull(agentRuns.completedAt)))
      .all()
      .find((run) => activeChatIds.includes(run.chatId))
    if (activeRun) throw new Error(`Task chat has an active run: ${activeRun.id}`)
  }

  const archivedAt = new Date()
  db.transaction((tx) => {
    tx.update(tasks).set({ archivedAt, updatedAt: archivedAt }).where(eq(tasks.id, task.id)).run()
    tx.update(chats)
      .set({ archivedAt, updatedAt: archivedAt })
      .where(and(eq(chats.taskId, task.id), isNull(chats.archivedAt)))
      .run()
  })

  for (const chatId of activeChatIds) {
    notifyTestControlView({ action: "chat-archived", chatId })
  }
  return {
    archived: true,
    alreadyArchived: Boolean(task.archivedAt) && activeChatIds.length === 0,
    taskId: task.id,
    archivedChatIds: activeChatIds,
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
  const { getMainRuntimeLaunchService } = await import("../main-run-launcher")
  void getMainRuntimeLaunchService(getDatabasePath())
    .launch(run)
    .catch((error: unknown) =>
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
    await sleep(pollMs)
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

    await sleep(pollMs)
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
