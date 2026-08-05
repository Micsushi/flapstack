import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { AgentActivityAppend } from "../../../../shared/agent-activity"
import type {
  HarnessAdapter,
  RuntimeAdapterContext,
  RuntimeAdapterSession,
  RuntimeAdapterTurn,
} from "../../../../shared/agent-runtime"
import { buildClaudeRuntimeSdkControls } from "./controls"
import {
  ClaudeRuntimeEventMapper,
  mapClaudePermissionActivity,
  sanitizeClaudeDiagnostic,
} from "./events"
import { probeClaudeCodeRuntime } from "./probe"
import {
  applyClaudeRuntimeResumeOptions,
  createRuntimeSession,
  reconcileClaudeRuntimeUncertainty,
  shouldRetryClaudeRuntimeStaleSession,
} from "./recovery"
import type {
  ClaudeRuntimeDependencies,
  ClaudeRuntimeQueryInput,
  ClaudeRuntimeResumeState,
} from "./types"
import { isMissingClaudeSessionError } from "../../claude/session-recovery"

type RunState = {
  context: RuntimeAdapterContext
  session: RuntimeAdapterSession
  resume: ClaudeRuntimeResumeState | null
  abortController: AbortController
  mapper: ClaudeRuntimeEventMapper
  prompt: string | null
  queryInput: ClaudeRuntimeQueryInput | null
  turnStarted: boolean
  terminal: boolean
  cancelled: boolean
  deliveredProviderMessages: number
  retryUsed: boolean
  streaming: boolean
  consumed: boolean
  uncertain: boolean
  abortListener: () => void
  cancellationPromise: Promise<void> | null
}

export class ClaudeRuntimeUncertainError extends Error {
  readonly code = "claude-runtime-uncertain"

  constructor(message = "Claude SDK stream ended without an authoritative result") {
    super(message)
    this.name = "ClaudeRuntimeUncertainError"
  }
}

export class ClaudeCodeRuntimeAdapter implements HarnessAdapter<AgentActivityAppend> {
  readonly runtime = "claude-code" as const
  private readonly runs = new Map<string, RunState>()

  constructor(private readonly dependencies: ClaudeRuntimeDependencies) {}

  async probe(harness: string) {
    if (harness !== "claude-code") {
      const reason = {
        code: "runtime-incompatible" as const,
        message: `Claude Code Runtime is incompatible with harness ${harness}.`,
        harness,
        runtime: "claude-code" as const,
        repair: "Select the claude-code harness or choose a compatible Runtime.",
      }
      return {
        runtime: "claude-code" as const,
        harness,
        available: false,
        versions: {
          adapterVersion: "1",
          protocolVersion: "claude-agent-sdk/0.3.207",
        },
        capabilities: {
          schemaVersion: 1 as const,
          status: "unavailable" as const,
          capturedAt: null,
          controls: {
            modelThinking: { supported: false, reason: reason.message },
            reasoningDisplay: { supported: false, reason: reason.message },
            subagentActivity: { supported: false, reason: reason.message },
            hookDiagnostics: { supported: false, reason: reason.message },
          },
          unavailableReason: reason,
          limitations: [reason.message],
        },
        reason,
      }
    }
    try {
      return probeClaudeCodeRuntime(await this.dependencies.probe())
    } catch (error) {
      return probeClaudeCodeRuntime({
        available: false,
        sdkVersion: null,
        claudeCodeVersion: null,
        features: {
          partialMessages: false,
          thinking: false,
          hooks: false,
          subagentForwarding: false,
          resume: false,
          resumeAt: false,
          fork: false,
          cancellation: false,
        },
        unavailableReason: `Claude runtime probe failed: ${safeErrorMessage(error)}`,
      })
    }
  }

  async startSession(context: RuntimeAdapterContext): Promise<RuntimeAdapterSession> {
    this.assertContext(context)
    const existing = this.runs.get(context.runId)
    if (existing) {
      throw new Error(`Claude runtime already owns run ${context.runId}`)
    }
    const resume = await this.dependencies.loadSession(context)
    const session = createRuntimeSession(context, resume)
    this.runs.set(context.runId, this.createState(context, session, resume))
    return session
  }

