import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { existsSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { createAppRouter } from "./trpc/routers"
import {
  loadAgentRunReconciliationState,
  loadRunningAgentRun,
  type AgentRunReconciliationState,
  type AgentRunLauncher,
  type QueuedAgentRun,
} from "./run-launch-service"
import {
  MAX_AGENT_ACTIVITY_METADATA_DEPTH,
  MAX_AGENT_ACTIVITY_METADATA_ENTRIES,
  MAX_AGENT_ACTIVITY_METADATA_STRING,
  MAX_AGENT_ACTIVITY_PAYLOAD_BYTES,
  type AgentActivityAppend,
} from "../../shared/agent-activity"
import type {
  HarnessAdapterFactory,
  ResolvedAgentRuntime,
  ResolvedRuntimeLaunch,
  RuntimeAdapterProbe,
  RuntimeAdapterContext,
  RuntimeAdapterSession,
  RuntimeAdapterTurn,
} from "../../shared/agent-runtime"
import { usesFlapstackRuntimeEnhancements } from "../../shared/agent-runtime"
import { isAgentHarness } from "../../shared/harness-types"
import { LEGACY_RUNTIME_CAPABILITIES } from "./agent-runtime/snapshot"
import {
  RuntimeLaunchCancelledError,
  RuntimeLaunchCoordinator,
} from "./agent-runtime/launch-coordinator"
import { AgentRuntimeRegistry, createAgentRuntimeRegistry } from "./agent-runtime/registry"
import { createAgentActivityStore } from "./agent-runtime/activity-store"
import { createCodexRuntimeAdapterFactory } from "./agent-runtime/codex"
import {
  CLAUDE_AGENT_SDK_VERSION,
  CLAUDE_CODE_VERSION,
  createClaudeCodeRuntimeAdapter,
  type ClaudeRuntimeDependencies,
  type ClaudeRuntimeQueryInput,
} from "./agent-runtime/claude-code"
import { RUNTIME_RELEASE_POLICY } from "./agent-runtime/release-policy"
import { sanitizeRuntimeText } from "./agent-runtime/sanitizer"
import { getDatabasePath } from "./db"
import * as schema from "./db/schema"
import { nowEpochSeconds } from "./db/timestamps"
import {
  createFlapstackNativeAdapterFactory,
  type FlapstackNativeProviderDelegation,
} from "./agent-runtime/flapstack-native"
import {
  applyCodexExtensionPolicyConfig,
  buildExtensionRunContext,
  buildManagedClaudeHookOptions,
  buildManagedCodexHookConfig,
  FileHookStateStore,
  filterClaudeExtensionMcpServers,
  getClaudeExtensionSdkOptions,
  NodeManagedHookRuntimeExecutor,
  resolveEnabledManagedHooks,
  type ExtensionLaunchPolicy,
  type HookRecord,
  type HookStateStore,
  type ManagedHookRuntimeExecutor,
} from "./extension-management"
import { assertRegisteredFilesystemRoot } from "./git/security/path-validation"
import {
  getMergedGlobalMcpServers,
  getMergedLocalProjectMcpServers,
  readClaudeConfig,
  readClaudeDirConfig,
  readProjectMcpJson,
  type McpServerConfig,
} from "./claude-config"
import { discoverPluginMcpServers } from "./plugins"
import { getApprovedPluginMcpServers, getEnabledPlugins } from "./trpc/routers/claude-settings"
import {
  DEFAULT_OLLAMA_BASE_URL,
  findUnavailableLocalModelTier,
  resolveLocalModelSelection,
  resolveLocalModelToolTiers,
} from "../../shared/local-model-contract"
import { parseCustomPermissionCapabilities } from "../../shared/permission-capabilities"
import type { AgentInputRequest } from "../../shared/agent-input"
import { agentInputLifecycle } from "./agent-input/service"
import {
  formatClaudeInputAnswers,
  normalizeClaudeInputQuestions,
} from "./agent-input/claude-adapter"
import { resolveClaudeRuntimeToolPermission } from "./permissions"
import {
  buildProjectVaultRunContext,
  emptyProjectVaultRunContext,
  persistProjectVaultContextManifest,
  ProjectVaultContextRejectedError,
} from "./project-vaults/run-context"
import { isBetaFeatureEnabled } from "./beta-features/settings"
import { applyChatModeInstruction, normalizeChatMode } from "../../shared/chat-mode"
import { buildHarnessContextBundle, buildStartupInstructions } from "./harness/launch-context"
import {
  registerRuntimeLaunchAuthority,
  resetRuntimeLaunchAuthoritiesForTests,
} from "./agent-runtime/launch-access"

export type MainRunLauncherOptions = {
  databasePath?: string
  registry?: AgentRuntimeRegistry<unknown>
  codexFactory?: HarnessAdapterFactory<unknown>
  claudeCodeFactory?: HarnessAdapterFactory<unknown>
  enableCodex?: boolean
  enableClaudeCode?: boolean
  permissionHandler?: (runId: string, request: unknown) => Promise<unknown>
  inputHandler?: (runId: string, request: unknown) => Promise<unknown>
  hookStore?: HookStateStore
  hookRuntimeExecutor?: ManagedHookRuntimeExecutor
}

export type RuntimeStructuredOutput = Readonly<{
  value: unknown
  activityReference: Readonly<{ runId: string; eventId: string; sequence: number }>
}>

const services = new Map<string, MainRuntimeLaunchService>()

/** One process-wide authority for Runtime registry, dispatch, recovery, and interaction. */
export class MainRuntimeLaunchService {
  readonly registry: AgentRuntimeRegistry<unknown>
  readonly coordinator: RuntimeLaunchCoordinator<unknown>
  private readonly caller = createAppRouter(() => null).createCaller({ getWindow: () => null })
  private readonly runs = new Map<string, QueuedAgentRun>()
  private readonly streams = new Map<string, unknown>()
  private readonly states = new Map<string, "running" | "completed" | "uncertain">()
  private readonly prelaunchCancellations = new Set<string>()
  private readonly persistedCancellations = new Map<string, Promise<boolean>>()
  private readonly persistedOperations = new Map<string, Promise<void>>()
  private readonly databasePath: string
  private readonly hookStore: HookStateStore
  private readonly hookRuntimeExecutor: ManagedHookRuntimeExecutor
  private permissionHandler?: MainRunLauncherOptions["permissionHandler"]
  private inputHandler?: MainRunLauncherOptions["inputHandler"]

  constructor(options: MainRunLauncherOptions) {
    this.databasePath = options.databasePath ?? getDatabasePath()
    this.hookStore = options.hookStore ?? new FileHookStateStore()
    this.hookRuntimeExecutor = options.hookRuntimeExecutor ?? new NodeManagedHookRuntimeExecutor()
    this.permissionHandler =
      options.permissionHandler ??
      ((runId, request) => this.requestDefaultPermission(runId, request))
    this.inputHandler = options.inputHandler
    const nativeFactory = createFlapstackNativeAdapterFactory({
      resolveDelegation: (harness) =>
        createLegacyDelegation(harness, this.caller, this.runs, this.streams, this.states),
      appendActivity: (runId, events) => this.appendActivity(runId, events),
      onProjectionError: (context, diagnostic) =>
        this.appendDiagnostic(context.runId, diagnostic.code, diagnostic.message),
    }) as HarnessAdapterFactory<unknown>
    const codexFactory =
      options.codexFactory ??
      (createCodexRuntimeAdapterFactory({
        appendActivity: (runId, events) => this.appendActivity(runId, events),
        resolveTurnInput: (context, prompt) => {
          const images = this.runs.get(context.runId)?.images ?? []
          return [
            { type: "text", text: prompt, text_elements: [] },
            ...images.map((image) => ({
              type: "image",
              url: `data:${image.mediaType};base64,${image.base64Data}`,
            })),
          ]
        },
        resolveThreadParams: async (context, operation) => {
          const authority = await this.resolveExtensionAuthority(context, "codex")
          const enhanced = usesFlapstackRuntimeEnhancements(context.launch.requestedPreference)
          const config = enhanced
            ? applyCodexExtensionPolicyConfig(
                buildManagedCodexHookConfig(authority.hooks),
                authority.policy,
              )
            : {}
          return {
            cwd: authority.cwd,
            ...(enhanced && operation === "start" && context.instructions
              ? { developerInstructions: context.instructions }
              : {}),
            ...codexPermissionOptions(context.launch.permission.mode),
            ...(Object.keys(config).length > 0 ? { config } : {}),
          }
        },
        resolvePersistedSession: (context) => this.loadPersistedSession(context.runId),
        resolvePersistedTurn: (context) => this.loadPersistedTurn(context.runId),
        requestPermission: (context, request) =>
          this.requestPermissionFromProvider(context.runId, request),
        requestInput: (context, request) => this.requestInputFromProvider(context.runId, request),
        onDiagnostic: (context, message) =>
          context ? this.appendDiagnostic(context.runId, "codex-runtime", message) : undefined,
      }) as HarnessAdapterFactory<unknown>)
    const claudeCodeFactory =
      options.claudeCodeFactory ?? (() => createClaudeCodeRuntimeAdapter(this.claudeDependencies()))
    this.registry =
      options.registry ??
      createAgentRuntimeRegistry([
        {
          runtime: "codex",
          factory: codexFactory,
          enabled: options.enableCodex ?? RUNTIME_RELEASE_POLICY.codex.enabledForNewLaunches,
          disabledReason: RUNTIME_RELEASE_POLICY.codex.reason,
        },
        {
          runtime: "claude-code",
          factory: claudeCodeFactory,
          enabled:
            options.enableClaudeCode ?? RUNTIME_RELEASE_POLICY["claude-code"].enabledForNewLaunches,
          disabledReason: RUNTIME_RELEASE_POLICY["claude-code"].reason,
        },
        { runtime: "flapstack-native", factory: nativeFactory },
      ])
    this.coordinator = new RuntimeLaunchCoordinator(this.registry, {
      persistIntent: (request) => this.persistIntent(request.runId),
      persistSession: (request, session) => this.persistSession(request.runId, session),
      persistTurn: (request, session, turn) => this.persistTurn(request.runId, session, turn),
      onLifecycle: (request, lifecycle, detail) =>
        this.persistLifecycle(request.runId, lifecycle, detail),
      onActivityReference: (request) => this.referenceActivity(request.runId),
    })
  }

  readonly launch: AgentRunLauncher = async (run) => {
    if (this.runs.has(run.runId) || this.coordinator.runState(run.runId)) {
      throw new Error(`Runtime run ${run.runId} is already active.`)
    }
    this.runs.set(run.runId, run)
    try {
      const instructions = await this.resolveDirectRuntimeInstructions(run)
      if (this.prelaunchCancellations.has(run.runId)) {
        throw new RuntimeLaunchCancelledError(run.runId)
      }
      const resolvedLaunch = run.runtimeLaunch ?? legacyLaunch(run)
      await this.coordinator.launch({
        runId: run.runId,
        chatId: run.chatId,
        subChatId: run.subChatId,
        launch: resolvedLaunch,
        prompt: resolveRuntimeTurnPrompt(run, resolvedLaunch),
        instructions,
        persistedSession: await this.loadPersistedSession(run.runId),
      })
    } catch (error) {
      if (!(error instanceof RuntimeLaunchCancelledError)) {
        const message = sanitizeRuntimeText(
          error instanceof Error ? error.message : String(error),
          { maxLength: 2_048, mode: "diagnostic" },
        )
        await this.persistLifecycle(run.runId, "failed", message)
        throw new Error(message)
      }
      throw error
    } finally {
      this.prelaunchCancellations.delete(run.runId)
      this.runs.delete(run.runId)
      this.streams.delete(run.runId)
    }
  }

  async cancel(runId: string, reason: string): Promise<boolean> {
    if (this.coordinator.runState(runId)) {
      return await this.coordinator.cancel(runId, reason)
    }
    if (this.runs.has(runId) && loadRunningAgentRun(this.databasePath, runId)) {
      this.prelaunchCancellations.add(runId)
      await this.persistLifecycle(runId, "cancelled", reason)
      return true
    }
    const inFlight = this.persistedCancellations.get(runId)
    if (inFlight) return await inFlight
    const cancellation = this.serializePersistedOperation(runId, () =>
      this.cancelPersisted(runId, reason),
    )
    this.persistedCancellations.set(runId, cancellation)
    try {
      return await cancellation
    } finally {
      this.persistedCancellations.delete(runId)
    }
  }

  async probe(runtime: ResolvedAgentRuntime, harness: string): Promise<RuntimeAdapterProbe> {
    return await this.registry.probe(runtime, harness)
  }

  async pause(runId: string): Promise<boolean> {
    return await this.coordinator.pause(runId)
  }

  async resume(runId: string): Promise<boolean> {
    return await this.coordinator.resume(runId)
  }

  async readStructuredOutput(runId: string): Promise<RuntimeStructuredOutput | null> {
    if (!runId.trim()) throw new Error("Runtime structured output requires a run ID.")
    const db = this.open()
    try {
      return db.transaction(() => readStructuredOutput(db, runId)).deferred()
    } finally {
      db.close()
    }
  }

  async reconcileRun(runId: string): Promise<AgentRunReconciliationState> {
    const active = this.activeReconciliationState(runId)
    if (active) return active
    const durableState = loadAgentRunReconciliationState(this.databasePath, runId)
    if (durableState !== "running") return durableState
    const run = loadRunningAgentRun(this.databasePath, runId)
    if (!run) return "uncertain"
    return await this.reconcile(run)
  }

  async reconcile(run: QueuedAgentRun): Promise<AgentRunReconciliationState> {
    const active = this.activeReconciliationState(run.runId)
    if (active) return active
    return await this.serializePersistedOperation(run.runId, async () => {
      const currentActive = this.activeReconciliationState(run.runId)
      if (currentActive) return currentActive
      const durableState = loadAgentRunReconciliationState(this.databasePath, run.runId)
      if (durableState !== "running") return durableState
      const durableRun = loadRunningAgentRun(this.databasePath, run.runId)
      if (!durableRun) return "uncertain"
      const persistedSession = await this.loadPersistedSession(run.runId, false)
      if (!persistedSession?.providerSessionId && !persistedSession?.providerThreadId) {
        await this.persistLifecycle(run.runId, "uncertain", "Provider identity is missing.")
        return loadAgentRunReconciliationState(this.databasePath, run.runId)
      }
      const state = await this.coordinator.reconcile({
        runId: durableRun.runId,
        chatId: durableRun.chatId,
        subChatId: durableRun.subChatId,
        launch: durableRun.runtimeLaunch ?? legacyLaunch(durableRun),
        prompt: durableRun.prompt,
        persistedSession,
      })
      const racedActive = this.activeReconciliationState(run.runId)
      if (racedActive) return racedActive
      const stateBeforeProjection = loadAgentRunReconciliationState(this.databasePath, run.runId)
      if (stateBeforeProjection !== "running") return stateBeforeProjection
      await this.persistLifecycle(run.runId, state === "completed" ? "completed" : state)
      return loadAgentRunReconciliationState(this.databasePath, run.runId)
    })
  }

  async requestPermission(runId: string, request: unknown): Promise<unknown> {
    return await this.coordinator.requestPermission(runId, request)
  }

  async requestInput(runId: string, request: unknown): Promise<unknown> {
    return await this.coordinator.requestInput(runId, request)
  }

  setInteractionHandlers(handlers: {
    permission?: MainRunLauncherOptions["permissionHandler"]
    input?: MainRunLauncherOptions["inputHandler"]
  }): void {
    this.permissionHandler = handlers.permission
    this.inputHandler = handlers.input
  }

  diagnostics() {
    return {
      databasePath: this.databasePath,
      activeRunIds: this.coordinator.activeRunIds(),
      registry: this.registry.diagnostics(),
    }
  }

  private async requestPermissionFromProvider(runId: string, request: unknown): Promise<unknown> {
    if (!this.permissionHandler) throw new Error("Runtime permission bridge is unavailable.")
    return await this.permissionHandler(runId, request)
  }

  private async requestDefaultPermission(runId: string, request: unknown): Promise<unknown> {
    const run = this.runs.get(runId) ?? loadRunningAgentRun(this.databasePath, runId)
    if (!run) throw new Error(`Runtime permission request references unknown run ${runId}.`)
    const record = isPlainRecord(request) ? request : {}
    const provider = typeof record.provider === "string" ? record.provider : null
    const method = typeof record.method === "string" ? record.method : null
    const toolName =
      typeof record.toolName === "string"
        ? record.toolName
        : method === "item/fileChange/requestApproval"
          ? "File change"
          : method === "item/commandExecution/requestApproval"
            ? "Command execution"
            : method === "item/permissions/requestApproval"
              ? "additional Codex permissions"
              : "Runtime tool"
    const requestId =
      typeof record.requestId === "string" && record.requestId.trim()
        ? record.requestId
        : typeof record.id === "string" || typeof record.id === "number"
          ? String(record.id)
          : `${runId}:permission:${randomUUID()}`
    const createdAt = Date.now()
    const inputRequest: AgentInputRequest = {
      requestId,
      chatId: run.subChatId,
      runId,
      origin: {
        harness: run.harness,
        provider: provider ?? run.runtimeLaunch?.resolvedRuntime ?? run.harness,
        ...(run.model ? { model: run.model } : {}),
        toolName,
      },
      capability: { mode: "native", sameRun: true },
      questions: [
        {
          id: "permission",
          header: "Permission",
          question: permissionRequestQuestion(toolName, record),
          options: [
            { id: "allow-once", label: "Allow once" },
            { id: "deny", label: "Deny" },
          ],
          multiSelect: false,
          allowCustom: false,
        },
      ],
      status: "pending",
      createdAt,
      expiresAt: createdAt + 15 * 60_000,
    }
    const resolution = await agentInputLifecycle.create(inputRequest, { timeoutMs: 15 * 60_000 })
    const allowed =
      resolution.status === "answered" &&
      resolution.response.answers.permission?.includes("Allow once")

    if (provider === "claude-code") {
      return allowed
        ? {
            behavior: "allow",
            updatedInput: isPlainRecord(record.toolInput) ? record.toolInput : {},
          }
        : { behavior: "deny", message: "User denied the tool request." }
    }
    if (method === "item/permissions/requestApproval") {
      return codexPermissionProfileApproval(record, allowed)
    }
    return { decision: allowed ? "accept" : "cancel" }
  }

  private async requestInputFromProvider(runId: string, request: unknown): Promise<unknown> {
    if (!this.inputHandler) throw new Error("Runtime input bridge is unavailable.")
    return await this.inputHandler(runId, request)
  }

  private async cancelPersisted(runId: string, reason: string): Promise<boolean> {
    const run = loadRunningAgentRun(this.databasePath, runId)
    if (!run) return false
    const persistedSession = await this.loadPersistedSession(runId, false)
    if (!persistedSession?.providerSessionId && !persistedSession?.providerThreadId) {
      await this.persistLifecycle(
        runId,
        "uncertain",
        "Persisted Runtime cancellation has no provider identity.",
      )
      return false
    }
    return await this.coordinator.cancelPersisted(
      {
        runId,
        chatId: run.chatId,
        subChatId: run.subChatId,
        launch: run.runtimeLaunch ?? legacyLaunch(run),
        prompt: run.prompt,
        persistedSession,
      },
      reason,
    )
  }

  private activeReconciliationState(runId: string): AgentRunReconciliationState | null {
    const state = this.coordinator.runState(runId)
    if (!state) return null
    if (state === "starting" || state === "running" || state === "paused") return "running"
    if (state === "completed") return "completed"
    if (state === "cancelled") return "cancelled"
    if (state === "failed") return "failed"
    return "uncertain"
  }

  private async serializePersistedOperation<T>(
    runId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.persistedOperations.get(runId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => gate)
    this.persistedOperations.set(runId, tail)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.persistedOperations.get(runId) === tail) this.persistedOperations.delete(runId)
    }
  }

  private claudeDependencies(): ClaudeRuntimeDependencies {
    return {
      query: (input) => claudeQuery(input),
      probe: async () => {
        const binary = await resolveBundledClaudePath()
        return {
          available: existsSync(binary),
          sdkVersion: CLAUDE_AGENT_SDK_VERSION,
          claudeCodeVersion: CLAUDE_CODE_VERSION,
          features: {
            partialMessages: true,
            thinking: true,
            hooks: true,
            subagentForwarding: true,
            resume: true,
            resumeAt: true,
            fork: true,
            cancellation: true,
          },
          unavailableReason: existsSync(binary) ? null : "Bundled Claude Code binary is missing.",
        }
      },
      buildQueryOptions: async (context, _prompt, abortController) => {
        const authority = await this.resolveExtensionAuthority(context, "claude-code")
        const enhanced = usesFlapstackRuntimeEnhancements(context.launch.requestedPreference)
        const sdkOptions = enhanced ? getClaudeExtensionSdkOptions(authority.policy) : {}
        const hooks = enhanced
          ? buildManagedClaudeHookOptions(authority.hooks, (record, input, signal) =>
              this.hookRuntimeExecutor.execute(record, input, signal, authority.cwd),
            )
          : {}
        const mcpServers =
          enhanced && authority.policy.disabledMcpNames.length > 0
            ? filterClaudeExtensionMcpServers(
                await loadClaudeMcpServers(authority.cwd),
                authority.policy,
              )
            : undefined
        return {
          cwd: authority.cwd,
          pathToClaudeCodeExecutable: await resolveBundledClaudePath(),
          includePartialMessages: true,
          settingSources: ["user", "project", "local"],
          canUseTool: async (
            toolName: string,
            toolInput: Record<string, unknown>,
            options: { toolUseID: string },
          ) => {
            if (toolName === "AskUserQuestion") {
              const questions = normalizeClaudeInputQuestions(toolInput.questions)
              if (questions.length === 0) {
                return { behavior: "deny", message: "Claude supplied no structured questions." }
              }
              const createdAt = Date.now()
              const resolution = await agentInputLifecycle.create(
                {
                  requestId: options.toolUseID,
                  chatId: context.subChatId ?? context.chatId,
                  runId: context.runId,
                  origin: {
                    harness: "claude-code",
                    provider: "anthropic",
                    ...(context.launch.model ? { model: context.launch.model } : {}),
                    toolName,
                  },
                  capability: { mode: "native", sameRun: true },
                  questions,
                  status: "pending",
                  createdAt,
                  expiresAt: createdAt + 15 * 60_000,
                },
                { timeoutMs: 15 * 60_000, signal: abortController.signal },
              )
              if (resolution.status !== "answered") {
                return { behavior: "deny", message: resolution.message }
              }
              return {
                behavior: "allow",
                updatedInput: {
                  questions: toolInput.questions,
                  answers: formatClaudeInputAnswers(questions, resolution.response.answers),
                },
              }
            }
            const decision = await resolveClaudeRuntimeToolPermission({
              mode: context.launch.permission.mode,
              customPermissions: parseRuntimeCustomPermissions(
                this.runs.get(context.runId)?.customPermissions ?? null,
              ),
              cwd: authority.cwd,
              toolName,
              toolInput,
            })
            if (decision) return decision
            return await this.requestPermissionFromProvider(context.runId, {
              provider: "claude-code",
              requestId: options.toolUseID,
              toolName,
              toolInput,
              toolUseID: options.toolUseID,
            })
          },
          systemPrompt: {
            type: "preset" as const,
            preset: "claude_code" as const,
            ...(enhanced && context.instructions ? { append: context.instructions } : {}),
          },
          ...claudePermissionOptions(context.launch.permission.mode),
          ...(context.launch.model ? { model: context.launch.model } : {}),
          ...sdkOptions,
          ...(mcpServers ? { mcpServers } : {}),
          ...(Object.keys(hooks).length > 0 ? { hooks, includeHookEvents: true } : {}),
        }
      },
      resolvePrompt: (context, prompt) =>
        buildClaudeRuntimePrompt(prompt, this.runs.get(context.runId)?.images ?? []),
      loadSession: async (context) => {
        const session = await this.loadPersistedSession(context.runId)
        return session?.providerSessionId ? { sessionId: session.providerSessionId } : null
      },
      persistSession: (context, sessionId) =>
        this.persistSession(context.runId, {
          providerSessionId: sessionId,
          providerThreadId: null,
        }),
      clearStaleSession: (context, sessionId) =>
        this.clearPersistedSession(context.runId, sessionId),
      persistMessageUuid: async (context, messageUuid) =>
        this.persistTurn(
          context.runId,
          (await this.loadPersistedSession(context.runId)) ?? {
            providerSessionId: null,
            providerThreadId: null,
          },
          { providerTurnId: messageUuid },
        ),
      appendActivity: (context, events) => this.appendActivity(context.runId, events),
      requestPermission: (context, request) =>
        this.requestPermissionFromProvider(context.runId, request),
      requestInput: (context, request) => this.requestInputFromProvider(context.runId, request),
      reconcile: async () => "uncertain",
    }
  }

  private persistIntent(runId: string): void {
    const db = this.open()
    try {
      db.transaction(() => {
        const row = db.prepare("SELECT status FROM agent_runs WHERE id = ?").get(runId) as
          { status: string } | undefined
        if (!row || row.status !== "running") {
          throw new Error("Runtime launch intent has no claimed durable running row.")
        }
        this.appendActivityWithDatabase(db, runId, [
          lifecycleActivity("intent-persisted", "intent-persisted"),
        ])
      }).immediate()
    } finally {
      db.close()
    }
  }

  private async persistSession(runId: string, session: RuntimeAdapterSession): Promise<void> {
    const db = this.open()
    try {
      db.transaction(() => {
        const run = this.requireRunRow(db, runId)
        const identity =
          run.resolved_runtime === "codex"
            ? session.providerThreadId
            : (session.providerSessionId ?? session.providerThreadId)
        if (run.sub_chat_id && identity) {
          db.prepare("UPDATE sub_chats SET session_id = ?, updated_at = ? WHERE id = ?").run(
            identity,
            nowEpochSeconds(),
            run.sub_chat_id,
          )
        }
        this.appendActivityWithDatabase(db, runId, [
          lifecycleActivity("session-started", "session-started", session),
        ])
      }).immediate()
    } finally {
      db.close()
    }
  }

  private async persistTurn(
    runId: string,
    session: RuntimeAdapterSession,
    turn: RuntimeAdapterTurn,
  ): Promise<void> {
    const db = this.open()
    try {
      this.appendActivityWithDatabase(db, runId, [
        lifecycleActivity("turn-started", "turn-started", session, turn),
      ])
    } finally {
      db.close()
    }
  }

  private async persistLifecycle(
    runId: string,
    lifecycle: string,
    detail?: string | null,
  ): Promise<void> {
    const db = this.open()
    try {
      db.transaction(() => {
        const run = this.requireRunRow(db, runId)
        const now = nowEpochSeconds()
        const terminal = terminalStatus(lifecycle)
        if (terminal) {
          const transition = db
            .prepare(
              `UPDATE agent_runs SET status = ?, completed_at = ?
               WHERE id = ? AND status IN ('pending','running') AND completed_at IS NULL`,
            )
            .run(terminal, now, runId)
          if (transition.changes === 0) return
          if (run.sub_chat_id) {
            db.prepare(
              `UPDATE sub_chats SET run_status = COALESCE((
                 SELECT status FROM agent_runs
                 WHERE sub_chat_id = ? AND id <> ? AND status IN ('pending','running')
                 ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, started_at, id
                 LIMIT 1
               ), ?), updated_at = ? WHERE id = ?`,
            ).run(run.sub_chat_id, runId, terminal, now, run.sub_chat_id)
          }
        }
        const dedupKey = ["paused", "resumed"].includes(lifecycle) ? null : `lifecycle:${lifecycle}`
        this.appendActivityWithDatabase(db, runId, [
          lifecycleActivity(lifecycle, dedupKey, undefined, undefined, detail),
        ])
      }).immediate()
    } finally {
      db.close()
    }
  }

  private async appendDiagnostic(runId: string, code: string, message: string): Promise<void> {
    await this.appendActivity(runId, [
      {
        provider: "runtime",
        kind: "warning",
        phase: "failed",
        displayClass: "status",
        privacyClass: "sensitive",
        payload: {
          message: sanitizeRuntimeText(message, { maxLength: 2_048, mode: "diagnostic" }),
          code,
        },
        dedupKey: `diagnostic:${code}:${message}`,
      },
    ])
  }

  private async appendActivity(
    runId: string,
    events: readonly AgentActivityAppend[],
  ): Promise<void> {
    const db = this.open()
    try {
      this.appendActivityWithDatabase(db, runId, events)
    } finally {
      db.close()
    }
  }

  private appendActivityWithDatabase(
    db: Database.Database,
    runId: string,
    events: readonly AgentActivityAppend[],
  ): void {
    const agent = db
      .prepare("SELECT id FROM orchestration_agents WHERE run_id = ? LIMIT 1")
      .get(runId) as { id: string } | undefined
    createAgentActivityStore(db).appendBatch(
      runId,
      events.map((event) => ({
        ...event,
        orchestrationAgentId: event.orchestrationAgentId ?? agent?.id ?? null,
      })),
    )
  }

  private referenceActivity(runId: string): void {
    const db = this.open()
    try {
      db.prepare("UPDATE orchestration_agents SET updated_at = ? WHERE run_id = ?").run(
        nowEpochSeconds(),
        runId,
      )
    } finally {
      db.close()
    }
  }

  private async loadPersistedSession(
    runId: string,
    allowSubChatFallback = true,
  ): Promise<RuntimeAdapterSession | null> {
    const db = this.open()
    try {
      const row = db
        .prepare(
          `SELECT r.resolved_runtime, s.session_id, a.provider_session_id, a.provider_thread_id
           FROM agent_runs r
           LEFT JOIN sub_chats s ON s.id = r.sub_chat_id
           LEFT JOIN agent_activity_events a ON a.storage_id = (
             SELECT MAX(storage_id) FROM agent_activity_events
             WHERE run_id = r.id AND (provider_session_id IS NOT NULL OR provider_thread_id IS NOT NULL)
           )
           WHERE r.id = ?`,
        )
        .get(runId) as
        | {
            session_id: string | null
            resolved_runtime: string
            provider_session_id: string | null
            provider_thread_id: string | null
          }
        | undefined
      if (!row) return null
      const fallbackIdentity = allowSubChatFallback ? row.session_id : null
      const providerSessionId =
        row.provider_session_id ??
        (row.resolved_runtime === "codex" ? null : fallbackIdentity) ??
        null
      const providerThreadId =
        row.provider_thread_id ??
        (row.resolved_runtime === "codex" ? fallbackIdentity : null) ??
        null
      return providerSessionId || providerThreadId ? { providerSessionId, providerThreadId } : null
    } finally {
      db.close()
    }
  }

  private async loadPersistedTurn(runId: string): Promise<RuntimeAdapterTurn | null> {
    const db = this.open()
    try {
      const row = db
        .prepare(
          `SELECT provider_turn_id FROM agent_activity_events
           WHERE run_id = ? AND provider_turn_id IS NOT NULL
           ORDER BY storage_id DESC LIMIT 1`,
        )
        .get(runId) as { provider_turn_id: string | null } | undefined
      return row?.provider_turn_id ? { providerTurnId: row.provider_turn_id } : null
    } finally {
      db.close()
    }
  }

  private async clearPersistedSession(runId: string, sessionId: string): Promise<void> {
    const db = this.open()
    try {
      const run = this.requireRunRow(db, runId)
      if (run.sub_chat_id) {
        db.prepare("UPDATE sub_chats SET session_id = NULL WHERE id = ? AND session_id = ?").run(
          run.sub_chat_id,
          sessionId,
        )
      }
    } finally {
      db.close()
    }
  }

  private resolveRunCwd(runId: string): string {
    const active = this.runs.get(runId)
    if (active) {
      const cwd = active.worktreePath ?? active.projectPath
      if (cwd) return cwd
    }
    const db = this.open()
    try {
      const row = db
        .prepare(
          `SELECT COALESCE(r.worktree_path, c.worktree_path, p.path) cwd
           FROM agent_runs r JOIN chats c ON c.id = r.chat_id
           LEFT JOIN projects p ON p.id = c.project_id WHERE r.id = ?`,
        )
        .get(runId) as { cwd: string | null } | undefined
      if (!row?.cwd) throw new Error("Runtime run has no durable working directory.")
      return row.cwd
    } finally {
      db.close()
    }
  }

  private async resolveExtensionAuthority(
    context: RuntimeAdapterContext,
    harness: "codex" | "claude-code",
  ): Promise<{ cwd: string; policy: ExtensionLaunchPolicy; hooks: HookRecord[] }> {
    const sqlite = this.open()
    try {
      const database = drizzle(sqlite, { schema })
      const requestedCwd = this.resolveRunCwd(context.runId)
      const resolveRoot = (path: string): string => {
        try {
          return assertRegisteredFilesystemRoot(path, database).canonicalPath
        } catch (error) {
          const alias = database
            .select({ path: schema.filesystemRootRegistrations.path })
            .from(schema.filesystemRootRegistrations)
            .all()
            .find((entry) => {
              try {
                return assertRegisteredFilesystemRoot(entry.path, database).canonicalPath === path
              } catch {
                return false
              }
            })
          if (!alias) throw error
          return assertRegisteredFilesystemRoot(alias.path, database).canonicalPath
        }
      }
      const cwd = resolveRoot(requestedCwd)
      const extension = await buildExtensionRunContext(database, {
        chatId: context.chatId,
        harness,
        cwd,
      })
      const hooks = resolveEnabledManagedHooks({
        store: this.hookStore,
        harness,
        cwd,
        resolveProjectCwd: resolveRoot,
      })
      return { cwd, policy: extension.launchPolicy, hooks }
    } finally {
      sqlite.close()
    }
  }

  private async resolveDirectRuntimeInstructions(run: QueuedAgentRun): Promise<string | null> {
    const runtime = run.runtimeLaunch?.resolvedRuntime
    if (runtime !== "codex" && runtime !== "claude-code") return null
    if (!usesFlapstackRuntimeEnhancements(run.runtimeLaunch!.requestedPreference)) return null

    const sqlite = this.open()
    try {
      const database = drizzle(sqlite, { schema })
      const cwd = run.worktreePath || run.projectPath
      const contextBundle =
        cwd && existsSync(cwd)
          ? await buildHarnessContextBundle({
              cwd,
              ...(run.projectPath ? { projectPath: run.projectPath } : {}),
              harness: runtime,
              userPrompt: run.prompt,
              providerNativeInstructions: true,
            })
          : null
      let vaultContext = emptyProjectVaultRunContext({ harness: runtime, runId: run.runId })
      if (isBetaFeatureEnabled("projectMemory")) {
        try {
          vaultContext = await buildProjectVaultRunContext(database, {
            chatId: run.chatId,
            runId: run.runId,
            harness: runtime,
          })
        } catch (error) {
          if (error instanceof ProjectVaultContextRejectedError) {
            persistProjectVaultContextManifest(database, {
              runId: run.runId,
              manifest: error.manifest,
            })
          }
          throw error
        }
      }
      persistProjectVaultContextManifest(database, {
        runId: run.runId,
        manifest: vaultContext.manifest,
      })
      return (
        buildStartupInstructions(
          [contextBundle?.context, vaultContext.context].filter(Boolean).join("\n\n"),
          run.prompt,
          { hotlineEnabled: run.hotlineEnabled },
        ) || null
      )
    } finally {
      sqlite.close()
    }
  }

  private requireRunRow(db: Database.Database, runId: string) {
    const row = db
      .prepare("SELECT id, sub_chat_id, resolved_runtime FROM agent_runs WHERE id = ?")
      .get(runId) as
      { id: string; sub_chat_id: string | null; resolved_runtime: string } | undefined
    if (!row) throw new Error(`Runtime run ${runId} is missing.`)
    return row
  }

  private open(): Database.Database {
    const db = new Database(this.databasePath)
    db.pragma("foreign_keys = ON")
    db.pragma("busy_timeout = 5000")
    return db
  }
}

