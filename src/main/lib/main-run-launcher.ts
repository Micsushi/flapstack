import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { existsSync } from "node:fs"
import { createAppRouter } from "./trpc/routers"
import {
  loadAgentRunReconciliationState,
  loadRunningAgentRun,
  type AgentRunReconciliationState,
  type AgentRunLauncher,
  type QueuedAgentRun,
} from "./run-launch-service"
import type { AgentActivityAppend } from "../../shared/agent-activity"
import type {
  HarnessAdapterFactory,
  ResolvedRuntimeLaunch,
  RuntimeAdapterContext,
  RuntimeAdapterSession,
  RuntimeAdapterTurn,
} from "../../shared/agent-runtime"
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

const services = new Map<string, MainRuntimeLaunchService>()

/** One process-wide authority for Runtime registry, dispatch, recovery, and interaction. */
export class MainRuntimeLaunchService {
  readonly registry: AgentRuntimeRegistry<unknown>
  readonly coordinator: RuntimeLaunchCoordinator<unknown>
  private readonly caller = createAppRouter(() => null).createCaller({ getWindow: () => null })
  private readonly runs = new Map<string, QueuedAgentRun>()
  private readonly streams = new Map<string, unknown>()
  private readonly states = new Map<string, "running" | "completed" | "uncertain">()
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
    this.permissionHandler = options.permissionHandler
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
        resolveThreadParams: async (context) => {
          const authority = await this.resolveExtensionAuthority(context, "codex")
          const config = applyCodexExtensionPolicyConfig(
            buildManagedCodexHookConfig(authority.hooks),
            authority.policy,
          )
          return {
            cwd: authority.cwd,
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
    this.runs.set(run.runId, run)
    try {
      await this.coordinator.launch({
        runId: run.runId,
        chatId: run.chatId,
        subChatId: run.subChatId,
        launch: run.runtimeLaunch ?? legacyLaunch(run),
        prompt: run.prompt,
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
      this.runs.delete(run.runId)
      this.streams.delete(run.runId)
    }
  }

  async cancel(runId: string, reason: string): Promise<boolean> {
    if (this.coordinator.runState(runId)) {
      return await this.coordinator.cancel(runId, reason)
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
    if (state === "starting" || state === "running") return "running"
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
      buildQueryOptions: async (context) => {
        const authority = await this.resolveExtensionAuthority(context, "claude-code")
        const sdkOptions = getClaudeExtensionSdkOptions(authority.policy)
        const hooks = buildManagedClaudeHookOptions(authority.hooks, (record, input, signal) =>
          this.hookRuntimeExecutor.execute(record, input, signal, authority.cwd),
        )
        const mcpServers =
          authority.policy.disabledMcpNames.length > 0
            ? filterClaudeExtensionMcpServers(
                await loadClaudeMcpServers(authority.cwd),
                authority.policy,
              )
            : undefined
        return {
          cwd: authority.cwd,
          pathToClaudeCodeExecutable: await resolveBundledClaudePath(),
          includePartialMessages: true,
          settingSources: ["project", "user"],
          ...claudePermissionOptions(context.launch.permission.mode),
          ...(context.launch.model ? { model: context.launch.model } : {}),
          ...sdkOptions,
          ...(mcpServers ? { mcpServers } : {}),
          ...(Object.keys(hooks).length > 0 ? { hooks, includeHookEvents: true } : {}),
        }
      },
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
        const identity = session.providerSessionId ?? session.providerThreadId
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
        this.appendActivityWithDatabase(db, runId, [
          lifecycleActivity(lifecycle, `lifecycle:${lifecycle}`, undefined, undefined, detail),
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
          `SELECT s.session_id, a.provider_session_id, a.provider_thread_id
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
            provider_session_id: string | null
            provider_thread_id: string | null
          }
        | undefined
      if (!row) return null
      const providerSessionId =
        row.provider_session_id ?? (allowSubChatFallback ? row.session_id : null) ?? null
      const providerThreadId = row.provider_thread_id ?? null
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

  private requireRunRow(db: Database.Database, runId: string) {
    const row = db.prepare("SELECT id, sub_chat_id FROM agent_runs WHERE id = ?").get(runId) as
      { id: string; sub_chat_id: string | null } | undefined
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
  return service
}

export function resetMainRuntimeLaunchServicesForTests(): void {
  services.clear()
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
  if (!["codex", "claude-code", "cursor-agent", "openrouter", "nanogpt"].includes(harness)) {
    return null
  }
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
      if (run.harness === "codex") {
        await caller.codex.cancel({ subChatId: run.subChatId, runId: run.runId })
      } else if (run.harness === "claude-code") {
        await caller.claude.cancel({ subChatId: run.subChatId })
      } else if (run.harness === "cursor-agent") {
        await caller.cursor.cancel({ subChatId: run.subChatId, runId: run.runId })
      } else if (run.harness === "openrouter" || run.harness === "nanogpt") {
        await caller.opencode.cancel({ subChatId: run.subChatId, runId: run.runId })
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
  const stream =
    run.harness === "codex"
      ? await caller.codex.chat({
          runId: run.runId,
          chatId: run.chatId,
          subChatId: run.subChatId,
          prompt: run.prompt,
          cwd,
          ...(run.projectPath ? { projectPath: run.projectPath } : {}),
          ...(model ? { model } : {}),
          mode: "agent",
          reasoningEnabled: run.reasoningEffort !== "minimal",
          ...(run.reasoningEffort ? { reasoningEffort: run.reasoningEffort } : {}),
        })
      : run.harness === "claude-code"
        ? await caller.claude.chat({
            runId: run.runId,
            chatId: run.chatId,
            subChatId: run.subChatId,
            prompt: run.prompt,
            cwd,
            ...(run.projectPath ? { projectPath: run.projectPath } : {}),
            ...(model ? { model } : {}),
            mode: "agent",
            reasoningEnabled: run.reasoningEffort !== "minimal",
            ...(run.reasoningEffort && run.reasoningEffort !== "minimal"
              ? { effort: run.reasoningEffort }
              : {}),
          })
        : run.harness === "cursor-agent"
          ? await caller.cursor.chat({
              runId: run.runId,
              chatId: run.chatId,
              subChatId: run.subChatId,
              prompt: run.prompt,
              cwd,
              ...(run.projectPath ? { projectPath: run.projectPath } : {}),
              ...(model ? { model } : {}),
              reasoningEnabled: run.reasoningEffort !== "minimal",
            })
          : run.harness === "openrouter" || run.harness === "nanogpt"
            ? await caller.opencode.chat({
                runId: run.runId,
                chatId: run.chatId,
                subChatId: run.subChatId,
                provider: run.harness,
                model: requireModel(run),
                prompt: run.prompt,
                cwd,
                ...(run.projectPath ? { projectPath: run.projectPath } : {}),
                reasoningEnabled: run.reasoningEffort !== "minimal",
                reasoningEffort: run.reasoningEffort ?? "high",
              })
            : unsupportedHarness(run)
  return stream
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
  const effort = reasoningEffort && reasoningEffort !== "minimal" ? reasoningEffort : "low"
  const withoutEffort = normalized
    .replace(/\/(?:minimal|low|medium|high|xhigh)$/i, "")
    .replace(/\[(?:minimal|low|medium|high|xhigh)\]$/i, "")
  if (withoutEffort.includes("/")) return normalized
  return `${withoutEffort}/${effort}`
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
  dedupKey: string,
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
    dedupKey: `runtime:${dedupKey}`,
  }
}

function terminalStatus(lifecycle: string): "success" | "failure" | "cancelled" | null {
  if (lifecycle === "completed") return "success"
  if (lifecycle === "failed" || lifecycle === "uncertain") return "failure"
  if (lifecycle === "cancelled") return "cancelled"
  return null
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
