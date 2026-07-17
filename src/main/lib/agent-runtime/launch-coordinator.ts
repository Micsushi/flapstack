import type { AgentActivityAppend } from "../../../shared/agent-activity"
import type {
  HarnessAdapter,
  ResolvedRuntimeLaunch,
  RuntimeAdapterContext,
  RuntimeAdapterProbe,
  RuntimeAdapterSession,
  RuntimeAdapterTurn,
} from "../../../shared/agent-runtime"
import { AgentRuntimeRegistry, RuntimeRegistryError } from "./registry"
import { sanitizeRuntimeText } from "./sanitizer"

export type RuntimeLaunchIdentity = {
  runId: string
  chatId: string
  subChatId: string | null
  orchestrationAgentId?: string | null
}

export type RuntimeLaunchRequest = RuntimeLaunchIdentity & {
  launch: ResolvedRuntimeLaunch
  prompt: string
  instructions?: string | null
  persistedSession?: RuntimeAdapterSession | null
  signal?: AbortSignal
}

export type RuntimeLaunchLifecycle =
  | "validated"
  | "intent-persisted"
  | "session-started"
  | "turn-started"
  | "streaming"
  | "paused"
  | "resumed"
  | "completed"
  | "cancelled"
  | "uncertain"
  | "failed"

export type RuntimeLaunchHooks<TActivity = AgentActivityAppend> = {
  /** Idempotently records provider intent before session/start-turn calls. */
  persistIntent(request: RuntimeLaunchRequest): Promise<void> | void
  persistSession?(
    request: RuntimeLaunchRequest,
    session: RuntimeAdapterSession,
  ): Promise<void> | void
  persistTurn?(
    request: RuntimeLaunchRequest,
    session: RuntimeAdapterSession,
    turn: RuntimeAdapterTurn,
  ): Promise<void> | void
  onLifecycle?(
    request: RuntimeLaunchRequest,
    lifecycle: RuntimeLaunchLifecycle,
    detail?: string | null,
  ): Promise<void> | void
  /** References authoritative activity; never copy provider text into orchestration rows. */
  onActivityReference?(request: RuntimeLaunchRequest, activity: TActivity): Promise<void> | void
}

export type RuntimeLaunchResult = {
  session: RuntimeAdapterSession
  turn: RuntimeAdapterTurn
  activityCount: number
}

type ActiveLaunch<TActivity> = {
  request: RuntimeLaunchRequest
  adapter: HarnessAdapter<TActivity>
  context: RuntimeAdapterContext
  controller: AbortController
  state: "running" | "paused" | "cancelling" | "cancelled" | "completed" | "failed"
  deliveryActive: boolean
  pausedDeliveries: TActivity[]
  resumeGate: Promise<void> | null
  releaseResumeGate: (() => void) | null
  controlTail: Promise<void>
  cancellationPromise: Promise<boolean> | null
  cancellationLifecycleWritten: boolean
}

export type RuntimeCoordinatorRunState = ActiveLaunch<unknown>["state"] | "starting"

export const MAX_PAUSED_RUNTIME_DELIVERIES = 128

export class RuntimeLaunchCancelledError extends Error {
  constructor(readonly runId: string) {
    super(`Runtime run ${runId} was cancelled.`)
    this.name = "RuntimeLaunchCancelledError"
  }
}

export class RuntimeLaunchCoordinator<TActivity = AgentActivityAppend> {
  private readonly active = new Map<string, ActiveLaunch<TActivity>>()
  private readonly reserved = new Set<string>()
  private readonly pendingCancellations = new Map<
    string,
    { reason: string; promise: Promise<boolean>; resolve(value: boolean): void; settled: boolean }
  >()

  constructor(
    private readonly registry: AgentRuntimeRegistry<TActivity>,
    private readonly hooks: RuntimeLaunchHooks<TActivity>,
  ) {}

  async launch(request: RuntimeLaunchRequest): Promise<RuntimeLaunchResult> {
    if (this.reserved.has(request.runId)) {
      throw new Error(`Runtime run ${request.runId} is already active.`)
    }
    this.reserved.add(request.runId)
    try {
      return await this.launchReserved(request)
    } finally {
      const pending = this.pendingCancellations.get(request.runId)
      if (pending && !pending.settled) {
        pending.settled = true
        pending.resolve(false)
      }
      this.pendingCancellations.delete(request.runId)
      this.reserved.delete(request.runId)
    }
  }

