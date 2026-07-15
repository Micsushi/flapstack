import { createHash } from "node:crypto"
import {
  MAX_AGENT_ACTIVITY_BATCH_SIZE,
  type AgentActivityAppend,
} from "../../../../shared/agent-activity"
import type {
  HarnessAdapter,
  RuntimeAdapterContext,
  RuntimeAdapterProbe,
  RuntimeAdapterSession,
  RuntimeAdapterTurn,
  RuntimeBlockReason,
} from "../../../../shared/agent-runtime"
import { checkRuntimeCompatibility } from "../compatibility"
import { projectLegacyActivity } from "../legacy-activity-projection"
import {
  flapstackNativeCapabilitySnapshot,
  getFlapstackNativeDiagnostics,
  type FlapstackNativeDiagnostics,
} from "./provider-paths"

export type FlapstackNativeDelegationProbe = {
  available: boolean
  reason?: string | null
}

export interface FlapstackNativeProviderDelegation<TChunk = unknown> {
  probe?(): Promise<FlapstackNativeDelegationProbe> | FlapstackNativeDelegationProbe
  startSession(context: RuntimeAdapterContext): Promise<RuntimeAdapterSession>
  resumeSession(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
  ): Promise<RuntimeAdapterSession>
  startTurn(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
    prompt: string,
  ): Promise<RuntimeAdapterTurn>
  streamActivity(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
    turn: RuntimeAdapterTurn,
  ): AsyncIterable<TChunk>
  requestPermission(context: RuntimeAdapterContext, request: unknown): Promise<unknown>
  requestInput(context: RuntimeAdapterContext, request: unknown): Promise<unknown>
  cancel(context: RuntimeAdapterContext, reason: string): Promise<void>
  complete(context: RuntimeAdapterContext): Promise<void>
  reconcile(context: RuntimeAdapterContext): Promise<"running" | "completed" | "uncertain">
  cleanup(context: RuntimeAdapterContext): Promise<void>
  projectActivity?(
    context: RuntimeAdapterContext,
    chunk: TChunk,
  ): Promise<AgentActivityAppend[]> | AgentActivityAppend[]
}

export type FlapstackNativeAdapterOptions<TChunk = unknown> = {
  resolveDelegation: (
    harness: string,
  ) => FlapstackNativeProviderDelegation<TChunk> | null | undefined
  appendActivity?: (runId: string, events: AgentActivityAppend[]) => Promise<void> | void
  onProjectionError?: (
    context: RuntimeAdapterContext,
    diagnostic: FlapstackNativeProjectionDiagnostic,
  ) => void
  now?: () => Date
}

export type FlapstackNativeProjectionDiagnostic = {
  code: "activity-projection-skipped" | "activity-projection-failed"
  message: string
}

type RunState<TChunk> = {
  harness: string
  delegation: FlapstackNativeProviderDelegation<TChunk>
  session: RuntimeAdapterSession | null
  turn: RuntimeAdapterTurn | null
  streaming: boolean
  intentStarted: boolean
  turnConsumed: boolean
  cancelled: boolean
  terminal: boolean
  uncertain: boolean
  projectedIdentities: Set<string>
}

export interface FlapstackNativeHarnessAdapter<TChunk = unknown> extends HarnessAdapter<TChunk> {
  diagnostics(harness: string): FlapstackNativeDiagnostics
  projectLegacyHistory(messages: unknown): ReturnType<typeof projectLegacyActivity>
}

export function createFlapstackNativeAdapterFactory<TChunk = unknown>(
  options: FlapstackNativeAdapterOptions<TChunk>,
): () => FlapstackNativeHarnessAdapter<TChunk> {
  return () => new FlapstackNativeAdapter(options)
}

class FlapstackNativeAdapter<TChunk> implements FlapstackNativeHarnessAdapter<TChunk> {
  readonly runtime = "flapstack-native" as const
  private readonly states = new Map<string, RunState<TChunk>>()

  constructor(private readonly options: FlapstackNativeAdapterOptions<TChunk>) {}