export function resolveRuntimeTurnPrompt(
  run: Pick<QueuedAgentRun, "prompt" | "chatMode">,
  launch: Pick<ResolvedRuntimeLaunch, "resolvedRuntime">,
): string {
  return launch.resolvedRuntime === "flapstack-native"
    ? run.prompt
    : applyChatModeInstruction(run.prompt, normalizeChatMode(run.chatMode))
}

function buildClaudeRuntimePrompt(
  prompt: string,
  images: Array<{ base64Data: string; mediaType: string; filename?: string }>,
): string | AsyncIterable<unknown> {
  if (images.length === 0) return prompt
  const content = [
    ...images.map((image) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: image.mediaType,
        data: image.base64Data,
      },
    })),
    ...(prompt.trim() ? [{ type: "text" as const, text: prompt }] : []),
  ]
  return (async function* () {
    yield {
      type: "user" as const,
      message: { role: "user" as const, content },
      parent_tool_use_id: null,
    }
  })()
}

async function loadClaudeMcpServers(cwd: string): Promise<Record<string, McpServerConfig>> {
  const [config, dirConfig, projectJson, enabledPlugins, pluginConfigs, approvedPlugins] =
    await Promise.all([
      readClaudeConfig(),
      readClaudeDirConfig(),
      readProjectMcpJson(cwd),
      getEnabledPlugins(),
      discoverPluginMcpServers(),
      getApprovedPluginMcpServers(),
    ])
  const [globalServers, projectConfigServers] = await Promise.all([
    getMergedGlobalMcpServers(config, dirConfig),
    getMergedLocalProjectMcpServers(cwd, config, dirConfig),
  ])
  const projectServers = { ...projectJson, ...projectConfigServers }
  const pluginServers: Record<string, McpServerConfig> = {}
  for (const plugin of pluginConfigs) {
    if (!enabledPlugins.includes(plugin.pluginSource)) continue
    for (const [name, server] of Object.entries(plugin.mcpServers)) {
      const identifier = `${plugin.pluginSource}:${name}`
      if (
        approvedPlugins.includes(identifier) &&
        !(name in globalServers) &&
        !(name in projectServers)
      ) {
        pluginServers[name] = server
      }
    }
  }
  return { ...pluginServers, ...globalServers, ...projectServers }
}

