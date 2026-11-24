import { execFile } from "node:child_process"
import { app } from "electron"
import { CodexFileChangeApprovals } from "./file-change-approval"
import { CodexReadinessConnection } from "./readiness"
import { promisify } from "node:util"
import type { AgentActivityAppend } from "../../../../shared/agent-activity"
import {
  REASONING_EFFORTS,
  resolveCodexReasoningEffort,
  type LiveCodexModel,
  type CodexReasoningLevel,
} from "../../../../shared/model-catalog"
import type {
  HarnessAdapter,
  HarnessAdapterFactory,
  RuntimeAdapterContext,
  RuntimeAdapterProbe,
  RuntimeAdapterSession,
  RuntimeAdapterTurn,
  RuntimeBlockReason,
  RuntimeCapabilitySnapshot,
} from "../../../../shared/agent-runtime"
import {
  CODEX_RUNTIME_ADAPTER_VERSION,
  PINNED_CODEX_APP_SERVER_VERSION,
  resolveCodexRuntimeCommand,
} from "./binary"
import { coalesceReasoningDeltas } from "./reasoning-stream"
import { CodexProtocolDriftError, mapCodexNotification, permissionActivity } from "./events"
import {
  spawnCodexProtocolClient,
  type CodexProtocolClient,
  type CodexProtocolNotification,
  type CodexProtocolServerRequest,
} from "./protocol-client"
import { sanitizeRuntimeText } from "../sanitizer"
import { AGENT_INPUT_TIMEOUT_MS } from "../../../../shared/agent-input"
import type { CodexThreadVisibility } from "../../../../shared/codex-thread-visibility"

const execFileAsync = promisify(execFile)
const PERMISSION_TIMEOUT_MS = AGENT_INPUT_TIMEOUT_MS
const MAX_MODEL_PAGES = 10

type CodexReasoningSummary = "auto" | "concise" | "detailed" | "none"

function parseReasoningSummary(value: unknown): CodexReasoningSummary | undefined {
  if (value === "auto" || value === "concise" || value === "detailed" || value === "none")
    return value
}

type ClientPurpose = { cwd?: string; env?: NodeJS.ProcessEnv }

type CodexRunState = {
  effort: string | null
  summary: CodexReasoningSummary
  autoCompactThreshold?: number
  context: RuntimeAdapterContext
  client: CodexProtocolClient
  threadId: string | null
  sessionId: string | null
  turnId: string | null
  terminal: boolean
  terminalFailure: string | null
  uncertain: boolean
  streaming: boolean
  abortListener: (() => void) | null
  cancellationPromise: Promise<void> | null
  cancelled: boolean
  archived: boolean
  recoveredPromptPrefix?: string
  fileChangeApprovals: CodexFileChangeApprovals
  acceptedTurnSettings?: AgentActivityAppend
  pendingNotifications: CodexProtocolNotification[]
}

type CodexRuntimeAdapterOptions = {
  appendActivity: (runId: string, events: AgentActivityAppend[]) => Promise<void> | void
  resolveThreadParams: (
    context: RuntimeAdapterContext,
    operation: "start" | "resume" | "fork",
  ) => Promise<Record<string, unknown>> | Record<string, unknown>
  resolveTurnInput?: (
    context: RuntimeAdapterContext,
    prompt: string,
  ) => Promise<unknown[]> | unknown[]
  resolveThreadVisibility?: (
    context: RuntimeAdapterContext,
  ) => Promise<CodexThreadVisibility> | CodexThreadVisibility
  resolvePersistedSession?: (
    context: RuntimeAdapterContext,
  ) => Promise<RuntimeAdapterSession | null> | RuntimeAdapterSession | null
  resolvePersistedTurn?: (
    context: RuntimeAdapterContext,
  ) => Promise<RuntimeAdapterTurn | null> | RuntimeAdapterTurn | null
  cancelledFirstThreadContext?: (context: RuntimeAdapterContext, threadId: string) => string | null
  requestPermission?: (
    context: RuntimeAdapterContext,
    request: CodexProtocolServerRequest & { fileChangeScope?: string },
  ) => Promise<unknown>
  requestInput?: (
    context: RuntimeAdapterContext,
    request: CodexProtocolServerRequest,
  ) => Promise<unknown>
  onUsage?: (context: RuntimeAdapterContext, event: AgentActivityAppend) => Promise<void> | void
  onDiagnostic?: (context: RuntimeAdapterContext | null, message: string) => void
  resolveCommand?: () => Promise<string> | string
  getBinaryVersion?: (command: string) => Promise<string>
  createClient?: (purpose: ClientPurpose) => Promise<CodexProtocolClient> | CodexProtocolClient
  now?: () => Date
  permissionTimeoutMs?: number
}

interface CodexRuntimeHarnessAdapter extends HarnessAdapter<AgentActivityAppend> {
  forkSession(
    context: RuntimeAdapterContext,
    parent: RuntimeAdapterSession,
    lastTurnId?: string | null,
  ): Promise<RuntimeAdapterSession>
  archiveSession(context: RuntimeAdapterContext, session: RuntimeAdapterSession): Promise<void>
}