  diagnostics(harness: string): FlapstackNativeDiagnostics {
    return getFlapstackNativeDiagnostics(harness)
  }

  projectLegacyHistory(messages: unknown): ReturnType<typeof projectLegacyActivity> {
    return projectLegacyActivity(messages)
  }

  async probe(harness: string): Promise<RuntimeAdapterProbe> {
    const compatibility = checkRuntimeCompatibility(harness, "flapstack-native")
    if (!compatibility.compatible) {
      return this.unavailableProbe(harness, compatibility.reason)
    }
    const delegation = this.options.resolveDelegation(harness)
    if (!delegation) {
      return this.unavailableProbe(
        harness,
        unavailableReason(harness, "No Stage 3 provider delegation is registered."),
      )
    }
    if (delegation.projectActivity && !this.options.appendActivity) {
      return this.unavailableProbe(
        harness,
        unavailableReason(
          harness,
          "The provider delegation projects Runtime activity but no durable append authority is configured.",
        ),
      )
    }
    try {
      const delegated = (await delegation.probe?.()) ?? { available: true, reason: null }
      if (!delegated.available) {
        return this.unavailableProbe(
          harness,
          unavailableReason(
            harness,
            sanitizeDiagnostic(delegated.reason ?? "The Stage 3 provider path is unavailable."),
          ),
        )
      }
      const diagnostics = this.diagnostics(harness)
      return {
        runtime: "flapstack-native",
        harness,
        available: true,
        versions: diagnostics.versions,
        capabilities: flapstackNativeCapabilitySnapshot({
          harness,
          available: true,
          capturedAt: (this.options.now ?? (() => new Date()))().toISOString(),
        }),
        reason: null,
      }
    } catch (error) {
      return this.unavailableProbe(
        harness,
        unavailableReason(harness, `Stage 3 provider probe failed: ${sanitizeDiagnostic(error)}`),
      )
    }
  }

  async startSession(context: RuntimeAdapterContext): Promise<RuntimeAdapterSession> {
    this.assertContext(context)
    if (this.states.has(context.runId)) {
      throw new Error("[flapstack-native] Run already owns a provider delegation.")
    }
    const delegation = this.requiredDelegation(context.launch.harness)
    const state: RunState<TChunk> = {
      harness: context.launch.harness,
      delegation,
      session: null,
      turn: null,
      streaming: false,
      intentStarted: false,
      turnConsumed: false,
      cancelled: false,
      terminal: false,
      uncertain: false,
      projectedIdentities: new Set(),
    }
    this.states.set(context.runId, state)
    try {
      const session = await delegation.startSession(context)
      state.session = session
      return session
    } catch (error) {
      this.states.delete(context.runId)
      throw error
    }
  }

  async resumeSession(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
  ): Promise<RuntimeAdapterSession> {
    this.assertContext(context)
    let state = this.states.get(context.runId)
    let created = false
    if (!state) {
      state = {
        harness: context.launch.harness,
        delegation: this.requiredDelegation(context.launch.harness),
        session: null,
        turn: null,
        streaming: false,
        intentStarted: false,
        turnConsumed: false,
        cancelled: false,
        terminal: false,
        uncertain: false,
        projectedIdentities: new Set(),
      }
      this.states.set(context.runId, state)
      created = true
    }
    if (state.intentStarted || state.turnConsumed || state.uncertain || state.cancelled) {
      throw new Error("[flapstack-native] Cannot resume during or after provider turn intent.")
    }
    const previousSession = state.session
    try {
      const resumed = await state.delegation.resumeSession(context, session)
      state.session = resumed
      return resumed
    } catch (error) {
      if (created) this.states.delete(context.runId)
      else state.session = previousSession
      throw error
    }
  }