export function getMainRuntimeLaunchService(
  databasePath = getDatabasePath(),
  options: Omit<MainRunLauncherOptions, "databasePath"> = {},
): MainRuntimeLaunchService {
  let service = services.get(databasePath)
  if (!service) {
    service = new MainRuntimeLaunchService({ ...options, databasePath })
    services.set(databasePath, service)
  }
  registerRuntimeLaunchAuthority(databasePath, service)
  return service
}

export function resetMainRuntimeLaunchServicesForTests(): void {
  services.clear()
  resetRuntimeLaunchAuthoritiesForTests()
}

/** Central Runtime dispatch for durable MCP, automation, retry, and worker runs. */
export function createMainRunLauncher(options: MainRunLauncherOptions = {}): AgentRunLauncher {
  return getMainRuntimeLaunchService(options.databasePath, options).launch
}

function createLegacyDelegation(
  harness: string,
  caller: ReturnType<ReturnType<typeof createAppRouter>["createCaller"]>,
  runs: Map<string, QueuedAgentRun>,
  streams: Map<string, unknown>,
  states: Map<string, "running" | "completed" | "uncertain">,
): FlapstackNativeProviderDelegation<unknown> | null {
  if (!isAgentHarness(harness)) return null
  return {
    probe: () => ({ available: true }),
    async startSession() {
      return { providerSessionId: null, providerThreadId: null }
    },
    async resumeSession(_context: RuntimeAdapterContext, session: RuntimeAdapterSession) {
      return session
    },
    async startTurn(
      context: RuntimeAdapterContext,
      _session: RuntimeAdapterSession,
      prompt: string,
    ) {
      const run = runs.get(context.runId)
      if (!run) throw new Error("Queued Runtime launch disappeared before provider dispatch.")
      streams.set(context.runId, await launchLegacyStream(caller, { ...run, prompt }))
      states.set(context.runId, "running")
      return { providerTurnId: null }
    },
    async *streamActivity(context: RuntimeAdapterContext) {
      const stream = streams.get(context.runId)
      if (!stream) throw new Error("Harness launch did not return a stream.")
      try {
        for await (const chunk of iterateStream(stream)) {
          assertNoProviderError(chunk, runs.get(context.runId)!)
          yield chunk
        }
        states.set(context.runId, "completed")
      } catch (error) {
        states.set(context.runId, "uncertain")
        throw error
      }
    },
    async requestPermission() {
      throw new Error("Flapstack Native provider router owns permission requests.")
    },
    async requestInput() {
      throw new Error("Flapstack Native provider router owns input requests.")
    },
    async cancel(context: RuntimeAdapterContext) {
      const run = runs.get(context.runId)
      if (!run) return
      switch (run.harness) {
        case "codex":
          await caller.codex.cancel({ subChatId: run.subChatId, runId: run.runId })
          break
        case "claude-code":
          await caller.claude.cancel({ subChatId: run.subChatId })
          break
        case "cursor-agent":
          await caller.cursor.cancel({ subChatId: run.subChatId, runId: run.runId })
          break
        case "openrouter":
        case "nanogpt":
          await caller.opencode.cancel({ subChatId: run.subChatId, runId: run.runId })
          break
        case "local":
          await caller.localModels.cancel({ runId: run.runId })
          break
      }
      states.set(context.runId, "completed")
    },
    async complete() {},
    async reconcile(context: RuntimeAdapterContext) {
      return states.get(context.runId) ?? "uncertain"
    },
    async cleanup(context: RuntimeAdapterContext) {
      streams.delete(context.runId)
      states.delete(context.runId)
    },
  }
}