export function createCodexRuntimeAdapterFactory(
  options: CodexRuntimeAdapterOptions,
): HarnessAdapterFactory<AgentActivityAppend> {
  return () => new DirectCodexRuntimeAdapter(options)
}

class DirectCodexRuntimeAdapter implements CodexRuntimeHarnessAdapter {
  readonly runtime = "codex" as const
  readonly preparesSessionBeforeWorkspace = true
  private readonly states = new Map<string, CodexRunState>()
  private readonly connections = new Map<string, Promise<CodexProtocolClient>>()

  private readonly readiness?: CodexReadinessConnection
  constructor(private readonly options: CodexRuntimeAdapterOptions) {
    if (!options.createClient && !options.getBinaryVersion) {
      this.readiness = new CodexReadinessConnection()
      app?.once?.("will-quit", () => this.readiness?.dispose())
    }
  }

  prepareConnection(runId: string) {
    // The client has no workspace, thread, permissions or prompt until startSession.
    const connection = this.openConnection()
    this.connections.set(runId, connection)
    void connection.catch(() => undefined) // createState receives the original failure on dispatch.
    return async () => {
      if (this.connections.get(runId) !== connection) return
      this.connections.delete(runId)
      const unused = await connection.catch(() => null)
      await this.closeForProbe(unused)
    }
  }

  async probe(harness: string): Promise<RuntimeAdapterProbe> {
    if (harness !== "codex")
      return unavailableProbe(
        harness,
        "runtime-incompatible",
        "Codex Runtime requires the Codex harness.",
      )
    return this.readiness
      ? this.readiness.serialize(() => this.probeOnce(harness))
      : this.probeOnce(harness)
  }

  private async probeOnce(harness: string): Promise<RuntimeAdapterProbe> {
    let client: CodexProtocolClient | null = null
    let reused = false
    try {
      const command = await this.resolveCommand()
      const lease = await this.readiness?.take(command)
      client = lease?.client ?? null
      reused = !!client
      const version = client
        ? PINNED_CODEX_APP_SERVER_VERSION
        : await (this.options.getBinaryVersion ?? readCodexVersion)(command)
      if (version !== PINNED_CODEX_APP_SERVER_VERSION) {
        return unavailableProbe(
          harness,
          "protocol-unsupported",
          `Codex ${version} is installed; direct Runtime is pinned to ${PINNED_CODEX_APP_SERVER_VERSION}.`,
        )
      }
      if (!client) {
        client = await this.createClient({ cwd: process.cwd() }, command)
        await initialize(client)
      }
      const account = record(await client.request("account/read", { refreshToken: false }))
      if (!account.account) {
        if (reused) return await this.probeOnce(harness)
        return unavailableProbe(
          harness,
          "runtime-unavailable",
          account.requiresOpenaiAuth === true
            ? "Codex account authentication is required."
            : "Codex App Server returned no active account.",
        )
      }
      const models = await discoverModels(client)
      if (models.length === 0) {
        if (reused) return await this.probeOnce(harness)
        return unavailableProbe(
          harness,
          "runtime-unavailable",
          "Codex App Server returned no available models.",
        )
      }
      if (lease && this.readiness) {
        if (await this.readiness.keep(lease, client, account.account)) client = null
        else if (reused) return await this.probeOnce(harness)
      }
      return {
        runtime: "codex",
        harness,
        available: true,
        codexModels: models,
        versions: versions(),
        capabilities: capabilities(this.now()),
        reason: null,
      }
    } catch (error) {
      if (reused) return await this.probeOnce(harness)
      return unavailableProbe(
        harness,
        "runtime-unavailable",
        `Codex App Server probe failed: ${safeMessage(error)}${client?.diagnostics() ? ` (${client.diagnostics()})` : ""}`,
      )
    } finally {
      await this.closeForProbe(client)
    }
  }

  async startSession(context: RuntimeAdapterContext): Promise<RuntimeAdapterSession> {
    this.assertContext(context)
    const { state, params } = await this.prepareThread(context, "start")
    try {
      return await this.startNewThread(context, state, params)
    } catch (error) {
      await this.failState(state, error)
      throw error
    }
  }

