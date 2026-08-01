import { createHash, randomBytes, randomUUID } from "node:crypto"
import { count } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import {
  MobileReplayWindow,
  authorizeMobileCommand,
  mobileControlLimits,
  mobileCommandEnvelopeSchema,
  type MobileActionId,
  type MobileAuthorityGrant,
  type MobileCommandEnvelope,
  type MobileDeviceRecord,
  type MobileSession,
  type MobileTrustedTarget,
} from "../../../shared/mobile-control"
import { agentInputLifecycle } from "../agent-input/service"
import { createAgentOrchestrationService } from "../agent-orchestration/service"
import { AutomationExecutionService } from "../automation/execution"
import * as schema from "../db/schema"
import { mobileDeviceAuditRecords } from "../db/schema"
import { openAppDatabase } from "../db/access"
import { decideMcpApproval } from "../mcp-control/approval-coordinator"
import type { MobilePairingService } from "../mobile-pairing"

type Database = BetterSQLite3Database<typeof schema>

export type MobileActionDispatchers = {
  answerClarification(
    requestId: string,
    answers: Record<string, string[]>,
  ): boolean | Promise<boolean>
  steerRun(runId: string, message: string): boolean | Promise<boolean>
  controlRun(runId: string, action: "pause" | "resume" | "cancel"): unknown | Promise<unknown>
  controlOrchestration(
    orchestrationId: string,
    action: "pause" | "resume" | "stop",
  ): unknown | Promise<unknown>
  controlAutomation(
    automationId: string,
    action: "pause" | "resume" | "cancel",
  ): unknown | Promise<unknown>
  decideApproval(approvalId: string, decision: "approve" | "deny"): boolean | Promise<boolean>
}

export type MobileActionExecutionResult = {
  commandId: string
  action: MobileActionId
  status: "completed" | "denied" | "stale" | "failed"
  summary?: string
}

export class MobileActionService {
  private readonly now: () => number
  private readonly randomId: () => string
  private readonly replay = new MobileReplayWindow()
  private readonly commandTimes = new Map<string, number[]>()

  constructor(
    private readonly options: {
      database: Database
      pairing: MobilePairingService
      bridgeEnabled: () => boolean
      dispatch: MobileActionDispatchers
      verifyStepUp?: (command: MobileCommandEnvelope) => boolean
      now?: () => number
      randomId?: () => string
    },
  ) {
    this.now = options.now ?? Date.now
    this.randomId = options.randomId ?? randomUUID
  }

  async execute(input: {
    command: MobileCommandEnvelope
    session: MobileSession
    grant: MobileAuthorityGrant
    trustedTarget: MobileTrustedTarget | null
    connected: boolean
    stepUpVerified: boolean
  }): Promise<MobileActionExecutionResult> {
    const command = mobileCommandEnvelopeSchema.parse(input.command)
    const device = this.requireDevice(command.deviceId)
    if (!input.trustedTarget) {
      const result = actionResult(command, "stale", "stale-target")
      this.audit(device.deviceId, command, result)
      return result
    }
    const authorized = authorizeMobileCommand(command, {
      now: this.now(),
      connected: input.connected,
      bridgeEnabled: this.options.bridgeEnabled(),
      device,
      session: input.session,
      grant: input.grant,
      trustedTarget: input.trustedTarget,
      trustedTargetIsGranted: true,
      enabledActions: input.grant.capabilities,
      stepUpVerified:
        input.stepUpVerified ||
        Boolean(command.stepUpToken && this.options.verifyStepUp?.(command)),
      replay: this.replay,
    })
    if (!authorized.ok) {
      const status = authorized.error.code.startsWith("stale-") ? "stale" : "denied"
      const result = actionResult(command, status, authorized.error.code)
      this.audit(device.deviceId, command, result)
      return result
    }
    if (!this.acceptCommandRate(device.deviceId, input.session.sessionId)) {
      const result = actionResult(command, "denied", "rate-limited")
      this.audit(device.deviceId, command, result)
      return result
    }
    if (
      command.action.type === "clarification.answer" &&
      command.action.requestId !== command.target.id
    ) {
      const result = actionResult(command, "denied", "out-of-scope")
      this.audit(device.deviceId, command, result)
      return result
    }

    try {
      const dispatched = await this.dispatch(command)
      const result = dispatched
        ? actionResult(command, "completed")
        : actionResult(command, "stale", "target-unavailable")
      this.audit(device.deviceId, command, result)
      return result
    } catch (error) {
      const status = isStaleDispatchFailure(error) ? "stale" : "failed"
      const result = actionResult(command, status, status === "stale" ? "target-stale" : "failed")
      this.audit(device.deviceId, command, result)
      return result
    }
  }