  private async launchReserved(request: RuntimeLaunchRequest): Promise<RuntimeLaunchResult> {
    validateRequest(request)
    const adapter = this.registry.forNewLaunch(
      request.launch.resolvedRuntime,
      request.launch.harness,
    )
    const probe = await this.registry.probe(request.launch.resolvedRuntime, request.launch.harness)
    if (!probe.available) {
      throw new RuntimeRegistryError(
        probe.reason ?? {
          code: "runtime-unavailable",
          harness: request.launch.harness,
          runtime: request.launch.resolvedRuntime,
          message: `${request.launch.resolvedRuntime} Runtime is unavailable.`,
          repair: "Repair the adapter probe or explicitly choose another compatible Runtime.",
        },
      )
    }
    assertProbeMatchesSnapshot(request, probe)
    await this.hooks.onLifecycle?.(request, "validated")

    const pendingCancellation = this.pendingCancellations.get(request.runId)
    if (pendingCancellation) {
      try {
        await this.hooks.onLifecycle?.(
          request,
          "cancelled",
          sanitizeRuntimeText(pendingCancellation.reason, { maxLength: 500, mode: "diagnostic" }),
        )
        pendingCancellation.settled = true
        pendingCancellation.resolve(true)
      } catch (error) {
        pendingCancellation.settled = true
        pendingCancellation.resolve(false)
        throw error
      }
      throw new RuntimeLaunchCancelledError(request.runId)
    }

    const controller = new AbortController()
    const externalSignal = request.signal
    const abort = () => void this.cancel(request.runId, String(externalSignal?.reason ?? "aborted"))
    const context: RuntimeAdapterContext = {
      runId: request.runId,
      chatId: request.chatId,
      subChatId: request.subChatId,
      launch: request.launch,
      instructions: request.instructions?.trim() || null,
      signal: controller.signal,
    }
    const active: ActiveLaunch<TActivity> = {
      request,
      adapter,
      context,
      controller,
      state: "running",
      deliveryActive: false,
      pausedDeliveries: [],
      resumeGate: null,
      releaseResumeGate: null,
      controlTail: Promise.resolve(),
      cancellationPromise: null,
      cancellationLifecycleWritten: false,
    }
    this.active.set(request.runId, active)
    externalSignal?.addEventListener("abort", abort, { once: true })
    if (externalSignal?.aborted) abort()
    let intentPersisted = false
    try {
      await this.hooks.persistIntent(request)
      assertNotCancelled(active)
      intentPersisted = true
      await this.hooks.onLifecycle?.(request, "intent-persisted")
      const session = request.persistedSession
        ? await adapter.resumeSession(context, request.persistedSession)
        : await adapter.startSession(context)
      await this.hooks.persistSession?.(request, session)
      assertNotCancelled(active)
      await this.hooks.onLifecycle?.(request, "session-started")
      const turn = await adapter.startTurn(context, session, request.prompt)
      await this.hooks.persistTurn?.(request, session, turn)
      assertNotCancelled(active)
      await this.hooks.onLifecycle?.(request, "turn-started")
      let activityCount = 0
      await this.hooks.onLifecycle?.(request, "streaming")
      active.deliveryActive = true
      try {
        for await (const activity of adapter.streamActivity(context, session, turn)) {
          assertNotCancelled(active)
          activityCount += 1
          await this.deliverOrBuffer(active, activity)
        }
        await waitWhilePaused(active)
        await this.flushPausedDeliveries(active)
      } finally {
        active.deliveryActive = false
      }
      assertNotCancelled(active)
      await adapter.complete(context)
      assertNotCancelled(active)
      active.state = "completed"
      await this.hooks.onLifecycle?.(request, "completed")
      return { session, turn, activityCount }
    } catch (error) {
      if (
        error instanceof RuntimeLaunchCancelledError ||
        active.state === "cancelling" ||
        active.state === "cancelled" ||
        (controller.signal.aborted && active.state !== "failed")
      ) {
        await active.cancellationPromise
        throw error instanceof RuntimeLaunchCancelledError
          ? error
          : new RuntimeLaunchCancelledError(request.runId)
      }
      active.state = "failed"
      const state = intentPersisted ? await safeReconcile(adapter, context) : null
      await this.hooks.onLifecycle?.(
        request,
        state === "uncertain" || state === "running" ? "uncertain" : "failed",
        safeMessage(error),
      )
      throw error
    } finally {
      externalSignal?.removeEventListener("abort", abort)
      try {
        await adapter.cleanup(context)
      } finally {
        this.active.delete(request.runId)
      }
    }
  }