  async resumeSession(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
  ): Promise<RuntimeAdapterSession> {
    this.assertContext(context)
    const threadId = requiredThreadId(session, "resume")
    const { state, params: threadParams } = await this.prepareThread(context, "resume")
    try {
      const params = withServiceTier(threadParams, context.launch.controls.serviceTier)
      let response: Record<string, unknown>
      try {
        response = record(
          await state.client.request("thread/resume", { ...params, threadId, excludeTurns: true }),
        )
      } catch (resumeError) {
        if (
          resumeError instanceof Error &&
          resumeError.message ===
            `[codex-runtime] thread/resume failed: no rollout found for thread id ${threadId}`
        ) {
          const prefix = this.options.cancelledFirstThreadContext?.(context, threadId)
          if (prefix == null || context.signal.aborted) throw resumeError
          state.recoveredPromptPrefix = prefix
          return await this.startNewThread(context, state, threadParams)
        }
        if (
          !(resumeError instanceof Error) ||
          !resumeError.message.includes(`session ${threadId} is archived.`)
        ) {
          throw resumeError
        }
        try {
          // Restoring the persisted rollout can outlast ordinary protocol requests.
          await state.client.request("thread/unarchive", { threadId }, 60_000)
        } catch (restoreError) {
          throw new Error(
            `${String(restoreError)} (initial resume rejection: ${resumeError.message})`,
            { cause: restoreError },
          )
        }
        response = record(
          await state.client.request("thread/resume", { ...params, threadId, excludeTurns: true }),
        )
      }
      this.captureThread(state, response, "thread/resume")
      return sessionFromState(state)
    } catch (error) {
      await this.failState(state, error)
      throw error
    }
  }

  async forkSession(
    context: RuntimeAdapterContext,
    parent: RuntimeAdapterSession,
    lastTurnId?: string | null,
  ): Promise<RuntimeAdapterSession> {
    this.assertContext(context)
    const threadId = requiredThreadId(parent, "fork")
    const { state, params } = await this.prepareThread(context, "fork")
    try {
      const response = record(
        await state.client.request("thread/fork", {
          ...params,
          threadId,
          excludeTurns: true,
          ...(lastTurnId ? { lastTurnId } : {}),
        }),
      )
      this.captureThread(state, response, "thread/fork")
      return sessionFromState(state)
    } catch (error) {
      await this.failState(state, error)
      throw error
    }
  }

  async archiveSession(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
  ): Promise<void> {
    const state = this.requiredState(context.runId)
    const threadId = requiredThreadId(session, "archive")
    await state.client.request("thread/archive", { threadId })
  }

  async startTurn(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
    prompt: string,
  ): Promise<RuntimeAdapterTurn> {
    const state = this.requiredState(context.runId)
    if (state.uncertain || state.turnId) {
      throw new Error(
        "[codex-runtime] Refusing to start a turn while prior intent is active or uncertain.",
      )
    }
    const threadId = requiredThreadId(session, "start turn")
    const goalObjective = parseGoalObjective(prompt)
    let dispatched = false
    try {
      dispatched = true
      if (goalObjective) {
        await state.client.request("thread/goal/set", {
          threadId,
          objective: goalObjective,
          status: "active",
        })
        state.turnId = await this.waitForGoalTurn(state)
      } else {
        const turnPrompt = state.recoveredPromptPrefix
          ? state.recoveredPromptPrefix + prompt
          : prompt
        state.recoveredPromptPrefix = undefined
        const input = this.options.resolveTurnInput
          ? await this.options.resolveTurnInput(context, turnPrompt)
          : [{ type: "text", text: turnPrompt, text_elements: [] }]
        if (!Array.isArray(input) || input.length === 0) {
          throw new Error("[codex-runtime] Flapstack launch authority returned no turn input.")
        }
        const settings = {
          model: context.launch.model,
          effort: state.effort,
          summary: state.summary,
        }
        const response = record(
          await state.client.request("turn/start", {
            threadId,
            clientUserMessageId: context.runId,
            input,
            ...settings,
            ...(context.outputSchema ? { outputSchema: context.outputSchema } : {}),
            ...(context.launch.controls.serviceTier
              ? { serviceTier: context.launch.controls.serviceTier }
              : {}),
          }),
        )
        const turn = record(response.turn)
        state.turnId = requiredString(turn.id, "turn/start did not return turn.id")
        // Keep only these public request fields. Never copy the input, instructions or response.
        state.acceptedTurnSettings = {
          provider: "flapstack",
          providerThreadId: threadId,
          providerTurnId: state.turnId,
          kind: "opaque-metadata",
          displayClass: "metadata",
          privacyClass: "public",
          phase: "snapshot",
          payload: { eventType: "turn/start.settings-sent", metadata: settings },
        }
      }
    } catch (error) {
      if (dispatched) state.uncertain = true
      throw error
    }
    state.terminal = false
    state.terminalFailure = null
    state.abortListener = () => void this.cancel(context, "Flapstack run aborted")
    context.signal.addEventListener("abort", state.abortListener, { once: true })
    if (context.signal.aborted) state.abortListener()
    return { providerTurnId: state.turnId }
  }

