import { createHash } from "node:crypto"
import type { McpCallerIdentity, McpRiskTier } from "./types"

export type McpApprovalTerminalState =
  "approved" | "denied" | "timed-out" | "cancelled" | "shutdown"

export type McpApprovalDecision = {
  id: string
  state: McpApprovalTerminalState
  source: "user" | "session-grant" | "timeout" | "cancellation" | "shutdown"
}

export type McpPendingApproval = {
  id: string
  invocationId: string
  contextHash: string
  caller: Pick<McpCallerIdentity, "chatId" | "runId">
  toolName: string
  tier: McpRiskTier
  createdAt: Date
  expiresAt: Date
  input: unknown
}

export type McpApprovalRequest = {
  id: string
  invocationId?: string
  caller: Pick<McpCallerIdentity, "chatId" | "runId">
  toolName: string
  tier: McpRiskTier
  timeoutMs?: number
  input?: unknown
}

export type McpApprovalCoordinator = {
  publish: (pending: McpPendingApproval) => void
  readDecision: (
    pending: McpPendingApproval,
  ) => { decision: "approve" | "deny"; grantSession: boolean } | null
}

export type McpApprovalWait = {
  pending: McpPendingApproval | null
  decision: Promise<McpApprovalDecision>
}

type PendingApproval = McpPendingApproval & {
  timer: ReturnType<typeof setTimeout>
  decision: Promise<McpApprovalDecision>
  resolve: (decision: McpApprovalDecision) => void
}

type SessionGrant = {
  chatId: string
  runId?: string
  toolName: string
  tier: Exclude<McpRiskTier, 3>
}

const DEFAULT_TIMEOUT_MS = 60_000

/**
 * Main-process-only approval state. Decisions and grants deliberately never
 * touch SQLite: a process restart or caller session end fails closed.
 */
export class McpApprovalLifecycle {
  private readonly pending = new Map<string, PendingApproval>()
  private readonly grants = new Map<string, SessionGrant>()
  private stopped = false

  constructor(
    private readonly coordinator?: McpApprovalCoordinator,
    private readonly onPendingChanged?: () => void,
  ) {}

  request(request: McpApprovalRequest): McpApprovalWait {
    if (this.stopped) return settled(request.id, "shutdown", "shutdown")

    const existing = this.pending.get(request.id)
    if (existing) {
      if (existing.contextHash !== buildMcpApprovalContextHash(request)) {
        return settled(request.id, "cancelled", "cancellation")
      }
      return { pending: snapshot(existing), decision: existing.decision }
    }

    // Tier 3 requests that reach this lifecycle always need a new human
    // decision, even when a lower-tier grant exists for the same chat and tool.
    if (request.tier !== 3 && this.hasSessionGrant(request)) {
      return settled(request.id, "approved", "session-grant")
    }

    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return settled(request.id, "timed-out", "timeout")
    }