  async startTurn(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
    prompt: string,
  ): Promise<RuntimeAdapterTurn> {
    const state = this.requiredState(context)
    if (
      state.turn ||
      state.streaming ||
      state.intentStarted ||
      state.turnConsumed ||
      state.uncertain ||
      state.cancelled ||
      state.terminal
    ) {
      throw new Error("[flapstack-native] Prior provider turn is active or uncertain.")
    }
    if (!sameSession(state.session, session)) {
      throw new Error("[flapstack-native] Provider session identity does not match the active run.")
    }
    let dispatched = false
    try {
      dispatched = true
      const turn = await state.delegation.startTurn(context, session, prompt)
      state.turn = turn
      state.intentStarted = true
      state.terminal = false
      return turn
    } catch (error) {
      if (dispatched) state.uncertain = true
      throw error
    }
  }

  async *streamActivity(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
    turn: RuntimeAdapterTurn,
  ): AsyncIterable<TChunk> {
    const state = this.requiredState(context)
    if (!sameSession(state.session, session)) {
      throw new Error("[flapstack-native] Provider session identity does not match the active run.")
    }
    if (!sameTurn(state.turn, turn)) {
      throw new Error("[flapstack-native] Provider turn identity does not match the active run.")
    }
    if (state.streaming || state.turnConsumed) {
      throw new Error("[flapstack-native] Activity stream already consumed.")
    }
    state.turnConsumed = true
    state.streaming = true
    try {
      for await (const chunk of state.delegation.streamActivity(context, session, turn)) {
        await this.projectLosslessActivity(context, state, chunk)
        // Preserve the exact Stage 3 provider chunk reference and ordering.
        yield chunk
      }
      state.terminal = true
    } catch (error) {
      state.uncertain = true
      throw error
    } finally {
      state.streaming = false
    }
  }

  async requestPermission(context: RuntimeAdapterContext, request: unknown): Promise<unknown> {
    return await this.requiredState(context).delegation.requestPermission(context, request)
  }

  async requestInput(context: RuntimeAdapterContext, request: unknown): Promise<unknown> {
    return await this.requiredState(context).delegation.requestInput(context, request)
  }

  async cancel(context: RuntimeAdapterContext, reason: string): Promise<void> {
    const state = this.states.get(context.runId)
    if (!state) return
    try {
      await state.delegation.cancel(context, reason)
      state.cancelled = true
      state.turnConsumed = state.intentStarted || state.turnConsumed
      state.terminal = true
      state.uncertain = false
    } catch (error) {
      state.turnConsumed = state.intentStarted || state.turnConsumed
      state.uncertain = true
      state.terminal = false
      throw error
    }
  }

  async complete(context: RuntimeAdapterContext): Promise<void> {
    const state = this.requiredState(context)
    await state.delegation.complete(context)
    state.terminal = true
    state.uncertain = false
  }

  async reconcile(context: RuntimeAdapterContext): Promise<"running" | "completed" | "uncertain"> {
    const state = this.states.get(context.runId)
    if (!state) {
      // Ask the persisted provider authority directly. Never start/resume/replay.
      try {
        return await this.requiredDelegation(context.launch.harness).reconcile(context)
      } catch {
        return "uncertain"
      }
    }
    try {
      const result = await state.delegation.reconcile(context)
      state.terminal = result === "completed"
      state.uncertain = result === "uncertain"
      return result
    } catch {
      state.uncertain = true
      return "uncertain"
    }
  }

  async cleanup(context: RuntimeAdapterContext): Promise<void> {
    const state = this.states.get(context.runId)
    if (!state) return
    try {
      await state.delegation.cleanup(context)
    } finally {
      this.states.delete(context.runId)
    }
  }