  async *streamActivity(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
    turn: RuntimeAdapterTurn,
  ): AsyncIterable<AgentActivityAppend> {
    const state = this.requiredState(context.runId)
    if (state.streaming) throw new Error("[codex-runtime] Activity stream already has a consumer.")
    if (
      requiredThreadId(session, "stream") !== state.threadId ||
      turn.providerTurnId !== state.turnId
    ) {
      throw new Error("[codex-runtime] Activity stream identity does not match the active turn.")
    }
    state.streaming = true
    try {
      for await (const notification of coalesceReasoningDeltas(notificationsForState(state))) {
        state.fileChangeApprovals.observe(notification)
        const events = mapCodexNotification(notification).map((event): AgentActivityAppend => {
          if (event.kind !== "usage" || state.autoCompactThreshold === undefined) return event
          const payload = { ...event.payload, autoCompactThreshold: state.autoCompactThreshold }
          return { ...event, payload }
        })
        if (state.acceptedTurnSettings) {
          events.unshift(state.acceptedTurnSettings)
          delete state.acceptedTurnSettings
        }
        await this.append(context, events)
        for (const event of events) yield event
        if (
          notification.method === "turn/completed" &&
          notificationTurnId(notification.params) === state.turnId
        ) {
          const turn = record(notification.params.turn)
          state.terminal = true
          state.turnId = null
          if (turn.status === "failed" || turn.status === "interrupted") {
            state.terminalFailure =
              turn.status === "failed"
                ? codexTurnFailureMessage(turn.error)
                : "[codex-runtime] Codex turn was interrupted."
            throw new Error(state.terminalFailure)
          }
          return
        }
      }
      if (!state.terminal) {
        state.uncertain = true
        throw new Error("[codex-runtime] App Server activity ended before turn completion.")
      }
    } catch (error) {
      state.uncertain = !state.terminal
      if (error instanceof CodexProtocolDriftError) await state.client.close()
      throw error
    } finally {
      state.streaming = false
    }
  }

  async requestPermission(context: RuntimeAdapterContext, request: unknown): Promise<unknown> {
    const value = isServerRequest(request)
      ? request
      : { id: "direct", method: "item/permissions/requestApproval", params: record(request) }
    return await this.handleServerRequest(context, value)
  }

  async requestInput(context: RuntimeAdapterContext, request: unknown): Promise<unknown> {
    const value = isServerRequest(request)
      ? request
      : { id: "direct", method: "mcpServer/elicitation/request", params: record(request) }
    const cancelled =
      value.method === "item/tool/requestUserInput" ? { answers: {} } : cancelInput()
    if (!this.options.requestInput) return cancelled
    return await withTimeout(
      this.options.requestInput(context, value),
      this.options.permissionTimeoutMs ?? PERMISSION_TIMEOUT_MS,
      cancelled,
      context.signal,
    )
  }

  async steer(context: RuntimeAdapterContext, text: string): Promise<void> {
    const state = this.states.get(context.runId)
    if (!state?.threadId || !state.turnId || state.cancelled || state.terminal || state.uncertain)
      throw new Error("This Codex turn is no longer accepting steering.")
    const turnId = state.turnId
    const reply = record(
      await state.client.request("turn/steer", {
        threadId: state.threadId,
        expectedTurnId: turnId,
        input: [{ type: "text", text, text_elements: [] }],
      }),
    )
    if (reply.turnId !== turnId) throw new Error("Codex did not confirm steering the active turn.")
  }

  async cancel(context: RuntimeAdapterContext, _reason: string): Promise<void> {
    const state = this.states.get(context.runId)
    if (!state) return await this.cancelPersisted(context)
    if (!state.threadId || !state.turnId || state.terminal || state.cancelled) {
      await state.cancellationPromise
      return
    }
    if (state.cancellationPromise) return await state.cancellationPromise
    state.cancelled = true
    state.cancellationPromise = (async () => {
      try {
        await state.client.request("turn/interrupt", {
          threadId: state.threadId,
          turnId: state.turnId,
        })
      } catch (error) {
        state.uncertain = true
        throw error
      }
    })()
    return await state.cancellationPromise
  }

  private async cancelPersisted(context: RuntimeAdapterContext): Promise<void> {
    const session = await this.options.resolvePersistedSession?.(context)
    const turn = await this.options.resolvePersistedTurn?.(context)
    const threadId = requiredThreadId(
      session ?? { providerSessionId: null, providerThreadId: null },
      "cancel persisted turn",
    )
    const turnId = requiredString(turn?.providerTurnId, "Cannot cancel without providerTurnId")
    const threadParams = await this.options.resolveThreadParams(context, "resume")
    const client = await this.createClient({
      cwd: typeof threadParams.cwd === "string" ? threadParams.cwd : process.cwd(),
    })
    try {
      await initialize(client)
      await client.request("turn/interrupt", { threadId, turnId })
    } finally {
      await this.closeForReconciliation(client, context)
    }
  }

  async complete(context: RuntimeAdapterContext): Promise<void> {
    const state = this.requiredState(context.runId)
    if (state.terminalFailure) throw new Error(state.terminalFailure)
    if (!state.terminal || state.uncertain) {
      throw new Error("[codex-runtime] Cannot complete before a certain terminal turn event.")
    }
    await this.archiveHiddenThread(state)
  }