  private requireDevice(deviceId: string): MobileDeviceRecord {
    const device = this.options.pairing
      .listDevices()
      .find((candidate) => candidate.deviceId === deviceId)
    if (!device) throw new Error("Mobile action device is unavailable.")
    return device
  }

  private acceptCommandRate(deviceId: string, sessionId: string): boolean {
    const now = this.now()
    const cutoff = now - 60_000
    const key = `${deviceId}\u0000${sessionId}`
    const recent = (this.commandTimes.get(key) ?? []).filter((timestamp) => timestamp > cutoff)
    if (recent.length >= mobileControlLimits.commandsPerMinute) {
      this.commandTimes.delete(key)
      this.commandTimes.set(key, recent)
      return false
    }
    recent.push(now)
    this.commandTimes.delete(key)
    this.commandTimes.set(key, recent)
    while (this.commandTimes.size > mobileControlLimits.replayEntries) {
      const oldest = this.commandTimes.keys().next().value as string | undefined
      if (!oldest) break
      this.commandTimes.delete(oldest)
    }
    return true
  }

  private async dispatch(command: MobileCommandEnvelope): Promise<boolean> {
    switch (command.action.type) {
      case "clarification.answer":
        return this.options.dispatch.answerClarification(
          command.action.requestId,
          command.action.answers,
        )
      case "run.steer":
        return this.options.dispatch.steerRun(command.target.id, command.action.message)
      case "run.pause":
        return (await this.options.dispatch.controlRun(command.target.id, "pause")) !== false
      case "run.resume":
        return (await this.options.dispatch.controlRun(command.target.id, "resume")) !== false
      case "run.cancel":
        return (await this.options.dispatch.controlRun(command.target.id, "cancel")) !== false
      case "orchestration.pause":
        await this.options.dispatch.controlOrchestration(command.target.id, "pause")
        return true
      case "orchestration.resume":
        await this.options.dispatch.controlOrchestration(command.target.id, "resume")
        return true
      case "orchestration.cancel":
        await this.options.dispatch.controlOrchestration(command.target.id, "stop")
        return true
      case "automation.pause":
        return (await this.options.dispatch.controlAutomation(command.target.id, "pause")) !== false
      case "automation.resume":
        return (
          (await this.options.dispatch.controlAutomation(command.target.id, "resume")) !== false
        )
      case "automation.cancel":
        return (
          (await this.options.dispatch.controlAutomation(command.target.id, "cancel")) !== false
        )
      case "approval.approve":
        return this.options.dispatch.decideApproval(command.target.id, "approve")
      case "approval.deny":
        return this.options.dispatch.decideApproval(command.target.id, "deny")
    }
  }

  private audit(
    deviceId: string,
    command: MobileCommandEnvelope,
    result: MobileActionExecutionResult,
  ): void {
    const total =
      this.options.database.select({ value: count() }).from(mobileDeviceAuditRecords).get()
        ?.value ?? 0
    if (total >= mobileControlLimits.auditEntries) return
    this.options.database
      .insert(mobileDeviceAuditRecords)
      .values({
        id: this.randomId(),
        deviceId,
        event: "mobile-action",
        outcome:
          result.status === "completed"
            ? "allowed"
            : result.status === "failed"
              ? "failed"
              : "denied",
        summary: JSON.stringify({
          commandId: command.commandId,
          action: command.action.type,
          targetKind: command.target.kind,
          targetId: command.target.id,
          status: result.status,
          ...(result.summary ? { reason: result.summary } : {}),
        }),
        createdAt: toDate(this.now()),
      })
      .run()
  }
}

