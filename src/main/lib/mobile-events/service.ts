import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { and, asc, eq, gt, lte, sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import {
  MOBILE_CONTROL_PROTOCOL_VERSION,
  mobileControlLimits,
  mobileEventEnvelopeSchema,
  mobileCommandEnvelopeSchema,
  mobileSnapshotEnvelopeSchema,
  mobileSnapshotPageRequestSchema,
  mobileSubscribeRequestSchema,
  type MobileAuthorityGrant,
  type MobileEventCursor,
  type MobileEventEnvelope,
  type MobileCommandEnvelope,
  type MobileSession,
  type MobileSnapshotEnvelope,
} from "../../../shared/mobile-control"
import type { ProductMcpRendererInvalidation } from "../../../shared/product-mcp-invalidation"
import type { AgentInputStatusEvent } from "../../../shared/agent-input"
import * as schema from "../db/schema"
import {
  mobileDeviceSessions,
  mobileDevices,
  mobileEventLog,
  mobileEventStreams,
  mobileProjectedResources,
} from "../db/schema"
import type { MobileBridgeTransportSession } from "../mobile-bridge/types"
import type { MobileActionService, MobileActionExecutionResult } from "../mobile-actions"
import { MobileDeviceConnectionRegistry, type MobilePairingService } from "../mobile-pairing"
import { MobileGrantError, MobileScopeGrantService } from "./grants"
import {
  mobileProjectedKinds,
  MobileSnapshotProjector,
  type MobileProjectedKind,
} from "./projector"

type Database = BetterSQLite3Database<typeof schema>
type EventRow = typeof mobileEventLog.$inferSelect

export type MobileResumeResult =
  | { type: "events"; events: MobileEventEnvelope[] }
  | { type: "snapshot"; snapshot: MobileSnapshotEnvelope }

type PageCursor = {
  snapshotId: string
  kind: MobileProjectedKind
  id: string
  pageSize: number
}

type ActiveConnection = {
  transport: MobileBridgeTransportSession
  session: MobileSession
  grantId: string
  snapshotId: string
  sequence: number
  snapshotPending: boolean
  closed: boolean
  expiryTimer: ReturnType<typeof setTimeout> | null
  commandQueue: Promise<void>
  cleanup: () => void
}

export class MobileEventAuthorizationError extends Error {
  constructor(message = "Mobile event authorization failed.") {
    super(message)
    this.name = "MobileEventAuthorizationError"
  }
}

export class MobileEventService {
  private readonly now: () => number
  private readonly randomId: () => string
  private readonly cursorKey: Buffer
  private readonly backlog: number
  private readonly projector: MobileSnapshotProjector
  private readonly active = new Map<string, ActiveConnection>()

  constructor(
    private readonly options: {
      database: Database
      pairing: MobilePairingService
      grants: MobileScopeGrantService
      connections: MobileDeviceConnectionRegistry
      now?: () => number
      randomId?: () => string
      cursorKey?: Buffer
      eventBacklog?: number
      actions?: MobileActionService
      listAgentInputs?: ConstructorParameters<typeof MobileSnapshotProjector>[2]
    },
  ) {
    this.now = options.now ?? Date.now
    this.randomId = options.randomId ?? randomUUID
    this.cursorKey = options.cursorKey ?? randomBytes(32)
    this.backlog = Math.max(
      1,
      Math.min(
        options.eventBacklog ?? mobileControlLimits.eventBacklog,
        mobileControlLimits.eventBacklog,
      ),
    )
    this.projector = new MobileSnapshotProjector(
      options.database,
      this.now,
      options.listAgentInputs,
    )
  }

  createSnapshot(input: {
    session: MobileSession
    grantId: string
    pageSize?: number
    cursor?: string
  }): MobileSnapshotEnvelope {
    const authorized = this.authorize(input.session, input.grantId)
    const latestSequence = this.latestSequence(input.grantId)
    let snapshotId: string
    let after: { kind: MobileProjectedKind; id: string } | undefined
    let pageSize = boundedPageSize(input.pageSize)
    if (input.cursor) {
      const cursor = this.decodePageCursor(input.cursor)
      if (
        cursor.snapshotId !==
        snapshotIdFor(
          authorized.session.deviceId,
          authorized.grant.grantId,
          authorized.grant.scopeVersion,
          latestSequence,
        )
      )
        throw new MobileEventAuthorizationError("Snapshot cursor is stale or mismatched.")
      snapshotId = cursor.snapshotId
      after = { kind: cursor.kind, id: cursor.id }
      pageSize = cursor.pageSize
    } else {
      snapshotId = snapshotIdFor(
        authorized.session.deviceId,
        authorized.grant.grantId,
        authorized.grant.scopeVersion,
        latestSequence,
      )
    }

    const projected = this.projector.readPage({
      grant: authorized.grant,
      after,
      limit: pageSize + 1,
    })
    const items = projected.slice(0, pageSize)
    this.rememberProjected(authorized.grant.grantId, items)
    const last = items.at(-1)
    const generatedAt = this.now()
    return mobileSnapshotEnvelopeSchema.parse({
      protocolVersion: MOBILE_CONTROL_PROTOCOL_VERSION,
      kind: "snapshot",
      snapshotId,
      scopeVersion: authorized.grant.scopeVersion,
      sequence: latestSequence,
      generatedAt,
      freshUntil: generatedAt + mobileControlLimits.snapshotFreshnessMs,
      items,
      ...(projected.length > pageSize && last
        ? {
            nextCursor: this.encodePageCursor({
              snapshotId,
              kind: last.kind as MobileProjectedKind,
              id: last.id,
              pageSize,
            }),
          }
        : {}),
    })
  }

  resume(input: {
    session: MobileSession
    grantId: string
    cursor: MobileEventCursor
    pageSize?: number
  }): MobileResumeResult {
    const authorized = this.authorize(input.session, input.grantId)
    const freshSnapshot = () =>
      this.createSnapshot({
        session: input.session,
        grantId: input.grantId,
        pageSize: input.pageSize,
      })
    const expectedSnapshotId = snapshotIdFor(
      authorized.session.deviceId,
      authorized.grant.grantId,
      authorized.grant.scopeVersion,
      snapshotBaseSequence(input.cursor.snapshotId),
    )
    if (
      input.cursor.scopeVersion !== authorized.grant.scopeVersion ||
      input.cursor.snapshotId !== expectedSnapshotId
    )
      return { type: "snapshot", snapshot: freshSnapshot() }

    const latest = this.latestSequence(input.grantId)
    if (input.cursor.sequence > latest) return { type: "snapshot", snapshot: freshSnapshot() }
    if (input.cursor.sequence === latest) return { type: "events", events: [] }
    const rows = this.options.database
      .select()
      .from(mobileEventLog)
      .where(
        and(
          eq(mobileEventLog.grantId, input.grantId),
          gt(mobileEventLog.sequence, input.cursor.sequence),
        ),
      )
      .orderBy(asc(mobileEventLog.sequence))
      .limit(mobileControlLimits.eventBacklog)
      .all()
    if (rows[0]?.sequence !== input.cursor.sequence + 1 || rows.at(-1)?.sequence !== latest)
      return { type: "snapshot", snapshot: freshSnapshot() }
    if (rows.some((row) => !row.resourceKind || !row.resourceId))
      return { type: "snapshot", snapshot: freshSnapshot() }
    return {
      type: "events",
      events: rows.map((row) => this.eventFromRow(row, authorized.grant, input.cursor.snapshotId)),
    }
  }

  ingestInvalidation(event: ProductMcpRendererInvalidation): void {
    const refs = invalidationRefs(event)
    if (refs.length === 0) return
    for (const grant of this.options.grants.listActiveGrants()) {
      let forcedResnapshot = false
      for (const ref of refs) {
        if (!this.projector.grantCouldContain(grant, ref.kind)) continue
        if (!ref.id) {
          forcedResnapshot = true
          break
        }
        const projected = this.projector.readResource(grant, ref.kind, ref.id)
        if (projected) {
          this.rememberProjected(grant.grantId, [projected])
          this.appendEvent(grant.grantId, ref)
          continue
        }
        if (this.wasProjected(grant.grantId, ref.kind, ref.id)) {
          this.appendEvent(grant.grantId, ref)
        }
      }
      if (forcedResnapshot) this.appendEvent(grant.grantId, { kind: null, id: null })
    }
    this.pumpAll()
  }

  handleWebSocket = (transport: MobileBridgeTransportSession): void => {
    let connection: ActiveConnection | null = null
    const unsubscribeMessage = transport.onMessage((bytes) => {
      if (!connection) {
        try {
          const request = mobileSubscribeRequestSchema.parse(parseJson(bytes))
          const session = this.options.pairing.authenticateSession(request.proof)
          const grant = this.authorize(session, request.authorityGrantId).grant
          if (
            this.deviceConnectionCount(session.deviceId) >= mobileControlLimits.connectionsPerDevice
          )
            throw new MobileEventAuthorizationError("Device connection limit reached.")

          const initial = request.resume
            ? this.resume({
                session,
                grantId: request.authorityGrantId,
                cursor: request.resume,
                pageSize: request.pageSize,
              })
            : {
                type: "snapshot" as const,
                snapshot: this.createSnapshot({
                  session,
                  grantId: request.authorityGrantId,
                  pageSize: request.pageSize,
                }),
              }
          const snapshotId =
            initial.type === "snapshot" ? initial.snapshot.snapshotId : request.resume!.snapshotId
          const sequence =
            initial.type === "snapshot"
              ? initial.snapshot.sequence
              : (initial.events.at(-1)?.sequence ?? request.resume!.sequence)
          connection = this.registerConnection({
            transport,
            session,
            grant,
            snapshotId,
            sequence,
            snapshotPending: initial.type === "snapshot" && Boolean(initial.snapshot.nextCursor),
          })
          if (initial.type === "snapshot") this.send(connection, initial.snapshot)
          else for (const envelope of initial.events) if (!this.send(connection, envelope)) break
          if (!connection.snapshotPending) this.pump(connection)
        } catch {
          transport.close(1008, "authentication-failed")
        }
        return
      }

      try {
        const value = parseJson(bytes)
        const command = mobileCommandEnvelopeSchema.safeParse(value)
        if (command.success) {
          connection.commandQueue = connection.commandQueue
            .then(() => this.handleCommand(connection!, command.data))
            .catch((error) => {
              console.error("[mobile-events] Command queue failed:", error)
              this.closeConnection(connection!, 1008, "command-failed")
            })
          return
        }
        const request = mobileSnapshotPageRequestSchema.parse(value)
        if (!connection.snapshotPending)
          throw new MobileEventAuthorizationError("Snapshot pagination is not active.")
        const snapshot = this.createSnapshot({
          session: connection.session,
          grantId: connection.grantId,
          cursor: request.cursor,
        })
        connection.snapshotId = snapshot.snapshotId
        connection.sequence = snapshot.sequence
        connection.snapshotPending = Boolean(snapshot.nextCursor)
        this.send(connection, snapshot)
        if (!connection.snapshotPending) this.pump(connection)
      } catch {
        this.closeConnection(connection, 1008, "invalid-snapshot-page")
      }
    })
    transport.onClose(() => {
      unsubscribeMessage()
      connection?.cleanup()
    })
  }

  private async handleCommand(
    connection: ActiveConnection,
    command: MobileCommandEnvelope,
  ): Promise<void> {
    if (connection.closed || connection.snapshotPending || !this.options.actions) {
      this.closeConnection(connection, 1008, "command-unavailable")
      return
    }
    try {
      const grant = this.authorize(connection.session, connection.grantId).grant
      const projected = isProjectedKind(command.target.kind)
        ? this.projector.readResource(grant, command.target.kind, command.target.id)
        : null
      const result = await this.options.actions.execute({
        command,
        session: connection.session,
        grant,
        trustedTarget: projected
          ? { kind: projected.kind, id: projected.id, version: projected.version }
          : null,
        connected: true,
        stepUpVerified: false,
      })
      this.sendActionResult(connection, command, result)
    } catch {
      this.closeConnection(connection, 1008, "command-failed")
    }
  }

  private closeConnection(connection: ActiveConnection, code: number, reason: string): void {
    try {
      connection.transport.close(code, reason)
    } catch (error) {
      console.error(`[mobile-events] Transport close failed (${reason}):`, error)
    } finally {
      try {
        connection.cleanup()
      } catch (error) {
        console.error(`[mobile-events] Connection cleanup failed (${reason}):`, error)
      }
    }
  }

  stop(reason = "mobile-events-stopped"): void {
    for (const connection of [...this.active.values()]) {
      connection.transport.close(1001, reason)
      connection.cleanup()
    }
  }

  private authorize(
    session: MobileSession,
    grantId: string,
  ): {
    session: MobileSession
    grant: MobileAuthorityGrant
  } {
    const now = this.now()
    const storedSession = this.options.database
      .select()
      .from(mobileDeviceSessions)
      .where(eq(mobileDeviceSessions.id, session.sessionId))
      .get()
    const device = this.options.database
      .select()
      .from(mobileDevices)
      .where(eq(mobileDevices.id, session.deviceId))
      .get()
    if (
      !storedSession ||
      !device ||
      device.revokedAt ||
      storedSession.revokedAt ||
      storedSession.deviceId !== session.deviceId ||
      storedSession.rotation !== session.rotation ||
      storedSession.idleExpiresAt.getTime() <= now ||
      storedSession.absoluteExpiresAt.getTime() <= now
    )
      throw new MobileEventAuthorizationError()
    let grant: MobileAuthorityGrant
    try {
      grant = this.options.grants.requireActiveGrant(grantId, session.deviceId, device.scopeVersion)
    } catch (error) {
      if (error instanceof MobileGrantError) throw new MobileEventAuthorizationError()
      throw error
    }
    if (
      storedSession.scopeVersion !== device.scopeVersion ||
      session.scopeVersion !== device.scopeVersion ||
      grant.scopeVersion !== device.scopeVersion
    )
      throw new MobileEventAuthorizationError("Mobile authority scope changed.")
    return { session, grant }
  }

  private appendEvent(
    grantId: string,
    ref: { kind: MobileProjectedKind | null; id: string | null },
  ): { sequence: number; eventId: string; occurredAt: number } {
    const now = toDate(this.now())
    return this.options.database.transaction((tx) => {
      const stream = tx
        .insert(mobileEventStreams)
        .values({ grantId, lastSequence: 1, updatedAt: now })
        .onConflictDoUpdate({
          target: mobileEventStreams.grantId,
          set: {
            lastSequence: sql`${mobileEventStreams.lastSequence} + 1`,
            updatedAt: now,
          },
        })
        .returning({ sequence: mobileEventStreams.lastSequence })
        .get()
      if (!stream || stream.sequence > Number.MAX_SAFE_INTEGER)
        throw new Error("Mobile event sequence exhausted.")
      const eventId = this.randomId()
      tx.insert(mobileEventLog)
        .values({
          grantId,
          sequence: stream.sequence,
          eventId,
          resourceKind: ref.kind,
          resourceId: ref.id,
          occurredAt: now,
        })
        .run()
      tx.delete(mobileEventLog)
        .where(
          and(
            eq(mobileEventLog.grantId, grantId),
            lte(mobileEventLog.sequence, stream.sequence - this.backlog),
          ),
        )
        .run()
      return { sequence: stream.sequence, eventId, occurredAt: now.getTime() }
    })
  }

  private sendActionResult(
    connection: ActiveConnection,
    command: MobileCommandEnvelope,
    result: MobileActionExecutionResult,
  ): void {
    this.pump(connection)
    if (connection.closed) return
    const persisted = this.appendEvent(connection.grantId, {
      kind: isProjectedKind(command.target.kind) ? command.target.kind : null,
      id: command.target.id,
    })
    const envelope = mobileEventEnvelopeSchema.parse({
      protocolVersion: MOBILE_CONTROL_PROTOCOL_VERSION,
      kind: "event",
      eventId: persisted.eventId,
      snapshotId: connection.snapshotId,
      scopeVersion: connection.session.scopeVersion,
      sequence: persisted.sequence,
      occurredAt: persisted.occurredAt,
      payload: {
        type: "action.result",
        commandId: result.commandId,
        action: result.action,
        status: result.status,
        ...(result.summary ? { summary: result.summary } : {}),
      },
    })
    if (this.send(connection, envelope)) connection.sequence = persisted.sequence
    this.pumpAll()
  }

  ingestAgentInputStatus(event: AgentInputStatusEvent): void {
    for (const grant of this.options.grants.listActiveGrants()) {
      if (!this.projector.grantCouldContain(grant, "agent-input")) continue
      const projected = this.projector.readResource(grant, "agent-input", event.requestId)
      if (projected) {
        this.rememberProjected(grant.grantId, [projected])
        this.appendEvent(grant.grantId, { kind: "agent-input", id: event.requestId })
      } else if (this.wasProjected(grant.grantId, "agent-input", event.requestId)) {
        this.appendEvent(grant.grantId, { kind: "agent-input", id: event.requestId })
      }
    }
    this.pumpAll()
  }

  private eventFromRow(
    row: EventRow,
    grant: MobileAuthorityGrant,
    snapshotId: string,
  ): MobileEventEnvelope {
    const kind = row.resourceKind as MobileProjectedKind | null
    const projected =
      kind && row.resourceId ? this.projector.readResource(grant, kind, row.resourceId) : null
    if (kind && row.resourceId && !projected)
      this.forgetProjected(row.grantId, kind, row.resourceId)
    return mobileEventEnvelopeSchema.parse({
      protocolVersion: MOBILE_CONTROL_PROTOCOL_VERSION,
      kind: "event",
      eventId: row.eventId,
      snapshotId,
      scopeVersion: grant.scopeVersion,
      sequence: row.sequence,
      occurredAt: row.occurredAt.getTime(),
      payload:
        !kind || !row.resourceId
          ? { type: "resnapshot.required", reason: "Authorized state changed." }
          : projected
            ? { type: "entity.upsert", item: projected }
            : { type: "entity.remove", resource: { kind, id: row.resourceId } },
    })
  }

  private latestSequence(grantId: string): number {
    return (
      this.options.database
        .select({ sequence: mobileEventStreams.lastSequence })
        .from(mobileEventStreams)
        .where(eq(mobileEventStreams.grantId, grantId))
        .get()?.sequence ?? 0
    )
  }

  private rememberProjected(grantId: string, items: Array<{ kind: string; id: string }>): void {
    const projectedAt = toDate(this.now())
    this.options.database.transaction((tx) => {
      for (const item of items) {
        if (!isProjectedKind(item.kind)) continue
        tx.insert(mobileProjectedResources)
          .values({
            grantId,
            resourceKind: item.kind,
            resourceId: item.id,
            projectedAt,
          })
          .onConflictDoUpdate({
            target: [
              mobileProjectedResources.grantId,
              mobileProjectedResources.resourceKind,
              mobileProjectedResources.resourceId,
            ],
            set: { projectedAt },
          })
          .run()
      }
    })
  }

  private wasProjected(grantId: string, kind: MobileProjectedKind, id: string): boolean {
    return Boolean(
      this.options.database
        .select({ id: mobileProjectedResources.resourceId })
        .from(mobileProjectedResources)
        .where(
          and(
            eq(mobileProjectedResources.grantId, grantId),
            eq(mobileProjectedResources.resourceKind, kind),
            eq(mobileProjectedResources.resourceId, id),
          ),
        )
        .get(),
    )
  }

  private forgetProjected(grantId: string, kind: MobileProjectedKind, id: string): void {
    this.options.database
      .delete(mobileProjectedResources)
      .where(
        and(
          eq(mobileProjectedResources.grantId, grantId),
          eq(mobileProjectedResources.resourceKind, kind),
          eq(mobileProjectedResources.resourceId, id),
        ),
      )
      .run()
  }

  private registerConnection(input: {
    transport: MobileBridgeTransportSession
    session: MobileSession
    grant: MobileAuthorityGrant
    snapshotId: string
    sequence: number
    snapshotPending: boolean
  }): ActiveConnection {
    let unregister: () => void = () => undefined
    const connection: ActiveConnection = {
      transport: input.transport,
      session: input.session,
      grantId: input.grant.grantId,
      snapshotId: input.snapshotId,
      sequence: input.sequence,
      snapshotPending: input.snapshotPending,
      closed: false,
      expiryTimer: null,
      commandQueue: Promise.resolve(),
      cleanup: () => {
        if (connection.closed) return
        connection.closed = true
        if (connection.expiryTimer) clearTimeout(connection.expiryTimer)
        connection.expiryTimer = null
        this.active.delete(connection.transport.id)
        unregister()
      },
    }
    unregister = this.options.connections.register(
      input.session.deviceId,
      input.transport.id,
      (reason) => {
        input.transport.close(1008, reason)
        connection.cleanup()
      },
    )
    const expiresAt = Math.min(
      input.session.idleExpiresAt,
      input.session.absoluteExpiresAt,
      input.grant.expiresAt ?? Number.MAX_SAFE_INTEGER,
    )
    connection.expiryTimer = setTimeout(
      () => {
        input.transport.close(1008, "authorization-expired")
        connection.cleanup()
      },
      Math.max(0, expiresAt - this.now()),
    )
    connection.expiryTimer.unref?.()
    this.active.set(input.transport.id, connection)
    return connection
  }

  private pumpAll(): void {
    for (const connection of this.active.values()) this.pump(connection)
  }

  private pump(connection: ActiveConnection): void {
    if (connection.closed || connection.snapshotPending) return
    let grant: MobileAuthorityGrant
    try {
      grant = this.authorize(connection.session, connection.grantId).grant
    } catch {
      connection.transport.close(1008, "authorization-changed")
      connection.cleanup()
      return
    }
    while (!connection.closed) {
      const rows = this.options.database
        .select()
        .from(mobileEventLog)
        .where(
          and(
            eq(mobileEventLog.grantId, connection.grantId),
            gt(mobileEventLog.sequence, connection.sequence),
          ),
        )
        .orderBy(asc(mobileEventLog.sequence))
        .limit(mobileControlLimits.eventBatchItems)
        .all()
      if (rows.length === 0) return
      if (rows[0].sequence !== connection.sequence + 1) {
        connection.transport.close(1012, "resnapshot-required")
        connection.cleanup()
        return
      }
      for (const row of rows) {
        const envelope = this.eventFromRow(row, grant, connection.snapshotId)
        if (!this.send(connection, envelope)) return
        connection.sequence = row.sequence
        if (envelope.payload.type === "resnapshot.required") {
          connection.transport.close(1012, "resnapshot-required")
          connection.cleanup()
          return
        }
      }
    }
  }

  private send(
    connection: ActiveConnection,
    envelope: MobileSnapshotEnvelope | MobileEventEnvelope,
  ): boolean {
    if (connection.closed) return false
    if (!connection.transport.send(JSON.stringify(envelope))) {
      connection.transport.close(1013, "client-too-slow")
      connection.cleanup()
      return false
    }
    return true
  }

  private deviceConnectionCount(deviceId: string): number {
    return [...this.active.values()].filter(
      (connection) => !connection.closed && connection.session.deviceId === deviceId,
    ).length
  }

  private encodePageCursor(cursor: PageCursor): string {
    const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url")
    const signature = createHmac("sha256", this.cursorKey).update(payload).digest("base64url")
    return `${payload}.${signature}`
  }

  private decodePageCursor(value: string): PageCursor {
    const [payload, signature, extra] = value.split(".")
    if (!payload || !signature || extra)
      throw new MobileEventAuthorizationError("Snapshot cursor is invalid.")
    const expected = createHmac("sha256", this.cursorKey).update(payload).digest()
    const actual = Buffer.from(signature, "base64url")
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new MobileEventAuthorizationError("Snapshot cursor is invalid.")
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PageCursor
    if (
      !parsed ||
      typeof parsed.snapshotId !== "string" ||
      !mobileProjectedKinds.includes(parsed.kind) ||
      typeof parsed.id !== "string" ||
      !Number.isInteger(parsed.pageSize) ||
      parsed.pageSize < 1 ||
      parsed.pageSize > mobileControlLimits.snapshotPageSize
    )
      throw new MobileEventAuthorizationError("Snapshot cursor is invalid.")
    return parsed
  }
}

function isProjectedKind(value: string): value is MobileProjectedKind {
  return mobileProjectedKinds.includes(value as MobileProjectedKind)
}

function invalidationRefs(
  event: ProductMcpRendererInvalidation,
): Array<{ kind: MobileProjectedKind; id: string | null }> {
  const mapping: Array<{
    domain: ProductMcpRendererInvalidation["domains"][number]
    kind: MobileProjectedKind
    ids: string[] | undefined
  }> = [
    { domain: "projects", kind: "project", ids: event.projectIds },
    { domain: "tasks", kind: "task", ids: event.taskIds },
    { domain: "chats", kind: "chat", ids: event.chatIds },
    { domain: "runs", kind: "run", ids: event.runIds },
    { domain: "runs", kind: "diff", ids: event.runIds },
    { domain: "runs", kind: "check", ids: event.runIds },
    { domain: "orchestrations", kind: "orchestration", ids: event.taskIds },
    { domain: "automations", kind: "automation", ids: event.automationIds },
    { domain: "approvals", kind: "approval", ids: undefined },
    { domain: "attachments", kind: "artifact", ids: undefined },
  ]
  const seen = new Set<string>()
  const refs: Array<{ kind: MobileProjectedKind; id: string | null }> = []
  for (const entry of mapping) {
    if (!event.domains.includes(entry.domain)) continue
    const ids = entry.ids && entry.ids.length > 0 ? entry.ids : [null]
    for (const id of ids) {
      const key = `${entry.kind}:${id ?? "*"}`
      if (seen.has(key)) continue
      seen.add(key)
      refs.push({ kind: entry.kind, id })
    }
  }
  return refs
}

function snapshotIdFor(
  deviceId: string,
  grantId: string,
  scopeVersion: number,
  sequence: number,
): string {
  const digest = createHash("sha256")
    .update(`${deviceId}\0${grantId}\0${scopeVersion}\0${sequence}`)
    .digest("hex")
    .slice(0, 32)
  return `m1.${sequence.toString(36)}.${digest}`
}

function snapshotBaseSequence(snapshotId: string): number {
  const match = /^m1\.([0-9a-z]+)\.[a-f0-9]{32}$/.exec(snapshotId)
  if (!match) return -1
  const sequence = Number.parseInt(match[1], 36)
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : -1
}

function boundedPageSize(value: number | undefined): number {
  return Math.max(
    1,
    Math.min(value ?? mobileControlLimits.snapshotPageSize, mobileControlLimits.snapshotPageSize),
  )
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

function toDate(milliseconds: number): Date {
  return new Date(Math.floor(milliseconds / 1_000) * 1_000)
}