  async reconcile(context: RuntimeAdapterContext): Promise<"running" | "completed" | "uncertain"> {
    const existing = this.states.get(context.runId)
    if (existing) {
      if (existing.uncertain) return "uncertain"
      if (existing.terminalFailure) return "uncertain"
      if (existing.terminal) return "completed"
      if (existing.client.isAlive() && existing.turnId) return "running"
    }
    const persisted = await this.options.resolvePersistedSession?.(context)
    const threadId = persisted?.providerThreadId
    const turn = await this.options.resolvePersistedTurn?.(context)
    if (!threadId || !turn?.providerTurnId) return "uncertain"
    let client: CodexProtocolClient | null = null
    try {
      client = await this.createClient({ cwd: process.cwd() })
      await initialize(client)
      const response = record(await client.request("thread/read", { threadId, includeTurns: true }))
      return reconcileThread(record(response.thread), threadId, turn.providerTurnId)
    } catch (error) {
      return "uncertain"
    } finally {
      await this.closeForReconciliation(client, context)
    }
  }

  async cleanup(context: RuntimeAdapterContext): Promise<void> {
    const state = this.states.get(context.runId)
    if (!state) return
    if (state.abortListener) context.signal.removeEventListener("abort", state.abortListener)
    this.states.delete(context.runId)
    try {
      await state.cancellationPromise?.catch(() => undefined)
      if ((state.terminal || state.cancelled) && !state.uncertain) {
        await this.archiveHiddenThread(state)
      }
    } finally {
      await state.client.close()
    }
  }

  private async openConnection(): Promise<CodexProtocolClient> {
    const command = await this.resolveCommand()
    const version = await (this.options.getBinaryVersion ?? readCodexVersion)(command)
    if (version !== PINNED_CODEX_APP_SERVER_VERSION) {
      throw new Error(
        `[codex-runtime] Refusing Codex ${version}; pinned protocol requires ${PINNED_CODEX_APP_SERVER_VERSION}.`,
      )
    }
    const client = await this.createClient({ cwd: process.cwd() }, command)
    try {
      await initialize(client)
      return client
    } catch (error) {
      await this.closeForProbe(client)
      throw error
    }
  }

  private async createState(context: RuntimeAdapterContext): Promise<CodexRunState> {
    if (this.states.has(context.runId)) {
      throw new Error(`[codex-runtime] Run ${context.runId} already owns an App Server process.`)
    }
    const connection = this.connections.get(context.runId)
    this.connections.delete(context.runId)
    const client = await (connection ?? this.openConnection())
    const state: CodexRunState = {
      effort: normalizeCodexRuntimeEffort(context.launch.controls.modelEffort),
      summary: context.launch.controls.reasoningDisplay ? "auto" : "none",
      context,
      client,
      threadId: null,
      sessionId: null,
      turnId: null,
      terminal: false,
      terminalFailure: null,
      uncertain: false,
      streaming: false,
      abortListener: null,
      cancellationPromise: null,
      cancelled: false,
      archived: false,
      fileChangeApprovals: new CodexFileChangeApprovals(),
      pendingNotifications: [],
    }
    client.setRequestHandler((request) => this.handleServerRequest(context, request))
    this.states.set(context.runId, state)
    try {
      const account = record(await client.request("account/read", { refreshToken: false }))
      if (!account.account)
        throw new Error("[codex-runtime] Codex account authentication unavailable.")
      const models = await discoverModels(client)
      const selected = context.launch.model
        ? models.find((model) => model.id === context.launch.model)
        : models.find((model) => model.isDefault)
      if (context.launch.model && !selected) {
        throw new Error(
          `[codex-runtime] Requested Codex model is unavailable: ${context.launch.model}`,
        )
      }
      const requested = context.launch.controls.modelEffort
      if (requested && selected?.reasoningLevels.length) {
        state.effort = resolveCodexReasoningEffort(
          requested,
          selected.reasoningLevels,
          selected.name,
        )
      }
      return state
    } catch (error) {
      this.states.delete(context.runId)
      await client.close()
      throw error
    }
  }

  private async prepareThread(
    context: RuntimeAdapterContext,
    operation: "start" | "resume" | "fork",
  ) {
    // Both paths verify the frozen launch. Neither starts or resumes a provider thread.
    const [connection, authority] = await Promise.allSettled([
      this.createState(context),
      Promise.resolve().then(() => this.options.resolveThreadParams(context, operation)),
    ])
    if (connection.status === "rejected") throw connection.reason
    const state = connection.value
    if (authority.status === "rejected" || context.signal.aborted) {
      const error =
        authority.status === "rejected"
          ? authority.reason
          : new Error("Codex launch was cancelled.")
      await this.failState(state, error)
      throw error
    }
    // Native thread creation/resume can run configured hooks before the first tool event.
    try {
      await context.waitForWorkspace?.()
      context.signal.throwIfAborted()
      const params = authority.value
      const config = record(params.config)
      const native = record(
        await state.client.request("config/read", { cwd: params.cwd, includeLayers: false }),
      )
      const effectiveConfig = record(native.config)
      if (context.launch.controls.reasoningDisplay) {
        state.summary =
          parseReasoningSummary(
            config.model_reasoning_summary ?? effectiveConfig.model_reasoning_summary,
          ) ?? "auto"
      }
      const threshold =
        config.model_auto_compact_token_limit ?? effectiveConfig.model_auto_compact_token_limit
      if (typeof threshold === "number" && Number.isSafeInteger(threshold) && threshold > 0)
        state.autoCompactThreshold = threshold
      return {
        state,
        params: {
          ...params,
          config: {
            ...config,
            features: { ...record(config.features), concurrent_reasoning_summaries: true },
            model_reasoning_summary: state.summary,
          },
        },
      }
    } catch (error) {
      await this.failState(state, error)
      throw error
    }
  }