async function launchLegacyStream(
  caller: ReturnType<ReturnType<typeof createAppRouter>["createCaller"]>,
  run: QueuedAgentRun,
): Promise<unknown> {
  const cwd = run.worktreePath ?? run.projectPath
  if (!cwd) throw new Error("Run has no project or worktree path.")
  const model =
    run.harness === "codex" ? resolveCodexLaunchModel(run.model, run.reasoningEffort) : run.model
  const chatMode = normalizeChatMode(run.chatMode)
  const reasoningEnabled = run.reasoningEffort !== "minimal" && run.reasoningEffort !== "none"
  if (run.harness === "local") {
    return launchLocalModelStream(caller, run, cwd)
  }
  switch (run.harness) {
    case "codex":
      return caller.codex.chat({
        runId: run.runId,
        chatId: run.chatId,
        subChatId: run.subChatId,
        prompt: run.prompt,
        cwd,
        ...(run.projectPath ? { projectPath: run.projectPath } : {}),
        ...(model ? { model } : {}),
        mode: chatMode,
        reasoningEnabled,
        ...(legacyCodexEffort(run.reasoningEffort)
          ? { reasoningEffort: legacyCodexEffort(run.reasoningEffort)! }
          : {}),
      })
    case "claude-code":
      return caller.claude.chat({
        runId: run.runId,
        chatId: run.chatId,
        subChatId: run.subChatId,
        prompt: run.prompt,
        cwd,
        ...(run.projectPath ? { projectPath: run.projectPath } : {}),
        ...(model ? { model } : {}),
        mode: chatMode,
        reasoningEnabled,
        ...(legacyClaudeEffort(run.reasoningEffort)
          ? { effort: legacyClaudeEffort(run.reasoningEffort)! }
          : {}),
      })
    case "cursor-agent":
      return caller.cursor.chat({
        runId: run.runId,
        chatId: run.chatId,
        subChatId: run.subChatId,
        prompt: run.prompt,
        mode: chatMode,
        cwd,
        ...(run.projectPath ? { projectPath: run.projectPath } : {}),
        ...(model ? { model } : {}),
        reasoningEnabled,
      })
    case "openrouter":
    case "nanogpt":
      return caller.opencode.chat({
        runId: run.runId,
        chatId: run.chatId,
        subChatId: run.subChatId,
        provider: run.harness,
        model: requireModel(run),
        prompt: run.prompt,
        mode: chatMode,
        cwd,
        ...(run.projectPath ? { projectPath: run.projectPath } : {}),
        reasoningEnabled,
        reasoningEffort: legacyCodexEffort(run.reasoningEffort) ?? "high",
      })
    default:
      return unsupportedHarness(run)
  }
}