  async cancel(runId: string, reason: string): Promise<boolean> {
    const active = this.active.get(runId)
    if (!active) {
      if (!this.reserved.has(runId)) return false
      let pending = this.pendingCancellations.get(runId)
      if (!pending) {
        let resolve!: (value: boolean) => void
        const promise = new Promise<boolean>((resolvePromise) => {
          resolve = resolvePromise
        })
        pending = { reason, promise, resolve, settled: false }
        this.pendingCancellations.set(runId, pending)
      }
      return await pending.promise
    }
    if (active.state === "completed" || active.state === "failed") return false
    if (active.cancellationPromise) return await active.cancellationPromise
    active.state = "cancelling"
    active.deliveryActive = false
    active.pausedDeliveries.length = 0
    releaseResumeGate(active)
    active.controller.abort(reason)
    active.cancellationPromise = (async () => {
      try {
        await active.adapter.cancel(active.context, reason)
        active.state = "cancelled"
        if (!active.cancellationLifecycleWritten) {
          active.cancellationLifecycleWritten = true
          await this.hooks.onLifecycle?.(
            active.request,
            "cancelled",
            sanitizeRuntimeText(reason, { maxLength: 500, mode: "diagnostic" }),
          )
        }
        return true
      } catch (error) {
        active.state = "failed"
        await this.hooks.onLifecycle?.(active.request, "failed", safeMessage(error))
        return false
      }
    })()
    return await active.cancellationPromise
  }

  /**
   * Pauses only Flapstack delivery of already-authoritative Runtime activity.
   * Provider execution is not claimed suspended. Delivery buffers at most
   * MAX_PAUSED_RUNTIME_DELIVERIES before applying backpressure.
   */
  async pause(runId: string): Promise<boolean> {
    const active = this.active.get(runId)
    if (!active) return false
    return serializeControl(active, async () => {
      if (active.state !== "running" || !active.deliveryActive) return false
      active.state = "paused"
      active.resumeGate = new Promise<void>((resolve) => {
        active.releaseResumeGate = resolve
      })
      try {
        await this.hooks.onLifecycle?.(active.request, "paused")
        return active.state === "paused"
      } catch (error) {
        if (active.state === "paused") {
          active.state = "running"
          releaseResumeGate(active)
        }
        throw error
      }
    })
  }

  async resume(runId: string): Promise<boolean> {
    const active = this.active.get(runId)
    if (!active) return false
    return serializeControl(active, async () => {
      if (active.state !== "paused" || !active.deliveryActive) return false
      await this.hooks.onLifecycle?.(active.request, "resumed")
      if (active.state !== "paused") return false
      active.state = "running"
      releaseResumeGate(active)
      return true
    })
  }

  /**
   * Handles a cancellation after process recovery. This path can only cancel a
   * provider state that first reconciles as running; uncertain state is never
   * treated as an acknowledgement and provider intent is never replayed.
   */
  async cancelPersisted(request: RuntimeLaunchRequest, reason: string): Promise<boolean> {
    if (this.active.has(request.runId)) return await this.cancel(request.runId, reason)
    validateRequest(request)
    const adapter = this.registry.get(request.launch.resolvedRuntime)
    if (!adapter) return false
    const controller = new AbortController()
    const context: RuntimeAdapterContext = {
      runId: request.runId,
      chatId: request.chatId,
      subChatId: request.subChatId,
      launch: request.launch,
      instructions: request.instructions?.trim() || null,
      signal: controller.signal,
    }
    const reconciled = await safeReconcile(adapter, context)
    if (reconciled !== "running") {
      await this.hooks.onLifecycle?.(
        request,
        reconciled === "completed" ? "completed" : "uncertain",
        reconciled === "uncertain"
          ? "Persisted Runtime cancellation could not establish provider authority."
          : null,
      )
      return false
    }
    controller.abort(reason)
    try {
      await adapter.cancel(
        context,
        sanitizeRuntimeText(reason, { maxLength: 500, mode: "diagnostic" }),
      )
      await adapter.cleanup(context)
      await this.hooks.onLifecycle?.(request, "cancelled", reason)
      return true
    } catch (error) {
      try {
        await adapter.cleanup(context)
      } catch {
        // The persisted cancellation remains unacknowledged below.
      }
      await this.hooks.onLifecycle?.(request, "uncertain", safeMessage(error))
      return false
    }
  }

  async requestPermission(runId: string, request: unknown): Promise<unknown> {
    const active = this.active.get(runId)
    if (!active || !["running", "paused"].includes(active.state)) {
      throw new Error(`Runtime run ${runId} has no active permission authority.`)
    }
    return await active.adapter.requestPermission(active.context, request)
  }

  async requestInput(runId: string, request: unknown): Promise<unknown> {
    const active = this.active.get(runId)
    if (!active || !["running", "paused"].includes(active.state)) {
      throw new Error(`Runtime run ${runId} has no active input authority.`)
    }
    return await active.adapter.requestInput(active.context, request)
  }

  activeRunIds(): string[] {
    return [...this.active.keys()].sort()
  }