  private async startNewThread(
    context: RuntimeAdapterContext,
    state: CodexRunState,
    resolvedParams?: Record<string, unknown>,
  ): Promise<RuntimeAdapterSession> {
    const params = withServiceTier(
      resolvedParams ?? (await this.options.resolveThreadParams(context, "start")),
      context.launch.controls.serviceTier,
    )
    const response = record(await state.client.request("thread/start", params))
    this.captureThread(state, response, "thread/start")
    return sessionFromState(state)
  }

  private captureThread(
    state: CodexRunState,
    response: Record<string, unknown>,
    method: string,
  ): void {
    const thread = record(response.thread)
    state.threadId = requiredString(thread.id, `${method} did not return thread.id`)
    state.sessionId = string(thread.sessionId) ?? state.threadId
  }

  private async handleServerRequest(
    context: RuntimeAdapterContext,
    request: CodexProtocolServerRequest,
  ): Promise<unknown> {
    if (
      request.method === "mcpServer/elicitation/request" ||
      request.method === "item/tool/requestUserInput"
    ) {
      return await this.requestInput(context, request)
    }
    if (!isPermissionMethod(request.method)) {
      const state = this.states.get(context.runId)
      if (state) {
        state.uncertain = true
        await state.client.close()
      }
      throw new Error(`[codex-runtime] Unknown server request fails closed: ${request.method}`)
    }
    const activityParams = { ...request.params, eventId: String(request.id) }
    await this.append(context, [permissionActivity(request.method, activityParams, "started")])
    const fallback = denyPermission(request.method)
    try {
      const state = this.states.get(context.runId)
      const fileChangeScope =
        this.options.requestPermission &&
        request.method === "item/fileChange/requestApproval" &&
        state &&
        state.threadId === request.params.threadId &&
        (!state.turnId || state.turnId === request.params.turnId)
          ? await state.fileChangeApprovals.matching(request.params, context.signal)
          : undefined
      const response = this.options.requestPermission
        ? await withTimeout(
            this.options.requestPermission(
              context,
              fileChangeScope ? { ...request, fileChangeScope } : request,
            ),
            this.options.permissionTimeoutMs ?? PERMISSION_TIMEOUT_MS,
            fallback,
            context.signal,
          )
        : fallback
      const validated = validatePermissionResponse(request.method, response)
      await this.append(context, [
        permissionActivity(request.method, activityParams, "completed", decisionLabel(validated)),
      ])
      return validated
    } catch (error) {
      await this.append(context, [
        permissionActivity(request.method, activityParams, "failed", "cancel"),
      ])
      return fallback
    }
  }

  private async append(
    context: RuntimeAdapterContext,
    events: AgentActivityAppend[],
  ): Promise<void> {
    if (events.length === 0) return
    await this.options.appendActivity(context.runId, events)
    for (const event of events) {
      if (event.kind === "usage") await this.options.onUsage?.(context, event)
    }
  }

  private async waitForGoalTurn(state: CodexRunState): Promise<string> {
    for await (const notification of state.client.notifications()) {
      state.pendingNotifications.push(notification)
      const turnId = notificationTurnId(notification.params)
      if (turnId) return turnId
    }
    throw new Error("[codex-runtime] Goal started without a provider turn.")
  }

  private requiredState(runId: string): CodexRunState {
    const state = this.states.get(runId)
    if (!state) throw new Error(`[codex-runtime] No App Server process owns run ${runId}.`)
    return state
  }

  private async failState(state: CodexRunState, error: unknown): Promise<void> {
    state.uncertain = true
    this.options.onDiagnostic?.(state.context, safeMessage(error))
    this.states.delete(state.context.runId)
    await state.client.close()
  }

  private assertContext(context: RuntimeAdapterContext): void {
    if (context.launch.harness !== "codex" || context.launch.resolvedRuntime !== "codex") {
      throw new Error("[codex-runtime] Launch snapshot is not a resolved Codex Runtime.")
    }
  }

  private async archiveHiddenThread(state: CodexRunState): Promise<void> {
    if (state.archived || !state.threadId) return
    const visibility = (await this.options.resolveThreadVisibility?.(state.context)) ?? "project"
    if (visibility !== "hidden") return
    try {
      await state.client.request("thread/archive", { threadId: state.threadId })
      state.archived = true
    } catch (error) {
      this.options.onDiagnostic?.(
        state.context,
        `Could not hide completed Codex task: ${safeMessage(error)}`,
      )
    }
  }

  private async resolveCommand(): Promise<string> {
    return await (this.options.resolveCommand?.() ?? resolveCodexRuntimeCommand())
  }