async function launchLocalModelStream(
  caller: ReturnType<ReturnType<typeof createAppRouter>["createCaller"]>,
  run: QueuedAgentRun,
  cwd: string,
): Promise<unknown> {
  const model = requireModel(run)
  const endpoint = run.localEndpoint ?? DEFAULT_OLLAMA_BASE_URL
  const catalog = await caller.localModels.catalog({ endpoint })
  const selection = resolveLocalModelSelection(catalog, model)
  if (!selection.runnable || !selection.model) {
    throw new Error(
      `Local model preflight failed: ${selection.limitations[0]?.message ?? "the selected model is unavailable"} No cloud fallback was attempted.`,
    )
  }
  const customPermissions = parseRuntimeCustomPermissions(run.customPermissions)
  const tiers = resolveLocalModelToolTiers(
    selection.model.capabilities,
    run.permissionMode as Parameters<typeof resolveLocalModelToolTiers>[1],
    customPermissions,
  )
  const required = run.requiredLocalToolTiers ?? []
  const mismatch = findUnavailableLocalModelTier(required, tiers)
  if (mismatch) {
    throw new Error(
      `Local model preflight failed for ${mismatch.requiredTier}: ${mismatch.state?.limitation?.message ?? "capability unavailable"} No cloud fallback was attempted.`,
    )
  }
  return caller.localModels.chat({
    runId: run.runId,
    chatId: run.chatId,
    subChatId: run.subChatId,
    prompt: run.prompt,
    mode: normalizeChatMode(run.chatMode),
    model,
    endpoint,
    cwd,
    ...(run.projectPath ? { projectPath: run.projectPath } : {}),
  })
}