  async resumeSession(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
  ): Promise<RuntimeAdapterSession> {
    this.assertContext(context)
    const providerSessionId = session.providerSessionId?.trim() || null
    let current = this.runs.get(context.runId)
    if (!current) {
      const resumed = { providerSessionId, providerThreadId: null }
      current = this.createState(
        context,
        resumed,
        providerSessionId ? { sessionId: providerSessionId } : null,
      )
      this.runs.set(context.runId, current)
      return current.session
    }
    this.assertMutableBeforeDispatch(current, "resume session")
    current.session = { providerSessionId, providerThreadId: null }
    current.resume = providerSessionId
      ? current.resume?.sessionId === providerSessionId
        ? current.resume
        : { sessionId: providerSessionId }
      : null
    return current.session
  }

  async startTurn(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
    prompt: string,
  ): Promise<RuntimeAdapterTurn> {
    const state = this.requireState(context)
    this.assertMutableBeforeDispatch(state, "start turn")
    if (session.providerSessionId !== state.session.providerSessionId) {
      await this.resumeSession(context, session)
    }

    const baseOptions = await this.dependencies.buildQueryOptions(
      context,
      prompt,
      state.abortController,
    )
    const options = {
      ...baseOptions,
      abortController: state.abortController,
      ...buildClaudeRuntimeSdkControls(context.launch.controls),
      ...(context.outputSchema
        ? { outputFormat: { type: "json_schema" as const, schema: context.outputSchema } }
        : {}),
    }
    applyClaudeRuntimeResumeOptions(options, state.resume)
    const providerPrompt = this.dependencies.resolvePrompt
      ? await this.dependencies.resolvePrompt(context, prompt)
      : prompt
    state.prompt = prompt
    state.queryInput = { prompt: providerPrompt, options }
    state.turnStarted = true
    return { providerTurnId: null }
  }

  async *streamActivity(
    context: RuntimeAdapterContext,
    _session: RuntimeAdapterSession,
    _turn: RuntimeAdapterTurn,
  ): AsyncIterable<AgentActivityAppend> {
    const state = this.requireState(context)
    if (!state.turnStarted || !state.queryInput) {
      throw new Error(`Claude runtime turn has not started for ${context.runId}`)
    }

    if (state.streaming || state.consumed) {
      throw new Error(`Claude runtime stream already consumed for ${context.runId}`)
    }
    if (state.cancelled || state.terminal || state.uncertain) {
      throw new Error(`Claude runtime cannot stream terminal run ${context.runId}`)
    }
    state.streaming = true
    state.consumed = true

    try {
      while (true) {
        let retryFresh = false
        try {
          const stream = this.dependencies.query(state.queryInput)
          for await (const message of stream) {
            if (state.abortController.signal.aborted) break
            if (this.isStaleMessage(message, state)) {
              await this.clearStaleSession(state)
              retryFresh = true
              break
            }

            state.deliveredProviderMessages += 1
            await this.captureIdentity(state, message)
            const batch = state.mapper.map(message)
            await this.dependencies.appendActivity(context, batch)
            const terminal = (message as { type?: string }).type === "result"
            if (terminal) state.terminal = true
            for (const activity of batch) yield activity
            if (terminal) return
          }
          if (retryFresh) continue
          if (state.cancelled) return
          if (!state.terminal) {
            state.uncertain = true
            const diagnostic = diagnosticActivity(state, new ClaudeRuntimeUncertainError())
            await this.dependencies.appendActivity(context, [diagnostic])
            yield diagnostic
            throw new ClaudeRuntimeUncertainError()
          }
          return
        } catch (error) {
          if (state.cancelled) return
          if (
            shouldRetryClaudeRuntimeStaleSession({
              error,
              resume: state.resume,
              deliveredProviderMessages: state.deliveredProviderMessages,
              retryUsed: state.retryUsed,
              customDetector: this.dependencies.isMissingSessionError,
            })
          ) {
            await this.clearStaleSession(state)
            continue
          }

          if (error instanceof ClaudeRuntimeUncertainError && state.uncertain) throw error

          state.uncertain = !state.terminal
          const diagnostic = diagnosticActivity(state, error)
          await this.dependencies.appendActivity(context, [diagnostic])
          yield diagnostic
          throw error
        }
      }
    } finally {
      state.streaming = false
    }
  }