  private async createClient(
    purpose: ClientPurpose,
    command?: string,
  ): Promise<CodexProtocolClient> {
    if (this.options.createClient) return await this.options.createClient(purpose)
    return spawnCodexProtocolClient({
      command: command ?? (await this.resolveCommand()),
      cwd: purpose.cwd,
      env: purpose.env,
    })
  }

  private async closeForProbe(client: CodexProtocolClient | null): Promise<void> {
    if (!client) return
    try {
      await client.close()
    } catch (error) {
      try {
        this.options.onDiagnostic?.(null, `Probe cleanup failed: ${boundedMessage(error)}`)
      } catch {
        // Cleanup diagnostics must never replace the typed probe result.
      }
    }
  }

  private async closeForReconciliation(
    client: CodexProtocolClient | null,
    context: RuntimeAdapterContext,
  ): Promise<void> {
    if (!client) return
    try {
      await client.close()
    } catch (error) {
      try {
        this.options.onDiagnostic?.(
          context,
          `Restart reconciliation cleanup failed: ${boundedMessage(error)}`,
        )
      } catch {
        // Cleanup diagnostics must never replace the reconciliation result.
      }
    }
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))()
  }
}

function normalizeCodexRuntimeEffort(effort: string | null): string | null {
  if (effort === "minimal") return "low"
  if (effort === "ultra") return "max"
  return effort
}

function withServiceTier(
  params: Record<string, unknown>,
  serviceTier: string | null | undefined,
): Record<string, unknown> {
  return serviceTier ? { ...params, serviceTier } : params
}

async function initialize(client: CodexProtocolClient): Promise<void> {
  await client.request("initialize", {
    clientInfo: { name: "flapstack", title: "Flapstack", version: CODEX_RUNTIME_ADAPTER_VERSION },
    capabilities: { experimentalApi: true },
  })
}

async function discoverModels(client: CodexProtocolClient): Promise<LiveCodexModel[]> {
  const models = new Map<string, LiveCodexModel>()
  const cursors = new Set<string>()
  let cursor: string | null = null
  for (let page = 0; page < MAX_MODEL_PAGES; page += 1) {
    const response = record(
      await client.request("model/list", { cursor, limit: 100, includeHidden: false }),
    )
    for (const rawModel of array(response.data)) {
      const model = record(rawModel)
      const id = string(model.model) ?? string(model.id)
      if (!id || model.hidden === true) continue
      const reasoningLevels = array(model.supportedReasoningEfforts)
        .map((entry) => string(record(entry).reasoningEffort))
        .filter((level): level is CodexReasoningLevel =>
          Boolean(REASONING_EFFORTS.some((effort) => effort === level)),
        )
      models.set(id, {
        id,
        name: string(model.displayName) ?? id,
        reasoningLevels,
        ...(model.isDefault === true && { isDefault: true }),
      })
    }
    const nextCursor = string(response.nextCursor)
    if (!nextCursor) return [...models.values()]
    if (cursors.has(nextCursor)) {
      throw new Error(`[codex-runtime] model/list repeated cursor ${nextCursor}.`)
    }
    cursors.add(nextCursor)
    cursor = nextCursor
  }
  throw new Error(
    `[codex-runtime] model/list exceeded ${MAX_MODEL_PAGES} pages with another cursor.`,
  )
}

async function readCodexVersion(command: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(command, ["--version"], {
    timeout: 10_000,
    windowsHide: true,
  })
  const match = `${stdout} ${stderr}`.match(
    /\bcodex(?:-cli)?\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=\s|$)/i,
  )
  if (!match) throw new Error("Unable to parse Codex binary version.")
  return match[1]
}

function unavailableProbe(
  harness: string,
  code: RuntimeBlockReason["code"],
  message: string,
): RuntimeAdapterProbe {
  const reason: RuntimeBlockReason = {
    code,
    message,
    harness,
    runtime: "codex",
    repair:
      "Install/authenticate the pinned Codex App Server or explicitly choose Flapstack Native.",
  }
  return {
    runtime: "codex",
    harness,
    available: false,
    versions: versions(),
    capabilities: {
      ...capabilities(new Date()),
      status: "unavailable",
      unavailableReason: reason,
      limitations: [message],
    },
    reason,
  }
}

function capabilities(now: Date): RuntimeCapabilitySnapshot {
  return {
    schemaVersion: 1,
    status: "available",
    capturedAt: now.toISOString(),
    controls: {
      modelThinking: { supported: true, reason: null },
      reasoningDisplay: { supported: true, reason: null },
      subagentActivity: { supported: true, reason: null },
      hookDiagnostics: { supported: true, reason: null },
    },
    execution: {
      continuation: { supported: true, reason: null },
      delegation: { supported: true, reason: null },
      structuredOutput: { supported: true, reason: null },
      cancellation: { supported: true, reason: null },
    },
    limitations: [
      "Private or encrypted reasoning is metadata-only.",
      "Protocol execution is blocked when the installed Codex version differs from the pin.",
    ],
    unavailableReason: null,
  }
}