function parseRuntimeCustomPermissions(value: string | null) {
  if (!value) return null
  try {
    return parseCustomPermissionCapabilities(JSON.parse(value))
  } catch {
    return null
  }
}

function requireModel(run: QueuedAgentRun): string {
  const model = run.model?.trim()
  if (!model) throw new Error(`${run.harness} run requires an explicit model.`)
  return model
}

function unsupportedHarness(run: QueuedAgentRun): never {
  throw new Error(`Harness ${run.harness} has no main-process run launcher.`)
}

function resolveCodexLaunchModel(
  model: string | null,
  reasoningEffort: QueuedAgentRun["reasoningEffort"],
): string | null {
  const normalized = model?.trim()
  if (!normalized) return null
  const effort =
    reasoningEffort === "max" || reasoningEffort === "ultra"
      ? "xhigh"
      : reasoningEffort && reasoningEffort !== "minimal" && reasoningEffort !== "none"
        ? reasoningEffort
        : "low"
  const withoutEffort = normalized
    .replace(/\/(?:none|minimal|low|medium|high|xhigh|max|ultra)$/i, "")
    .replace(/\[(?:none|minimal|low|medium|high|xhigh|max|ultra)\]$/i, "")
  if (withoutEffort.includes("/")) return normalized
  return `${withoutEffort}/${effort}`
}