  async requestPermission(context: RuntimeAdapterContext, request: unknown): Promise<unknown> {
    await this.dependencies.appendActivity(context, [
      mapClaudePermissionActivity({ request, phase: "started" }),
    ])
    try {
      if (!this.dependencies.requestPermission) {
        throw new Error("Claude permission bridge is unavailable")
      }
      const result = await this.dependencies.requestPermission(context, request)
      const value = result as { behavior?: unknown; decision?: unknown }
      const decision =
        typeof value?.behavior === "string"
          ? value.behavior
          : typeof value?.decision === "string"
            ? value.decision
            : "resolved"
      await this.dependencies.appendActivity(context, [
        mapClaudePermissionActivity({
          request,
          phase: decision === "deny" ? "failed" : "completed",
          decision,
        }),
      ])
      return result
    } catch (error) {
      await this.dependencies.appendActivity(context, [
        mapClaudePermissionActivity({ request, phase: "failed", decision: "error" }),
      ])
      throw error
    }
  }

  async requestInput(context: RuntimeAdapterContext, request: unknown): Promise<unknown> {
    if (!this.dependencies.requestInput) throw new Error("Claude input bridge is unavailable")
    return this.dependencies.requestInput(context, request)
  }

  async cancel(context: RuntimeAdapterContext, reason: string): Promise<void> {
    const state = this.requireState(context)
    if (state.terminal) return
    if (state.cancelled) return state.cancellationPromise ?? undefined
    return this.cancelState(state, reason)
  }

  async complete(context: RuntimeAdapterContext): Promise<void> {
    const state = this.requireState(context)
    if (!state.terminal || state.uncertain || state.cancelled) {
      throw new ClaudeRuntimeUncertainError(
        "Claude runtime cannot complete without an authoritative terminal result",
      )
    }
    await this.dependencies.complete?.(context)
  }

  async reconcile(context: RuntimeAdapterContext): Promise<"running" | "completed" | "uncertain"> {
    const state = this.runs.get(context.runId)
    if (!state) {
      try {
        const resume = await this.dependencies.loadSession(context)
        const session = createRuntimeSession(context, resume)
        return this.dependencies.reconcile
          ? await this.dependencies.reconcile(context, session)
          : "uncertain"
      } catch {
        return "uncertain"
      }
    }
    if (state.uncertain) return "uncertain"
    if (state.terminal || state.cancelled) return "completed"
    if (this.dependencies.reconcile) {
      try {
        return await this.dependencies.reconcile(context, state.session)
      } catch {
        return "uncertain"
      }
    }
    return reconcileClaudeRuntimeUncertainty(state)
  }

  async cleanup(context: RuntimeAdapterContext): Promise<void> {
    const state = this.runs.get(context.runId)
    if (!state) return
    state.context.signal.removeEventListener("abort", state.abortListener)
    let primaryError: unknown = null
    try {
      try {
        await state.cancellationPromise
      } catch (error) {
        primaryError = error
      }
      try {
        await this.dependencies.cleanup?.(context)
      } catch (error) {
        primaryError ??= error
      }
    } finally {
      this.runs.delete(context.runId)
    }
    if (primaryError) {
      throw new Error(`Claude runtime cleanup failed: ${safeErrorMessage(primaryError)}`)
    }
  }

  private createState(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
    resume: ClaudeRuntimeResumeState | null,
  ): RunState {
    const abortController = new AbortController()
    const state: RunState = {
      context,
      session,
      resume,
      abortController,
      mapper: new ClaudeRuntimeEventMapper(context.launch.controls),
      prompt: null,
      queryInput: null,
      turnStarted: false,
      terminal: false,
      cancelled: false,
      deliveredProviderMessages: 0,
      retryUsed: false,
      streaming: false,
      consumed: false,
      uncertain: false,
      abortListener: () => undefined,
      cancellationPromise: null,
    }
    state.abortListener = () => {
      void this.cancelState(state, "context-aborted").catch((error) => {
        console.error(`[claude-runtime] Context cancellation failed: ${safeErrorMessage(error)}`)
      })
    }
    if (context.signal.aborted) state.abortListener()
    else context.signal.addEventListener("abort", state.abortListener, { once: true })
    return state
  }

  private async captureIdentity(state: RunState, message: SDKMessage): Promise<void> {
    const value = message as unknown as { session_id?: unknown; uuid?: unknown; type?: unknown }
    if (typeof value.session_id === "string" && value.session_id) {
      if (state.session.providerSessionId !== value.session_id) {
        state.session = { providerSessionId: value.session_id, providerThreadId: null }
        state.resume = { sessionId: value.session_id }
        await this.dependencies.persistSession(state.context, value.session_id)
      }
    }
    if (value.type === "assistant" && typeof value.uuid === "string" && value.uuid) {
      await this.dependencies.persistMessageUuid?.(state.context, value.uuid)
    }
  }