  runState(runId: string): RuntimeCoordinatorRunState | null {
    return this.active.get(runId)?.state ?? (this.reserved.has(runId) ? "starting" : null)
  }

  async reconcile(request: RuntimeLaunchRequest): Promise<"running" | "completed" | "uncertain"> {
    validateRequest(request)
    const ownedState = this.runState(request.runId)
    if (ownedState) return reconciliationStateForOwned(ownedState)
    const adapter = this.registry.get(request.launch.resolvedRuntime)
    if (!adapter) return "uncertain"
    const context: RuntimeAdapterContext = {
      runId: request.runId,
      chatId: request.chatId,
      subChatId: request.subChatId,
      launch: request.launch,
      instructions: request.instructions?.trim() || null,
      signal: request.signal ?? new AbortController().signal,
    }
    return safeReconcile(adapter, context)
  }

  private async deliverOrBuffer(active: ActiveLaunch<TActivity>, activity: TActivity) {
    if (active.state !== "paused") {
      await this.hooks.onActivityReference?.(active.request, activity)
      return
    }
    active.pausedDeliveries.push(activity)
    if (active.pausedDeliveries.length < MAX_PAUSED_RUNTIME_DELIVERIES) return
    await waitWhilePaused(active)
    await this.flushPausedDeliveries(active)
  }

  private async flushPausedDeliveries(active: ActiveLaunch<TActivity>): Promise<void> {
    while (active.pausedDeliveries.length > 0) {
      await waitWhilePaused(active)
      assertNotCancelled(active)
      const activity = active.pausedDeliveries.shift()!
      await this.hooks.onActivityReference?.(active.request, activity)
    }
  }
}

function reconciliationStateForOwned(
  state: RuntimeCoordinatorRunState,
): "running" | "completed" | "uncertain" {
  if (state === "starting" || state === "running" || state === "paused") return "running"
  if (state === "completed") return "completed"
  return "uncertain"
}

function validateRequest(request: RuntimeLaunchRequest): void {
  if (!request.runId || !request.chatId || !request.prompt.trim()) {
    throw new Error("Runtime launch requires durable run/chat identity and a non-empty prompt.")
  }
  if (
    request.launch.compatibility.harness !== request.launch.harness ||
    request.launch.compatibility.runtime !== request.launch.resolvedRuntime
  ) {
    throw new Error("Runtime launch snapshot compatibility identity is corrupt.")
  }
}

function assertProbeMatchesSnapshot(
  request: RuntimeLaunchRequest,
  probe: RuntimeAdapterProbe,
): void {
  if (
    probe.runtime !== request.launch.resolvedRuntime ||
    probe.harness !== request.launch.harness
  ) {
    throw new Error("Runtime adapter probe identity does not match the persisted launch snapshot.")
  }
  const versions = request.launch.versions
  if (
    request.launch.preferenceSource !== "legacy" &&
    versions.adapterVersion !== "unresolved" &&
    (versions.adapterVersion !== probe.versions.adapterVersion ||
      versions.protocolVersion !== probe.versions.protocolVersion)
  ) {
    throw new Error(
      `Runtime adapter version changed after snapshot (${versions.adapterVersion}/${versions.protocolVersion} -> ${probe.versions.adapterVersion}/${probe.versions.protocolVersion}).`,
    )
  }
}

async function safeReconcile<TActivity>(
  adapter: HarnessAdapter<TActivity>,
  context: RuntimeAdapterContext,
): Promise<"running" | "completed" | "uncertain"> {
  try {
    return await adapter.reconcile(context)
  } catch {
    return "uncertain"
  }
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return sanitizeRuntimeText(message, { maxLength: 500, mode: "diagnostic" })
}

function assertNotCancelled<TActivity>(active: ActiveLaunch<TActivity>): void {
  if (
    active.state === "cancelling" ||
    active.state === "cancelled" ||
    active.controller.signal.aborted
  ) {
    throw new RuntimeLaunchCancelledError(active.request.runId)
  }
}

async function waitWhilePaused<TActivity>(active: ActiveLaunch<TActivity>): Promise<void> {
  while (active.state === "paused") {
    const gate = active.resumeGate
    if (!gate) throw new Error("Runtime delivery pause gate is missing.")
    await gate
  }
  assertNotCancelled(active)
}

function releaseResumeGate<TActivity>(active: ActiveLaunch<TActivity>): void {
  active.releaseResumeGate?.()
  active.resumeGate = null
  active.releaseResumeGate = null
}

async function serializeControl<TActivity, TResult>(
  active: ActiveLaunch<TActivity>,
  operation: () => Promise<TResult>,
): Promise<TResult> {
  const previous = active.controlTail
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  active.controlTail = previous.catch(() => undefined).then(() => gate)
  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
  }
}