function legacyCodexEffort(
  effort: QueuedAgentRun["reasoningEffort"],
): "minimal" | "low" | "medium" | "high" | "xhigh" | null {
  if (effort === "none") return "minimal"
  if (effort === "max" || effort === "ultra") return "xhigh"
  return effort
}

function legacyClaudeEffort(
  effort: QueuedAgentRun["reasoningEffort"],
): "low" | "medium" | "high" | "xhigh" | "max" | null {
  if (!effort || effort === "none" || effort === "minimal") return null
  return effort === "ultra" ? "max" : effort
}

async function* iterateStream(stream: unknown): AsyncIterable<unknown> {
  if (isAsyncIterable(stream)) {
    yield* stream
    return
  }
  if (isSubscribable(stream)) {
    const queue: unknown[] = []
    let done = false
    let failure: unknown
    let wake: (() => void) | null = null
    stream.subscribe({
      next: (chunk) => {
        queue.push(chunk)
        wake?.()
      },
      error: (error) => {
        failure = error
        done = true
        wake?.()
      },
      complete: () => {
        done = true
        wake?.()
      },
    })
    while (!done || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()
        continue
      }
      await new Promise<void>((resolve) => {
        wake = resolve
      })
      wake = null
    }
    if (failure) throw failure
    return
  }
  throw new Error("Harness launch did not return a stream.")
}

function assertNoProviderError(chunk: unknown, run: QueuedAgentRun): void {
  if (!chunk || typeof chunk !== "object") return
  const value = chunk as { type?: unknown; errorText?: unknown }
  if (value.type === "error" || value.type === "auth-error")
    throw new Error(
      typeof value.errorText === "string" ? value.errorText : `${run.harness} run failed to start.`,
    )
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function",
  )
}

function isSubscribable(value: unknown): value is {
  subscribe(observer: {
    next(value: unknown): void
    error(error: unknown): void
    complete(): void
  }): unknown
} {
  return Boolean(value && typeof (value as { subscribe?: unknown }).subscribe === "function")
}

function legacyLaunch(run: QueuedAgentRun): ResolvedRuntimeLaunch {
  return {
    schemaVersion: 1,
    harness: run.harness,
    model: run.model,
    requestedPreference: "flapstack-native",
    preferenceSource: "legacy",
    resolvedRuntime: "flapstack-native",
    compatibility: {
      compatible: true,
      harness: run.harness,
      runtime: "flapstack-native",
      reason: null,
    },
    versions: { adapterVersion: "legacy-stage3", protocolVersion: "legacy-stage3" },
    capabilities: LEGACY_RUNTIME_CAPABILITIES,
    controls: {
      schemaVersion: 1,
      modelEffort: run.reasoningEffort,
      modelThinking: run.reasoningEffort !== "minimal",
      reasoningDisplay: run.reasoningEffort !== "minimal",
      subagentActivity: true,
      hookDiagnostics: false,
    },
    permission: {
      mode: run.permissionMode as ResolvedRuntimeLaunch["permission"]["mode"],
      customPermissions: null,
    },
  }
}

function lifecycleActivity(
  state: string,
  dedupKey: string | null,
  session?: RuntimeAdapterSession,
  turn?: RuntimeAdapterTurn,
  detail?: string | null,
): AgentActivityAppend {
  const phase =
    state === "completed"
      ? "completed"
      : state === "cancelled"
        ? "cancelled"
        : state === "failed" || state === "uncertain"
          ? "failed"
          : "started"
  return {
    provider: "runtime",
    kind: "lifecycle",
    phase,
    displayClass: "status",
    privacyClass: detail ? "sensitive" : "public",
    providerSessionId: session?.providerSessionId ?? null,
    providerThreadId: session?.providerThreadId ?? null,
    providerTurnId: turn?.providerTurnId ?? null,
    payload: {
      state,
      detail: detail ? sanitizeRuntimeText(detail, { maxLength: 2_048, mode: "diagnostic" }) : null,
    },
    dedupKey: dedupKey ? `runtime:${dedupKey}` : null,
  }
}

function terminalStatus(lifecycle: string): "success" | "failure" | "cancelled" | null {
  if (lifecycle === "completed") return "success"
  if (lifecycle === "failed" || lifecycle === "uncertain") return "failure"
  if (lifecycle === "cancelled") return "cancelled"
  return null
}

type StructuredOutputRunRow = {
  id: string
  chat_id: string
  sub_chat_id: string | null
  harness: string
  resolved_runtime: string
  status: string
  completed_at: number | null
}

type StructuredOutputEventRow = {
  event_id: string
  run_id: string
  chat_id: string
  sub_chat_id: string | null
  runtime: string
  harness: string
  provider: string
  sequence: number
  display_class: string
  privacy_class: string
  redaction_state: string
  dedup_key: string | null
  payload_json: string
}

function readStructuredOutput(
  db: Database.Database,
  runId: string,
): RuntimeStructuredOutput | null {
  const run = db
    .prepare(
      `SELECT id, chat_id, sub_chat_id, harness, resolved_runtime, status, completed_at
       FROM agent_runs WHERE id = ?`,
    )
    .get(runId) as StructuredOutputRunRow | undefined
  if (!run || run.status !== "success" || run.completed_at === null) return null

  const output = db
    .prepare(
      `SELECT event_id, run_id, chat_id, sub_chat_id, runtime, harness, provider, sequence,
              display_class, privacy_class, redaction_state, dedup_key, payload_json
       FROM agent_activity_events
       WHERE run_id = ? AND kind = 'agent-text' AND phase = 'completed'
       ORDER BY sequence DESC LIMIT 1`,
    )
    .get(runId) as StructuredOutputEventRow | undefined
  if (!output) return null
  assertStructuredOutputIdentity(run, output)
  if (
    output.display_class !== "provider-visible" ||
    output.privacy_class !== "public" ||
    output.redaction_state !== "none" ||
    output.provider === "runtime"
  ) {
    throw new Error("Completed Runtime output is not public provider-visible activity.")
  }

  const terminal = db
    .prepare(
      `SELECT event_id, run_id, chat_id, sub_chat_id, runtime, harness, provider, sequence,
              display_class, privacy_class, redaction_state, dedup_key, payload_json
       FROM agent_activity_events
       WHERE run_id = ? AND kind = 'lifecycle' AND phase = 'completed' AND sequence > ?
       ORDER BY sequence ASC LIMIT 1`,
    )
    .get(runId, output.sequence) as StructuredOutputEventRow | undefined
  if (!terminal) throw new Error("Completed Runtime output has no authoritative terminal event.")
  assertStructuredOutputIdentity(run, terminal)
  if (
    terminal.display_class !== "status" ||
    terminal.privacy_class !== "public" ||
    terminal.redaction_state !== "none" ||
    terminal.provider !== "runtime" ||
    terminal.dedup_key !== "runtime:runtime:lifecycle:completed"
  ) {
    throw new Error("Runtime completion activity is not authoritative.")
  }
  const terminalPayload = parseActivityPayload(terminal.payload_json)
  if (
    terminalPayload.state !== "completed" ||
    terminalPayload.detail !== null ||
    Object.keys(terminalPayload).some((key) => key !== "state" && key !== "detail")
  ) {
    throw new Error("Runtime completion activity is corrupt.")
  }

  const payload = parseActivityPayload(output.payload_json)
  if (typeof payload.text !== "string" || Object.keys(payload).some((key) => key !== "text")) {
    throw new Error("Completed Runtime output activity is corrupt.")
  }
  const value = parseStructuredRuntimeText(payload.text)
  assertStructuredRuntimeValue(value)
  return Object.freeze({
    value: freezeStructuredRuntimeValue(value),
    activityReference: Object.freeze({
      runId: run.id,
      eventId: output.event_id,
      sequence: output.sequence,
    }),
  })
}