    let resolve!: (decision: McpApprovalDecision) => void
    const decision = new Promise<McpApprovalDecision>((resolveDecision) => {
      resolve = resolveDecision
    })
    const createdAt = new Date()
    const pending: PendingApproval = {
      ...request,
      invocationId: request.invocationId ?? request.id,
      contextHash: buildMcpApprovalContextHash(request),
      input: request.input ?? null,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + timeoutMs),
      decision,
      resolve,
      timer: setTimeout(() => this.finish(request.id, "timed-out", "timeout"), timeoutMs),
    }
    this.pending.set(request.id, pending)
    try {
      this.coordinator?.publish(snapshot(pending))
    } catch {
      this.finish(request.id, "cancelled", "cancellation")
      return { pending: null, decision }
    }
    if (this.coordinator) this.pollDecision(request.id)
    return { pending: snapshot(pending), decision }
  }

  approve(id: string, options: { grantSession?: boolean } = {}): boolean {
    const pending = this.pending.get(id)
    if (!pending) return false

    // A Tier 3 approval is still valid, but it can never create a reusable grant.
    if (options.grantSession && pending.tier !== 3) this.addSessionGrant(pending)
    return this.finish(id, "approved", "user")
  }

  deny(id: string): boolean {
    return this.finish(id, "denied", "user")
  }

  cancel(id: string): boolean {
    return this.finish(id, "cancelled", "cancellation")
  }

  shutdown(): void {
    if (this.stopped) return
    this.stopped = true
    for (const id of [...this.pending.keys()]) this.finish(id, "shutdown", "shutdown")
    this.grants.clear()
  }

  revokeSession(chatId: string, runId?: string): void {
    if (runId === undefined) {
      this.revokeChat(chatId)
      return
    }
    for (const [key, grant] of this.grants) {
      if (grant.chatId === chatId && grant.runId === runId) this.grants.delete(key)
    }
    for (const pending of [...this.pending.values()]) {
      if (pending.caller.chatId === chatId && pending.caller.runId === runId)
        this.cancel(pending.id)
    }
  }

  revokeChat(chatId: string): void {
    for (const [key, grant] of this.grants) {
      if (grant.chatId === chatId) this.grants.delete(key)
    }
    for (const pending of [...this.pending.values()]) {
      if (pending.caller.chatId === chatId) this.cancel(pending.id)
    }
  }

  listPending(): McpPendingApproval[] {
    return [...this.pending.values()].map(snapshot)
  }

  hasSessionGrant(request: Pick<McpApprovalRequest, "caller" | "toolName" | "tier">): boolean {
    if (request.tier === 3) return false
    return this.grants.has(
      grantKey(request.caller.chatId, request.caller.runId, request.toolName, request.tier),
    )
  }

  private addSessionGrant(pending: PendingApproval): void {
    const tier = pending.tier as Exclude<McpRiskTier, 3>
    this.grants.set(grantKey(pending.caller.chatId, pending.caller.runId, pending.toolName, tier), {
      chatId: pending.caller.chatId,
      runId: pending.caller.runId,
      toolName: pending.toolName,
      tier,
    })
  }

  private finish(
    id: string,
    state: McpApprovalTerminalState,
    source: McpApprovalDecision["source"],
  ): boolean {
    const pending = this.pending.get(id)
    if (!pending) return false
    this.pending.delete(id)
    clearTimeout(pending.timer)
    pending.resolve({ id, state, source })
    try {
      this.onPendingChanged?.()
    } catch {
      // Approval settlement must not fail because renderer notification failed.
    }
    return true
  }

  private pollDecision(id: string): void {
    const pending = this.pending.get(id)
    if (!pending || this.stopped || !this.coordinator) return
    let decision: ReturnType<McpApprovalCoordinator["readDecision"]> = null
    try {
      decision = this.coordinator.readDecision(snapshot(pending))
    } catch {
      // A short SQLite lock must not crash the harness child. Retry until the
      // request's own bounded timeout closes it safely.
    }
    if (decision) {
      if (decision.decision === "approve") this.approve(id, { grantSession: decision.grantSession })
      else this.deny(id)
      return
    }
    setTimeout(() => this.pollDecision(id), 100).unref?.()
  }
}

function settled(
  id: string,
  state: McpApprovalTerminalState,
  source: McpApprovalDecision["source"],
): McpApprovalWait {
  return { pending: null, decision: Promise.resolve({ id, state, source }) }
}

function snapshot(pending: McpPendingApproval): McpPendingApproval {
  const { id, invocationId, contextHash, caller, toolName, tier, createdAt, expiresAt, input } =
    pending
  return {
    id,
    invocationId,
    contextHash,
    caller: { ...caller },
    toolName,
    tier,
    createdAt,
    expiresAt,
    input,
  }
}

export function buildMcpApprovalContextHash(
  request: Pick<McpApprovalRequest, "caller" | "toolName" | "tier" | "input">,
): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        caller: { chatId: request.caller.chatId, runId: request.caller.runId ?? null },
        toolName: request.toolName,
        tier: request.tier,
        input: request.input ?? null,
      }),
    )
    .digest("hex")
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return JSON.stringify("[UNDEFINED]")
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`
}

function grantKey(
  chatId: string,
  runId: string | undefined,
  toolName: string,
  tier: Exclude<McpRiskTier, 3>,
): string {
  return `${chatId}\u0000${runId ?? ""}\u0000${toolName}\u0000${tier}`
}