function versions() {
  return {
    adapterVersion: CODEX_RUNTIME_ADAPTER_VERSION,
    protocolVersion: PINNED_CODEX_APP_SERVER_VERSION,
  }
}

function requiredThreadId(session: RuntimeAdapterSession, operation: string): string {
  return requiredString(session.providerThreadId, `Cannot ${operation} without providerThreadId`)
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`[codex-runtime] ${message}.`)
  return value
}

function sessionFromState(state: CodexRunState): RuntimeAdapterSession {
  return { providerSessionId: state.sessionId, providerThreadId: state.threadId }
}

function reconcileThread(
  thread: Record<string, unknown>,
  threadId: string,
  turnId: string,
): "running" | "completed" | "uncertain" {
  if (thread.id !== threadId) return "uncertain"
  const status = record(thread.status)
  if (status.type === "systemError") return "uncertain"
  const turns = array(thread.turns)
    .map(record)
    .filter((turn) => turn.id === turnId)
  if (turns.length !== 1) return "uncertain"
  if (turns[0].status === "completed") return "completed"
  if (status.type !== "notLoaded" && turns[0].status === "inProgress") return "running"
  return "uncertain"
}

function notificationTurnId(params: Record<string, unknown>): string | null {
  return string(params.turnId) ?? string(record(params.turn).id)
}

function parseGoalObjective(prompt: string): string | null {
  const match = prompt.trim().match(/^\/goal\s+([\s\S]+)$/i)
  if (!match) return null
  const objective = match[1]?.trim() ?? ""
  if (!objective || objective.length > 4_000) {
    throw new Error("[codex-runtime] Goal text must contain 1 to 4,000 characters.")
  }
  return objective
}

async function* notificationsForState(
  state: CodexRunState,
): AsyncIterable<CodexProtocolNotification> {
  yield* state.pendingNotifications.splice(0)
  yield* state.client.notifications()
}

function codexTurnFailureMessage(value: unknown): string {
  const error = record(value)
  const detail =
    string(error.message) ??
    string(error.code) ??
    string(error.type) ??
    string(value) ??
    "App Server turn failed."
  return `[codex-runtime] ${sanitizeRuntimeText(detail, {
    maxLength: 500,
    mode: "diagnostic",
  })}`
}

function isPermissionMethod(method: string): boolean {
  return (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval" ||
    method === "item/permissions/requestApproval"
  )
}

function denyPermission(method: string): unknown {
  if (method === "item/permissions/requestApproval") {
    return { permissions: {}, scope: "turn", strictAutoReview: true }
  }
  return { decision: "decline" }
}

function validatePermissionResponse(method: string, value: unknown): unknown {
  const response = record(value)
  if (method === "item/permissions/requestApproval") {
    if (!isRecord(response.permissions) || !["turn", "session"].includes(String(response.scope))) {
      throw new Error("Invalid Codex permission-profile approval response.")
    }
    return response
  }
  const decision = response.decision
  const amendment = record(decision)
  const validAmendment =
    (isRecord(amendment.acceptWithExecpolicyAmendment) &&
      Array.isArray(record(amendment.acceptWithExecpolicyAmendment).execpolicy_amendment) &&
      (record(amendment.acceptWithExecpolicyAmendment).execpolicy_amendment as unknown[]).length >
        0 &&
      (record(amendment.acceptWithExecpolicyAmendment).execpolicy_amendment as unknown[]).every(
        (value) => typeof value === "string",
      )) ||
    (isRecord(amendment.applyNetworkPolicyAmendment) &&
      isRecord(record(amendment.applyNetworkPolicyAmendment).network_policy_amendment))
  if (
    !["accept", "acceptForSession", "decline", "cancel"].includes(String(decision)) &&
    !validAmendment
  ) {
    throw new Error("Invalid Codex approval decision.")
  }
  return response
}

function decisionLabel(value: unknown): string {
  const response = record(value)
  if (typeof response.decision === "string") return response.decision
  if (response.permissions) return "permission-profile"
  return "bounded-amendment"
}

function cancelInput() {
  return { action: "cancel", content: null, _meta: null }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return fallback
  return await new Promise<T>((resolve) => {
    let settled = false
    const finish = (value: T) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener("abort", onAbort)
      resolve(value)
    }
    const onAbort = () => finish(fallback)
    const timeout = setTimeout(() => finish(fallback), timeoutMs)
    signal.addEventListener("abort", onAbort, { once: true })
    void promise.then(finish, () => finish(fallback))
  })
}

function isServerRequest(value: unknown): value is CodexProtocolServerRequest {
  const request = record(value)
  return (
    (typeof request.id === "string" || typeof request.id === "number") &&
    typeof request.method === "string" &&
    isRecord(request.params)
  )
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function safeMessage(error: unknown): string {
  return sanitizeRuntimeText(error instanceof Error ? error.message : String(error), {
    maxLength: 500,
    mode: "diagnostic",
  })
}

function boundedMessage(error: unknown): string {
  return safeMessage(error).slice(0, 4_096)
}