  private async projectLosslessActivity(
    context: RuntimeAdapterContext,
    state: RunState<TChunk>,
    chunk: TChunk,
  ): Promise<void> {
    if (!state.delegation.projectActivity || !this.options.appendActivity) return
    try {
      const projected = await state.delegation.projectActivity(context, chunk)
      const invalidReason = validateProjectedBatch(projected)
      if (invalidReason) {
        this.reportProjectionDiagnostic(context, "activity-projection-skipped", invalidReason)
        return
      }
      const normalized = projected.map(normalizeProjectedActivity)
      if (normalized.some((item) => item === null)) {
        this.reportProjectionDiagnostic(
          context,
          "activity-projection-skipped",
          "Activity batch stayed on the legacy bridge because provider identity was not lossless.",
        )
        return
      }
      const stable = normalized as Array<{ event: AgentActivityAppend; identity: string }>
      const stableIdentities = stable.map((item) => item.identity)
      if (stableIdentities.length === 0) return
      if (stableIdentities.every((identity) => state.projectedIdentities.has(identity))) return
      await this.options.appendActivity(
        context.runId,
        stable.map((item) => item.event),
      )
      for (const identity of stableIdentities) state.projectedIdentities.add(identity)
    } catch (error) {
      // Activity projection is additive. The Stage 3 chunk still streams unchanged.
      this.reportProjectionDiagnostic(
        context,
        "activity-projection-failed",
        `Activity projection failed: ${sanitizeDiagnostic(error)}`,
      )
    }
  }

  private reportProjectionDiagnostic(
    context: RuntimeAdapterContext,
    code: FlapstackNativeProjectionDiagnostic["code"],
    message: string,
  ): void {
    this.options.onProjectionError?.(context, {
      code,
      message: sanitizeDiagnostic(message),
    })
  }

  private requiredState(context: RuntimeAdapterContext): RunState<TChunk> {
    this.assertContext(context)
    const state = this.states.get(context.runId)
    if (!state) throw new Error("[flapstack-native] Provider delegation has not started.")
    if (state.harness !== context.launch.harness) {
      throw new Error("[flapstack-native] Run harness cannot change inside a provider session.")
    }
    return state
  }

  private requiredDelegation(harness: string): FlapstackNativeProviderDelegation<TChunk> {
    const delegation = this.options.resolveDelegation(harness)
    if (!delegation) throw new Error(`[flapstack-native] No Stage 3 delegation for ${harness}.`)
    if (delegation.projectActivity && !this.options.appendActivity) {
      throw new Error(
        "[flapstack-native] Durable append authority is required for projected Runtime activity.",
      )
    }
    return delegation
  }

  private assertContext(context: RuntimeAdapterContext): void {
    if (context.launch.resolvedRuntime !== "flapstack-native") {
      throw new Error("[flapstack-native] Adapter requires a flapstack-native launch snapshot.")
    }
    if (context.launch.harness !== context.launch.compatibility.harness) {
      throw new Error("[flapstack-native] Launch compatibility harness does not match the run.")
    }
  }

  private unavailableProbe(harness: string, reason: RuntimeBlockReason): RuntimeAdapterProbe {
    const diagnostics = this.diagnostics(harness)
    return {
      runtime: "flapstack-native",
      harness,
      available: false,
      versions: diagnostics.versions,
      capabilities: flapstackNativeCapabilitySnapshot({
        harness,
        available: false,
        capturedAt: (this.options.now ?? (() => new Date()))().toISOString(),
        unavailableReason: reason,
      }),
      reason,
    }
  }
}

function normalizeProjectedActivity(
  event: AgentActivityAppend,
): { event: AgentActivityAppend; identity: string } | null {
  const identity = stableProviderIdentity(event)
  if (!identity) return null
  return {
    event: event.dedupKey ? event : { ...event, dedupKey: identity },
    identity,
  }
}

const MAX_AGENT_ACTIVITY_IDENTITY_BYTES = 2_048
const MAX_AGENT_ACTIVITY_SHORT_IDENTITY_BYTES = 512