  private isStaleMessage(message: SDKMessage, state: RunState): boolean {
    if (!state.resume || state.deliveredProviderMessages !== 0 || state.retryUsed) return false
    const detector = this.dependencies.isMissingSessionError
    return (detector ?? isMissingClaudeSessionError)(message)
  }

  private async clearStaleSession(state: RunState): Promise<void> {
    const staleSessionId = state.resume?.sessionId
    if (!staleSessionId) return
    state.retryUsed = true
    await this.dependencies.clearStaleSession(state.context, staleSessionId)
    state.resume = null
    state.session = { providerSessionId: null, providerThreadId: null }
    if (state.queryInput) applyClaudeRuntimeResumeOptions(state.queryInput.options, null)
  }

  private requireState(context: RuntimeAdapterContext): RunState {
    const state = this.runs.get(context.runId)
    if (!state) throw new Error(`Claude runtime has no session for run ${context.runId}`)
    return state
  }

  private assertContext(context: RuntimeAdapterContext): void {
    if (
      context.launch.harness !== "claude-code" ||
      context.launch.resolvedRuntime !== "claude-code"
    ) {
      throw new Error("Claude Code Runtime requires a claude-code launch snapshot")
    }
  }

  private assertMutableBeforeDispatch(state: RunState, action: string): void {
    if (
      state.turnStarted ||
      state.streaming ||
      state.consumed ||
      state.terminal ||
      state.cancelled ||
      state.uncertain
    ) {
      throw new Error(`Claude runtime cannot ${action} after dispatch for ${state.context.runId}`)
    }
  }

  private cancelState(state: RunState, reason: string): Promise<void> {
    if (state.terminal) return Promise.resolve()
    if (state.cancellationPromise) return state.cancellationPromise
    state.cancelled = true
    state.abortController.abort(reason)
    state.cancellationPromise = (async () => {
      let cancelError: unknown = null
      try {
        await this.dependencies.cancel?.(state.context, reason)
      } catch (error) {
        cancelError = error
      }
      const batch = [cancelledActivity(state, reason)]
      if (cancelError) batch.push(diagnosticActivity(state, cancelError))
      try {
        await this.dependencies.appendActivity(state.context, batch)
      } catch (error) {
        console.error(
          `[claude-runtime] Failed to persist cancellation activity: ${safeErrorMessage(error)}`,
        )
      }
      if (cancelError) {
        throw new Error(`Claude runtime cancellation failed: ${safeErrorMessage(cancelError)}`)
      }
    })()
    return state.cancellationPromise
  }
}

export function createClaudeCodeRuntimeAdapter(
  dependencies: ClaudeRuntimeDependencies,
): ClaudeCodeRuntimeAdapter {
  return new ClaudeCodeRuntimeAdapter(dependencies)
}

function diagnosticActivity(state: RunState, error: unknown): AgentActivityAppend {
  const message = sanitizeClaudeDiagnostic(error instanceof Error ? error.message : String(error))
  return {
    provider: "anthropic",
    providerSessionId: boundedAdapterId(state.session.providerSessionId),
    phase: state.cancelled ? "cancelled" : "failed",
    displayClass: "status",
    privacyClass: "sensitive",
    kind: "warning",
    payload: {
      message,
      code: error instanceof Error ? error.name : "claude-runtime-error",
    },
    dedupKey: boundedAdapterId(
      `claude:${state.context.runId}:error:${state.deliveredProviderMessages}:${message}`,
    ),
  }
}

function cancelledActivity(state: RunState, reason: string): AgentActivityAppend {
  return {
    provider: "anthropic",
    providerSessionId: boundedAdapterId(state.session.providerSessionId),
    phase: "cancelled",
    displayClass: "status",
    privacyClass: "public",
    kind: "lifecycle",
    payload: {
      state: "cancelled",
      detail: sanitizeClaudeDiagnostic(reason),
    },
    dedupKey: boundedAdapterId(`claude:${state.context.runId}:cancelled`),
  }
}

function boundedAdapterId(value: string | null): string | null {
  return value === null ? null : value.slice(0, 2_048)
}

function safeErrorMessage(error: unknown): string {
  return sanitizeClaudeDiagnostic(error instanceof Error ? error.message : String(error))
}