function assertStructuredOutputIdentity(
  run: StructuredOutputRunRow,
  event: StructuredOutputEventRow,
): void {
  if (
    event.run_id !== run.id ||
    event.chat_id !== run.chat_id ||
    event.sub_chat_id !== run.sub_chat_id ||
    event.runtime !== run.resolved_runtime ||
    event.harness !== run.harness ||
    !event.event_id ||
    !Number.isInteger(event.sequence) ||
    event.sequence < 1
  ) {
    throw new Error("Runtime structured output identity is corrupt.")
  }
}

function parseActivityPayload(payloadJson: string): Record<string, unknown> {
  if (Buffer.byteLength(payloadJson, "utf8") > MAX_AGENT_ACTIVITY_PAYLOAD_BYTES) {
    throw new Error("Runtime structured output activity exceeds its size bound.")
  }
  try {
    const value = JSON.parse(payloadJson) as unknown
    if (!isPlainRecord(value)) throw new Error("not an object")
    return value
  } catch {
    throw new Error("Runtime structured output activity is corrupt.")
  }
}

function parseStructuredRuntimeText(text: string): unknown {
  const trimmed = text.trim()
  const fenced = /^```json\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  if (!candidate || Buffer.byteLength(candidate, "utf8") > MAX_AGENT_ACTIVITY_PAYLOAD_BYTES) {
    throw new Error("Completed Runtime output exceeds its size bound.")
  }
  try {
    return JSON.parse(candidate) as unknown
  } catch {
    throw new Error("Completed Runtime output is not valid JSON.")
  }
}

function assertStructuredRuntimeValue(value: unknown): void {
  const budget = { entries: 0 }
  visitStructuredRuntimeValue(value, 0, budget)
}

function visitStructuredRuntimeValue(
  value: unknown,
  depth: number,
  budget: { entries: number },
): void {
  if (depth > MAX_AGENT_ACTIVITY_METADATA_DEPTH) {
    throw new Error("Completed Runtime output exceeds its depth bound.")
  }
  if (value === null || typeof value === "boolean") return
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Completed Runtime output contains an invalid number.")
    return
  }
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAX_AGENT_ACTIVITY_METADATA_STRING) {
      throw new Error("Completed Runtime output contains an oversized string.")
    }
    return
  }
  if (Array.isArray(value)) {
    budget.entries += value.length
    assertStructuredRuntimeEntryBudget(budget)
    for (const item of value) visitStructuredRuntimeValue(item, depth + 1, budget)
    return
  }
  if (!isPlainRecord(value)) throw new Error("Completed Runtime output contains an invalid value.")
  const entries = Object.entries(value)
  budget.entries += entries.length
  assertStructuredRuntimeEntryBudget(budget)
  for (const [key, item] of entries) {
    if (["__proto__", "prototype", "constructor"].includes(key)) {
      throw new Error("Completed Runtime output contains an unsafe object key.")
    }
    if (Buffer.byteLength(key, "utf8") > 512) {
      throw new Error("Completed Runtime output contains an oversized object key.")
    }
    visitStructuredRuntimeValue(item, depth + 1, budget)
  }
}

function assertStructuredRuntimeEntryBudget(budget: { entries: number }): void {
  if (budget.entries > MAX_AGENT_ACTIVITY_METADATA_ENTRIES) {
    throw new Error("Completed Runtime output exceeds its entry bound.")
  }
}

function freezeStructuredRuntimeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const item of value) freezeStructuredRuntimeValue(item)
    return Object.freeze(value)
  }
  if (isPlainRecord(value)) {
    for (const item of Object.values(value)) freezeStructuredRuntimeValue(item)
    return Object.freeze(value)
  }
  return value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function codexPermissionProfileApproval(
  request: Record<string, unknown>,
  allowed: boolean,
): { permissions: Record<string, unknown>; scope: "turn"; strictAutoReview: true } {
  const params = isPlainRecord(request.params) ? request.params : request
  const requested = isPlainRecord(params.permissions) ? params.permissions : {}
  const permissions: Record<string, unknown> = {}
  if (allowed) {
    for (const key of ["network", "fileSystem"] as const) {
      if (requested[key] !== null && requested[key] !== undefined) {
        permissions[key] = requested[key]
      }
    }
  }
  return { permissions, scope: "turn", strictAutoReview: true }
}

function permissionRequestQuestion(toolName: string, request: Record<string, unknown>): string {
  const params = isPlainRecord(request.params) ? request.params : request
  const toolInput = isPlainRecord(request.toolInput) ? request.toolInput : {}
  const detail = firstPermissionDetail(params, toolInput)
  return detail
    ? `Allow ${toolName} for this run?\n\n${detail.slice(0, 1_000)}`
    : `Allow ${toolName} for this run?`
}

function firstPermissionDetail(
  params: Record<string, unknown>,
  toolInput: Record<string, unknown>,
): string {
  const command = typeof params.command === "string" ? params.command : toolInput.command
  if (typeof command === "string" && command.trim()) return `Command: ${command.trim()}`
  for (const [label, value] of [
    ["Path", toolInput.file_path],
    ["Path", toolInput.notebook_path],
    ["Write root", params.grantRoot],
    ["Working directory", params.cwd],
    ["Reason", params.reason],
  ] as const) {
    if (typeof value === "string" && value.trim()) return `${label}: ${value.trim()}`
  }
  if (isPlainRecord(params.permissions)) {
    const requestedPermissions = params.permissions
    const requested = ["network", "fileSystem"].filter((key) => requestedPermissions[key] != null)
    if (requested.length > 0) return `Requested: ${requested.join(", ")}`
  }
  return ""
}

async function* claudeQuery(input: ClaudeRuntimeQueryInput) {
  const { query } = await import("@anthropic-ai/claude-agent-sdk")
  const stream = query({
    prompt: input.prompt as Parameters<typeof query>[0]["prompt"],
    options: input.options as Parameters<typeof query>[0]["options"],
  })
  yield* stream
}

async function resolveBundledClaudePath(): Promise<string> {
  const { getBundledClaudeBinaryPath } = await import("./claude")
  return getBundledClaudeBinaryPath()
}

function codexPermissionOptions(mode: ResolvedRuntimeLaunch["permission"]["mode"]): {
  approvalPolicy: "never" | "on-request"
  sandbox: "read-only" | "workspace-write" | "danger-full-access"
} {
  if (mode === "read-only") return { approvalPolicy: "never", sandbox: "read-only" }
  if (mode === "full-access") {
    return { approvalPolicy: "never", sandbox: "danger-full-access" }
  }
  if (mode === "auto-edit-project-only") {
    return { approvalPolicy: "never", sandbox: "workspace-write" }
  }
  if (mode === "custom") return { approvalPolicy: "on-request", sandbox: "read-only" }
  return { approvalPolicy: "on-request", sandbox: "workspace-write" }
}

function claudePermissionOptions(mode: ResolvedRuntimeLaunch["permission"]["mode"]): {
  permissionMode: "plan" | "default" | "acceptEdits" | "bypassPermissions"
  allowDangerouslySkipPermissions?: true
} {
  if (mode === "read-only") return { permissionMode: "plan" }
  if (mode === "full-access") {
    return { permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true }
  }
  if (mode === "auto-edit-project-only") return { permissionMode: "acceptEdits" }
  if (mode === "custom") return { permissionMode: "plan" }
  return { permissionMode: "default" }
}