function validateProjectedBatch(projected: unknown): string | null {
  if (!Array.isArray(projected)) return "Activity projector returned a non-array batch."
  if (projected.length > MAX_AGENT_ACTIVITY_BATCH_SIZE) {
    return `Activity batch exceeded the ${MAX_AGENT_ACTIVITY_BATCH_SIZE}-event limit.`
  }
  for (const value of projected) {
    if (!value || typeof value !== "object") return "Activity batch contained a malformed event."
    const event = value as Record<string, unknown>
    if (!boundedString(event.provider, MAX_AGENT_ACTIVITY_SHORT_IDENTITY_BYTES, false)) {
      return "Activity batch contained an invalid provider identity."
    }
    for (const field of [
      "dedupKey",
      "providerEventId",
      "providerSessionId",
      "providerThreadId",
      "providerTurnId",
      "providerItemId",
      "providerParentItemId",
      "providerMessageId",
      "providerToolId",
    ]) {
      if (!boundedString(event[field], MAX_AGENT_ACTIVITY_IDENTITY_BYTES, true)) {
        return "Activity batch contained an oversized or invalid provider identity."
      }
    }
    if (!boundedString(event.sectionBoundary, MAX_AGENT_ACTIVITY_SHORT_IDENTITY_BYTES, true)) {
      return "Activity batch contained an oversized or invalid section identity."
    }
    for (const field of ["summaryIndex", "contentIndex", "partIndex"]) {
      const index = event[field]
      if (
        index !== null &&
        index !== undefined &&
        (typeof index !== "number" ||
          !Number.isFinite(index) ||
          !Number.isInteger(index) ||
          index < 0)
      ) {
        return "Activity batch contained an invalid provider index."
      }
    }
  }
  return null
}

function boundedString(value: unknown, maxBytes: number, nullable: boolean): boolean {
  if (value === null || value === undefined) return nullable
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= maxBytes
}

function stableProviderIdentity(event: AgentActivityAppend): string | null {
  if (event.dedupKey) return event.dedupKey
  if (event.providerEventId) {
    return digestProviderIdentity(["provider-event", event.provider, event.providerEventId])
  }
  const identityFields = [
    event.providerSessionId,
    event.providerThreadId,
    event.providerTurnId,
    event.providerItemId,
    event.providerParentItemId,
    event.providerMessageId,
    event.providerToolId,
  ]
  if (!identityFields.some((value) => typeof value === "string" && value.length > 0)) return null
  const indexFields = [event.summaryIndex, event.contentIndex, event.partIndex]
  if (!event.dedupKey && !indexFields.some((value) => typeof value === "number")) return null
  return digestProviderIdentity([
    "provider-tuple",
    event.provider,
    event.kind,
    event.phase,
    ...identityFields,
    ...indexFields,
    event.sectionBoundary ?? null,
  ])
}

function digestProviderIdentity(parts: unknown[]): string {
  const key = `flapstack-native:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`
  if (Buffer.byteLength(key, "utf8") > MAX_AGENT_ACTIVITY_IDENTITY_BYTES) {
    throw new Error("Synthesized activity identity exceeded the storage schema limit.")
  }
  return key
}

function unavailableReason(harness: string, message: string): RuntimeBlockReason {
  return {
    code: "runtime-unavailable",
    harness,
    runtime: "flapstack-native",
    message: sanitizeDiagnostic(message),
    repair: "Repair or enable the existing provider path before launching.",
  }
}

function sameSession(
  left: RuntimeAdapterSession | null,
  right: RuntimeAdapterSession | null,
): boolean {
  if (left === null || right === null) return false
  const hasProviderIdentity = [
    left.providerSessionId,
    left.providerThreadId,
    right.providerSessionId,
    right.providerThreadId,
  ].some((value) => value !== null)
  if (!hasProviderIdentity) return left === right
  return (
    left.providerSessionId === right.providerSessionId &&
    left.providerThreadId === right.providerThreadId
  )
}

function sameTurn(left: RuntimeAdapterTurn | null, right: RuntimeAdapterTurn | null): boolean {
  if (left === null || right === null) return false
  if (left.providerTurnId === null && right.providerTurnId === null) return left === right
  return left.providerTurnId === right.providerTurnId
}

function sanitizeDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(
      /\b(?:AKIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_]{8,}|sk-(?:ant-)?[A-Za-z0-9_-]{6,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g,
      "[REDACTED]",
    )
    .replace(/\b(bearer)\s+[^\s,;]+/gi, "$1 [REDACTED]")
    .replace(/\b(token|api[-_ ]?key|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/(?:~\/|\/Users|\/home|\/private|[A-Za-z]:\\)[^\s,;)]*/g, "[PATH]")
    .slice(0, 512)
}