export function createProductionMobileActionDispatchers(
  database: Database,
  databasePath: string,
): MobileActionDispatchers {
  const automation = new AutomationExecutionService(databasePath)
  return {
    answerClarification(requestId, answers) {
      return agentInputLifecycle.answer({
        requestId,
        mode: "structured",
        answers,
        submittedAt: Date.now(),
      })
    },
    async steerRun(runId, message) {
      const sqlite = openAppDatabase(databasePath, { readonly: true })
      let row: Record<string, unknown> | undefined
      try {
        row = sqlite
          .prepare(
            `SELECT o.*, a.id AS target_agent_id
             FROM orchestration_agents a
             JOIN task_orchestrations o ON o.task_id = a.task_id
             WHERE a.run_id = ? LIMIT 1`,
          )
          .get(runId) as Record<string, unknown> | undefined
      } finally {
        sqlite.close()
      }
      if (!row) return false
      const { interpretCoordinationEngineSnapshot } =
        await import("../agent-orchestration/coordination-engine")
      const snapshot = interpretCoordinationEngineSnapshot(row)
      if (
        snapshot.engine === "workflow" ||
        !snapshot.providerIdentity ||
        snapshot.capabilities.status !== "available"
      )
        return false
      const { getCodexCoordination } = await import("../agent-orchestration/operations-runtime")
      const result = await getCodexCoordination(snapshot.engine).execute(
        {
          orchestrationId: String(row.task_id),
          snapshot,
          signal: new AbortController().signal,
        },
        {
          schemaVersion: 1,
          kind: "send",
          orchestrationId: String(row.task_id),
          providerIdentity: snapshot.providerIdentity,
          targetAgentId: String(row.target_agent_id),
          message,
        },
      )
      return result.ok
    },
    async controlRun(runId, action) {
      const { getMainRuntimeLaunchService } = await import("../main-run-launcher")
      const runtime = getMainRuntimeLaunchService(databasePath)
      if (action === "pause") return runtime.pause(runId)
      if (action === "resume") return runtime.resume(runId)
      return runtime.cancel(runId, "mobile-device-cancelled")
    },
    controlOrchestration(orchestrationId, action) {
      return createAgentOrchestrationService(databasePath).control(orchestrationId, action)
    },
    async controlAutomation(automationId, action) {
      if (action === "pause") return automation.pause(automationId)
      if (action === "resume") return automation.resume(automationId)
      const sqlite = openAppDatabase(databasePath, { readonly: true })
      let occurrenceIds: string[]
      try {
        occurrenceIds = (
          sqlite
            .prepare(
              `SELECT id FROM automation_occurrences
               WHERE automation_id = ? AND state IN ('pending','leased','running')
               ORDER BY id`,
            )
            .all(automationId) as Array<{ id: string }>
        ).map((row) => row.id)
      } finally {
        sqlite.close()
      }
      const paused = automation.pause(automationId)
      const { createAutomationExecutionRuntime } = await import("../automation/runtime")
      const execution = createAutomationExecutionRuntime(databasePath)
      const stopped = await Promise.allSettled(
        occurrenceIds.map((occurrenceId) => execution.kill(occurrenceId)),
      )
      return paused || stopped.some((result) => result.status === "fulfilled" && result.value)
    },
    decideApproval(approvalId, decision) {
      return decideMcpApproval(database, {
        id: approvalId,
        decision,
        grantSession: false,
      })
    },
  }
}

type StepUpGrant = {
  deviceId: string
  action: MobileActionId
  targetKind: string
  targetId: string
  targetVersion: number
  expiresAt: number
}

export class MobileStepUpTokenService {
  private readonly grants = new Map<string, StepUpGrant>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly randomToken: () => string = () => randomBytes(32).toString("base64url"),
  ) {}

  issue(input: StepUpGrant): { token: string; expiresAt: number } {
    const expiresAt = Math.min(input.expiresAt, this.now() + 2 * 60_000)
    if (expiresAt <= this.now()) throw new Error("Step-up token must expire in the future.")
    const token = this.randomToken()
    this.grants.set(tokenDigest(token), { ...input, expiresAt })
    return { token, expiresAt }
  }

  consume(command: MobileCommandEnvelope): boolean {
    if (!command.stepUpToken) return false
    const key = tokenDigest(command.stepUpToken)
    const grant = this.grants.get(key)
    this.grants.delete(key)
    if (!grant || grant.expiresAt < this.now()) return false
    return (
      grant.deviceId === command.deviceId &&
      grant.action === command.action.type &&
      grant.targetKind === command.target.kind &&
      grant.targetId === command.target.id &&
      grant.targetVersion === command.target.version
    )
  }
}

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

function actionResult(
  command: MobileCommandEnvelope,
  status: MobileActionExecutionResult["status"],
  summary?: string,
): MobileActionExecutionResult {
  return {
    commandId: command.commandId,
    action: command.action.type,
    status,
    ...(summary ? { summary } : {}),
  }
}

function isStaleDispatchFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const code = "code" in error ? String(error.code) : ""
  return code === "stale-target" || code === "conflict"
}

function toDate(milliseconds: number): Date {
  return new Date(Math.floor(milliseconds / 1_000) * 1_000)
}
