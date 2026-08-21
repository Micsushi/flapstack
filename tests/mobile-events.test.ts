import Database from "better-sqlite3"
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { MobileActionService } from "../src/main/lib/mobile-actions"
import {
  MobileEventAuthorizationError,
  MobileEventService,
  MobileScopeGrantService,
} from "../src/main/lib/mobile-events"
import type { MobileBridgeTransportSession } from "../src/main/lib/mobile-bridge"
import {
  MobileDeviceConnectionRegistry,
  MobilePairingService,
  mobileChallengeProofMessage,
  mobileSessionProofMessage,
} from "../src/main/lib/mobile-pairing"
import {
  mobileControlLimits,
  type MobileAuthorityGrant,
  type MobileChallengeProof,
  type MobileSession,
  type MobileSessionCredential,
  type MobileSessionProof,
} from "../src/shared/mobile-control"
import type { AgentInputRequest } from "../src/shared/agent-input"
import { testCoordinationEngineSnapshotSqlValues } from "./coordination-engine-test-db"

const migrationsFolder = resolve(process.cwd(), "drizzle")
const now = 1_800_000_000_000
const epochSeconds = Math.floor(now / 1_000)
const fingerprint = `sha256:${"a".repeat(64)}` as const

let sqlite: Database.Database
let database: ReturnType<typeof drizzle<typeof schema>>
let connections: MobileDeviceConnectionRegistry
let pairing: MobilePairingService
let grants: MobileScopeGrantService
let events: MobileEventService
let key: { privateKey: KeyObject; pem: string }
let credential: MobileSessionCredential
let grant: MobileAuthorityGrant
let nonceCounter: number
let pairId: number
let grantId: number
let eventId: number
let pendingAgentInputs: AgentInputRequest[]

beforeEach(async () => {
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder })
  seedProductState(sqlite)
  connections = new MobileDeviceConnectionRegistry()
  pairId = 0
  grantId = 0
  eventId = 0
  pendingAgentInputs = []
  nonceCounter = 0
  pairing = new MobilePairingService({
    database,
    connections,
    now: () => now,
    randomId: () => `pair-${++pairId}`,
    randomSecret: () => `${String(pairId).padStart(4, "0")}${"s".repeat(40)}`,
  })
  grants = new MobileScopeGrantService({
    database,
    connections,
    now: () => now,
    randomId: () => `grant-${++grantId}`,
  })
  events = createEvents()
  key = ed25519Key()
  credential = createCredential(key)
  grant = await grants.createGrant(credential.session.deviceId, grantInput("project", "project-1"))
})

afterEach(() => {
  events.stop()
  sqlite.close()
})

describe("mobile-events", () => {
  it("keeps the canonical mobile migration chain through projection families", () => {
    const journal = JSON.parse(
      readFileSync(resolve(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> }
    expect(journal.entries.find((entry) => entry.idx === 47)).toEqual(
      expect.objectContaining({ tag: "0047_mobile_pairing_identity" }),
    )
    expect(journal.entries.find((entry) => entry.idx === 48)).toEqual(
      expect.objectContaining({ tag: "0048_mobile_sequenced_events" }),
    )
    expect(journal.entries.find((entry) => entry.idx === 50)).toEqual(
      expect.objectContaining({ tag: "0050_mobile_projection_families" }),
    )
    expect(journal.entries.find((entry) => entry.idx === 53)).toEqual(
      expect.objectContaining({ idx: 53, tag: "0053_chat-tags" }),
    )
    expect(tableNames()).toEqual(
      expect.arrayContaining([
        "mobile_authority_grants",
        "mobile_event_streams",
        "mobile_event_log",
        "mobile_projected_resources",
      ]),
    )
  })

  it("projects only exact granted scope across current run, orchestration, and automation state", () => {
    const snapshot = events.createSnapshot({
      session: authenticate(),
      grantId: grant.grantId,
    })
    expect(snapshot.items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      "project:project-1",
      "task:task-1",
      "chat:chat-1",
      "run:run-1",
      "orchestration:task-1",
      "automation:automation-1",
      "approval:approval-1",
      "artifact:artifact-1",
      "diff:run-1",
      "check:run-1",
    ])
    expect(JSON.stringify(snapshot)).not.toContain("project-2")
    expect(JSON.stringify(snapshot)).not.toContain("raw provider")
  })

  it("projects bounded approval, artifact, diff, and check DTO families", () => {
    const snapshot = events.createSnapshot({
      session: authenticate(),
      grantId: grant.grantId,
    })

    expect(snapshot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "approval",
          id: "approval-1",
          chatId: "chat-1",
          runId: "run-1",
          action: "filesystem.write",
          risk: "privileged",
        }),
        expect.objectContaining({
          kind: "artifact",
          id: "artifact-1",
          runId: "run-1",
          mediaType: "image/png",
          sizeBytes: 1234,
        }),
        expect.objectContaining({
          kind: "diff",
          id: "run-1",
          runId: "run-1",
          filesChanged: 1,
          additions: 3,
          deletions: 1,
        }),
        expect.objectContaining({
          kind: "check",
          id: "run-1",
          runId: "run-1",
          status: "running",
        }),
      ]),
    )
    expect(JSON.stringify(snapshot)).not.toContain("secret approval input")
    expect(JSON.stringify(snapshot)).not.toContain("C:/private/source.png")
  })

  it("excludes expired pending approvals from snapshots", () => {
    sqlite
      .prepare("UPDATE mcp_approval_requests SET expires_at = ? WHERE id = 'approval-1'")
      .run(epochSeconds - 1)

    const snapshot = events.createSnapshot({
      session: authenticate(),
      grantId: grant.grantId,
    })

    expect(snapshot.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "approval", id: "approval-1" })]),
    )
  })

  it("honors exact direct grants for artifact, diff, and check DTOs", async () => {
    const direct = await grants.createGrant(credential.session.deviceId, {
      authority: ["control"],
      capabilities: ["orchestration.pause"],
      resources: [
        { kind: "artifact", id: "artifact-1" },
        { kind: "diff", id: "run-1" },
        { kind: "check", id: "run-1" },
      ],
    })
    const snapshot = events.createSnapshot({
      session: authenticate(),
      grantId: direct.grantId,
    })

    expect(snapshot.items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      "artifact:artifact-1",
      "diff:run-1",
      "check:run-1",
    ])
  })

  it("invalidates approval families by resnapshot and run-derived DTOs by exact event", () => {
    const session = authenticate()
    const snapshot = events.createSnapshot({ session, grantId: grant.grantId })
    events.ingestInvalidation({
      version: 1,
      source: "product-mcp",
      domains: ["approvals"],
      chatIds: ["chat-1"],
      runIds: ["run-1"],
    })
    expect(
      events.resume({
        session,
        grantId: grant.grantId,
        cursor: {
          snapshotId: snapshot.snapshotId,
          scopeVersion: snapshot.scopeVersion,
          sequence: snapshot.sequence,
        },
      }).type,
    ).toBe("snapshot")

    const afterApproval = events.createSnapshot({ session, grantId: grant.grantId })
    events.ingestInvalidation(invalidation("runs", { runIds: ["run-1"] }))
    const resumed = events.resume({
      session,
      grantId: grant.grantId,
      cursor: {
        snapshotId: afterApproval.snapshotId,
        scopeVersion: afterApproval.scopeVersion,
        sequence: afterApproval.sequence,
      },
    })
    expect(resumed.type).toBe("events")
    if (resumed.type === "events")
      expect(resumed.events.map((event) => event.payload)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "entity.upsert",
            item: expect.objectContaining({ kind: "run", id: "run-1" }),
          }),
          expect.objectContaining({
            type: "entity.upsert",
            item: expect.objectContaining({ kind: "diff", id: "run-1" }),
          }),
          expect.objectContaining({
            type: "entity.upsert",
            item: expect.objectContaining({ kind: "check", id: "run-1" }),
          }),
        ]),
      )
  })

  it("paginates a stable bounded snapshot with explicit freshness timestamps", () => {
    seedExtraTasks(sqlite, 5)
    const session = authenticate()
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = events.createSnapshot({
        session,
        grantId: grant.grantId,
        pageSize: 2,
        ...(cursor ? { cursor } : {}),
      })
      expect(page.items.length).toBeLessThanOrEqual(2)
      expect(page.freshUntil - page.generatedAt).toBe(30_000)
      seen.push(...page.items.map((item) => `${item.kind}:${item.id}`))
      cursor = page.nextCursor
    } while (cursor)
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toContain("task:task-extra-5")
  })

  it("redacts credential-shaped text and never projects hidden payload columns", () => {
    sqlite
      .prepare("UPDATE projects SET name = ? WHERE id = 'project-1'")
      .run("apiKey=sk-1234567890abcdef")
    sqlite.prepare("UPDATE chats SET name = ? WHERE id = 'chat-1'").run("Bearer eyJ.secret.token")
    const serialized = JSON.stringify(
      events.createSnapshot({ session: authenticate(), grantId: grant.grantId }),
    )
    expect(serialized).toContain("[redacted]")
    expect(serialized).not.toContain("1234567890abcdef")
    expect(serialized).not.toContain("eyJ.secret.token")
    expect(serialized).not.toContain("initialPrompt")
    expect(serialized).not.toContain("actionConfig")
  })

  it("replays durable monotonic events after reconnect and service restart", () => {
    const session = authenticate()
    const snapshot = events.createSnapshot({ session, grantId: grant.grantId })
    events.ingestInvalidation(invalidation("runs", { runIds: ["run-1"] }))
    events.stop()
    events = createEvents()
    const resumed = events.resume({
      session,
      grantId: grant.grantId,
      cursor: {
        snapshotId: snapshot.snapshotId,
        scopeVersion: snapshot.scopeVersion,
        sequence: snapshot.sequence,
      },
    })
    expect(resumed.type).toBe("events")
    if (resumed.type === "events") {
      expect(resumed.events).toHaveLength(3)
      expect(resumed.events.map((event) => event.sequence)).toEqual([1, 2, 3])
      expect(resumed.events.map((event) => event.payload)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "entity.upsert",
            item: expect.objectContaining({ kind: "run", id: "run-1" }),
          }),
          expect.objectContaining({
            type: "entity.upsert",
            item: expect.objectContaining({ kind: "diff", id: "run-1" }),
          }),
          expect.objectContaining({
            type: "entity.upsert",
            item: expect.objectContaining({ kind: "check", id: "run-1" }),
          }),
        ]),
      )
    }
  })

  it("emits an exact removal for a previously projected deleted descendant", () => {
    const session = authenticate()
    const snapshot = events.createSnapshot({ session, grantId: grant.grantId })
    sqlite.prepare("DELETE FROM agent_runs WHERE id = 'run-1'").run()
    events.ingestInvalidation(invalidation("runs", { runIds: ["run-1"] }))
    const resumed = events.resume({
      session,
      grantId: grant.grantId,
      cursor: {
        snapshotId: snapshot.snapshotId,
        scopeVersion: snapshot.scopeVersion,
        sequence: snapshot.sequence,
      },
    })
    expect(resumed.type).toBe("events")
    if (resumed.type === "events")
      expect(resumed.events[0]).toMatchObject({
        sequence: 1,
        payload: { type: "entity.remove", resource: { kind: "run", id: "run-1" } },
      })
  })

  it("emits a removal when a projected descendant moves outside the granted scope", () => {
    const session = authenticate()
    const snapshot = events.createSnapshot({ session, grantId: grant.grantId })
    expect(snapshot.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "task", id: "task-1" })]),
    )

    sqlite.prepare("UPDATE tasks SET project_id = 'project-2' WHERE id = 'task-1'").run()
    events.ingestInvalidation(invalidation("tasks", { taskIds: ["task-1"] }))
    const resumed = events.resume({
      session,
      grantId: grant.grantId,
      cursor: {
        snapshotId: snapshot.snapshotId,
        scopeVersion: snapshot.scopeVersion,
        sequence: snapshot.sequence,
      },
    })

    expect(resumed.type).toBe("events")
    if (resumed.type === "events")
      expect(resumed.events[0]).toMatchObject({
        payload: { type: "entity.remove", resource: { kind: "task", id: "task-1" } },
      })
  })

  it("detects a pruned resume gap and forces a fresh snapshot", () => {
    events.stop()
    events = createEvents(2)
    const session = authenticate()
    const snapshot = events.createSnapshot({ session, grantId: grant.grantId })
    for (let index = 0; index < 3; index += 1)
      events.ingestInvalidation(invalidation("runs", { runIds: ["run-1"] }))
    const resumed = events.resume({
      session,
      grantId: grant.grantId,
      cursor: {
        snapshotId: snapshot.snapshotId,
        scopeVersion: snapshot.scopeVersion,
        sequence: snapshot.sequence,
      },
    })
    expect(resumed.type).toBe("snapshot")
    if (resumed.type === "snapshot") expect(resumed.snapshot.sequence).toBe(9)
  })

  it("authenticates WebSocket resume and streams the next sequenced event", () => {
    const first = new FakeTransport("socket-1")
    events.handleWebSocket(first)
    first.receive(subscribeProof())
    const snapshot = JSON.parse(first.sent[0]) as {
      kind: string
      snapshotId: string
      scopeVersion: number
      sequence: number
    }
    expect(snapshot.kind).toBe("snapshot")
    first.close()

    events.ingestInvalidation(invalidation("runs", { runIds: ["run-1"] }))
    const reconnect = new FakeTransport("socket-2")
    events.handleWebSocket(reconnect)
    reconnect.receive(
      subscribeProof({
        snapshotId: snapshot.snapshotId,
        scopeVersion: snapshot.scopeVersion,
        sequence: snapshot.sequence,
      }),
    )
    expect(JSON.parse(reconnect.sent[0])).toMatchObject({
      kind: "event",
      sequence: snapshot.sequence + 1,
    })
  })

  it("authorizes, dispatches, audits, and replay-protects typed mobile actions", async () => {
    const dispatch = {
      answerClarification: vi.fn(() => true),
      controlOrchestration: vi.fn(() => ({ status: "paused" })),
      decideApproval: vi.fn(() => true),
    }
    const actions = new MobileActionService({
      database,
      pairing,
      now: () => now,
      bridgeEnabled: () => true,
      dispatch,
      randomId: () => `mobile-action-audit-${++eventId}`,
    })
    const session = authenticate()
    const target = events
      .createSnapshot({ session, grantId: grant.grantId })
      .items.find((item) => item.kind === "orchestration" && item.id === "task-1")
    expect(target).toBeDefined()
    const command = {
      protocolVersion: 1 as const,
      kind: "command" as const,
      commandId: "command-1",
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      authorityGrantId: grant.grantId,
      nonce: `${"c".repeat(32)}`,
      issuedAt: now,
      expiresAt: now + 30_000,
      scopeVersion: session.scopeVersion,
      deviceConfirmedAt: now,
      target: { kind: "orchestration" as const, id: "task-1", version: target!.version },
      action: { type: "orchestration.pause" as const },
    }

    await expect(
      actions.execute({
        command,
        session,
        grant,
        trustedTarget: command.target,
        connected: true,
        stepUpVerified: false,
      }),
    ).resolves.toMatchObject({ status: "completed", action: "orchestration.pause" })
    expect(dispatch.controlOrchestration).toHaveBeenCalledWith("task-1", "pause")

    await expect(
      actions.execute({
        command,
        session,
        grant,
        trustedTarget: command.target,
        connected: true,
        stepUpVerified: false,
      }),
    ).resolves.toMatchObject({ status: "denied", summary: "replay" })
    expect(dispatch.controlOrchestration).toHaveBeenCalledTimes(1)
    expect(
      pairing
        .listAuditRecords()
        .filter((record) => record.event === "mobile-action")
        .map((record) => record.outcome),
    ).toEqual(["allowed", "denied"])
  })

  it("executes WebSocket commands strictly in arrival order", async () => {
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const completed: string[] = []
    const execute = vi.fn(
      async ({ command }: { command: ReturnType<typeof orchestrationCommand> }) => {
        if (command.commandId === "rate-command-1") await firstBlocked
        completed.push(command.commandId)
        return {
          commandId: command.commandId,
          status: "completed",
          action: command.action.type,
          summary: command.commandId,
        }
      },
    )
    events.stop()
    events = createEvents(undefined, { execute } as unknown as MobileActionService)
    const socket = new FakeTransport("ordered-commands")
    events.handleWebSocket(socket)
    socket.receive(subscribeProof())

    socket.receive(orchestrationCommand(credential.session, 1, 1))
    socket.receive(orchestrationCommand(credential.session, 1, 2))
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect(completed).toEqual([])

    releaseFirst()
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(completed).toEqual(["rate-command-1", "rate-command-2"]))
  })

  it("contains transport close failures without rejecting the command queue", async () => {
    const execute = vi.fn(
      async ({ command }: { command: ReturnType<typeof orchestrationCommand> }) => {
        if (command.commandId === "rate-command-1") throw new Error("command failed")
        return {
          commandId: command.commandId,
          status: "completed" as const,
          action: command.action.type,
          summary: "done",
        }
      },
    )
    events.stop()
    events = createEvents(undefined, { execute } as unknown as MobileActionService)
    const socket = new ThrowingCloseTransport("throwing-close")
    events.handleWebSocket(socket)
    socket.receive(subscribeProof())
    socket.throwOnClose = true

    socket.receive(orchestrationCommand(credential.session, 1, 1))
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    socket.receive(orchestrationCommand(credential.session, 1, 2))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it("bounds mobile action audit admission once the append-only ledger is full", async () => {
    const existing = sqlite
      .prepare("SELECT count(*) count FROM mobile_device_audit_records")
      .get() as { count: number }
    const insert = sqlite.prepare(
      `INSERT INTO mobile_device_audit_records
       (id, device_id, event, outcome, summary, created_at)
       VALUES (?, NULL, 'seed', 'allowed', '{}', ?)`,
    )
    sqlite.transaction(() => {
      for (let index = existing.count; index < mobileControlLimits.auditEntries; index += 1) {
        insert.run(`action-audit-cap-${index}`, epochSeconds)
      }
    })()
    const actions = new MobileActionService({
      database,
      pairing,
      now: () => now,
      bridgeEnabled: () => true,
      dispatch: {
        answerClarification: vi.fn(() => true),
        controlRun: vi.fn(() => true),
        controlOrchestration: vi.fn(() => true),
        controlAutomation: vi.fn(() => true),
        decideApproval: vi.fn(() => true),
      },
    })

    await expect(
      actions.execute({
        command: orchestrationCommand(credential.session, 1, 99),
        session: credential.session,
        grant,
        trustedTarget: null,
        connected: true,
        stepUpVerified: false,
      }),
    ).resolves.toMatchObject({ status: "stale" })
    expect(
      (
        sqlite.prepare("SELECT count(*) count FROM mobile_device_audit_records").get() as {
          count: number
        }
      ).count,
    ).toBe(mobileControlLimits.auditEntries)
  })

  it("rate-limits authenticated commands per device session before shared-service dispatch", async () => {
    const dispatch = {
      answerClarification: vi.fn(() => true),
      controlRun: vi.fn(() => true),
      controlOrchestration: vi.fn(() => ({ status: "paused" })),
      controlAutomation: vi.fn(() => true),
      decideApproval: vi.fn(() => true),
    }
    const actions = new MobileActionService({
      database,
      pairing,
      now: () => now,
      bridgeEnabled: () => true,
      dispatch,
      randomId: () => `mobile-rate-audit-${++eventId}`,
    })
    const session = authenticate()
    const target = events
      .createSnapshot({ session, grantId: grant.grantId })
      .items.find((item) => item.kind === "orchestration" && item.id === "task-1")!

    for (let index = 0; index < 30; index += 1) {
      await expect(
        actions.execute({
          command: orchestrationCommand(session, target.version, index),
          session,
          grant,
          trustedTarget: { kind: "orchestration", id: target.id, version: target.version },
          connected: true,
          stepUpVerified: false,
        }),
      ).resolves.toMatchObject({ status: "completed" })
    }
    await expect(
      actions.execute({
        command: orchestrationCommand(session, target.version, 30),
        session,
        grant,
        trustedTarget: { kind: "orchestration", id: target.id, version: target.version },
        connected: true,
        stepUpVerified: false,
      }),
    ).resolves.toMatchObject({ status: "denied", summary: "rate-limited" })
    expect(dispatch.controlOrchestration).toHaveBeenCalledTimes(30)
  })

  it("projects a granted pending agent input and dispatches its exact answer", async () => {
    pendingAgentInputs = [
      {
        requestId: "input-1",
        chatId: "chat-1",
        runId: "run-1",
        origin: { harness: "codex" },
        capability: { mode: "native", sameRun: true },
        questions: [
          {
            id: "choice",
            question: "Which path?",
            options: [
              { id: "safe", label: "Safe" },
              { id: "fast", label: "Fast" },
            ],
            multiSelect: false,
            allowCustom: false,
          },
        ],
        status: "pending",
        createdAt: now,
        expiresAt: now + 30_000,
      },
    ]
    const answerGrant = await grants.createGrant(credential.session.deviceId, {
      authority: ["respond"],
      capabilities: ["clarification.answer"],
      resources: [{ kind: "project", id: "project-1" }],
    })
    const session = authenticate()
    const input = events
      .createSnapshot({ session, grantId: answerGrant.grantId })
      .items.find((item) => item.kind === "agent-input" && item.id === "input-1")
    expect(input).toMatchObject({
      kind: "agent-input",
      id: "input-1",
      chatId: "chat-1",
      runId: "run-1",
      questions: [expect.objectContaining({ id: "choice", question: "Which path?" })],
    })

    const answerClarification = vi.fn(() => true)
    const actions = new MobileActionService({
      database,
      pairing,
      now: () => now,
      bridgeEnabled: () => true,
      dispatch: {
        answerClarification,
        controlRun: vi.fn(() => true),
        controlOrchestration: vi.fn(() => true),
        controlAutomation: vi.fn(() => true),
        decideApproval: vi.fn(() => true),
      },
    })
    await expect(
      actions.execute({
        command: {
          protocolVersion: 1,
          kind: "command",
          commandId: "answer-1",
          sessionId: session.sessionId,
          deviceId: session.deviceId,
          authorityGrantId: answerGrant.grantId,
          nonce: "a".repeat(32),
          issuedAt: now,
          expiresAt: now + 30_000,
          scopeVersion: session.scopeVersion,
          deviceConfirmedAt: now,
          target: { kind: "agent-input", id: "input-1", version: input!.version },
          action: {
            type: "clarification.answer",
            requestId: "input-1",
            answers: { choice: ["Safe"] },
          },
        },
        session,
        grant: answerGrant,
        trustedTarget: { kind: "agent-input", id: "input-1", version: input!.version },
        connected: true,
        stepUpVerified: false,
      }),
    ).resolves.toMatchObject({ status: "completed" })
    expect(answerClarification).toHaveBeenCalledWith("input-1", { choice: ["Safe"] })
  })

  it("disconnects a slow client instead of growing an unbounded queue", () => {
    const socket = new FakeTransport("slow-socket", 1)
    events.handleWebSocket(socket)
    socket.receive(subscribeProof())
    expect(socket.sent).toHaveLength(1)
    events.ingestInvalidation(invalidation("runs", { runIds: ["run-1"] }))
    expect(socket.closed).toEqual({ code: 1013, reason: "client-too-slow" })
  })

  it("applies device revocation immediately to the active subscription", async () => {
    const socket = new FakeTransport("revoked-socket")
    events.handleWebSocket(socket)
    socket.receive(subscribeProof())
    await pairing.revokeDevice(credential.session.deviceId, "device-lost")
    expect(socket.closed).toEqual({ code: 1008, reason: "device-revoked" })
    expect(() =>
      events.createSnapshot({ session: authenticate(), grantId: grant.grantId }),
    ).toThrow()
  })

  it("invalidates an active subscription after its session credential rotates", () => {
    const socket = new FakeTransport("rotated-socket")
    events.handleWebSocket(socket)
    socket.receive(subscribeProof())

    pairing.rotateSession(sessionProof())
    events.ingestInvalidation(invalidation("runs", { runIds: ["run-1"] }))

    expect(socket.closed).toEqual({ code: 1008, reason: "authorization-changed" })
  })

  it("closes on scope-version change and enforces the replacement grant", async () => {
    const socket = new FakeTransport("changed-socket")
    events.handleWebSocket(socket)
    socket.receive(subscribeProof())
    const replacement = await grants.replaceGrant(grant.grantId, grantInput("project", "project-2"))
    expect(socket.closed).toEqual({ code: 1008, reason: "authorization-changed" })
    const session = authenticate()
    expect(() => events.createSnapshot({ session, grantId: grant.grantId })).toThrow(
      MobileEventAuthorizationError,
    )
    const snapshot = events.createSnapshot({ session, grantId: replacement.grantId })
    expect(snapshot.items.map((item) => item.id)).toEqual(["project-2", "task-2", "chat-2"])
  })
})

function createEvents(eventBacklog?: number, actions?: MobileActionService): MobileEventService {
  return new MobileEventService({
    database,
    pairing,
    grants,
    connections,
    now: () => now,
    randomId: () => `event-${++eventId}`,
    cursorKey: Buffer.alloc(32, 7),
    listAgentInputs: () => pendingAgentInputs,
    ...(actions ? { actions } : {}),
    ...(eventBacklog ? { eventBacklog } : {}),
  })
}

function orchestrationCommand(session: MobileSession, version: number, index: number) {
  return {
    protocolVersion: 1 as const,
    kind: "command" as const,
    commandId: `rate-command-${index}`,
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    authorityGrantId: grant.grantId,
    nonce: `${String(index).padStart(4, "0")}${"r".repeat(32)}`,
    issuedAt: now,
    expiresAt: now + 30_000,
    scopeVersion: session.scopeVersion,
    deviceConfirmedAt: now,
    target: { kind: "orchestration" as const, id: "task-1", version },
    action: { type: "orchestration.pause" as const },
  }
}

function createCredential(deviceKey: { privateKey: KeyObject; pem: string }) {
  const offer = pairing.createPairingOffer({
    endpoint: "https://192.168.50.24:4317",
    certificateFingerprint: fingerprint,
  })
  const paired = pairing.pairDevice({
    protocolVersion: 1,
    oneTimeToken: offer.oneTimeToken,
    certificateFingerprint: fingerprint,
    deviceName: "Phone",
    publicKeyAlgorithm: "Ed25519",
    publicKey: deviceKey.pem,
  })
  return pairing.authenticateChallenge(challengeProof(paired.challenge, deviceKey.privateKey))
}

function authenticate(): MobileSession {
  return pairing.authenticateSession(sessionProof())
}

function subscribeProof(resume?: { snapshotId: string; scopeVersion: number; sequence: number }) {
  return {
    protocolVersion: 1,
    kind: "subscribe",
    proof: sessionProof(),
    authorityGrantId: grant.grantId,
    ...(resume ? { resume } : {}),
  }
}

function challengeProof(
  challenge: { sessionId: string; deviceId: string; challenge: string },
  privateKey: KeyObject,
): MobileChallengeProof {
  const unsigned = {
    sessionId: challenge.sessionId,
    deviceId: challenge.deviceId,
    challenge: challenge.challenge,
    signature: "",
  }
  return {
    ...unsigned,
    signature: sign(null, mobileChallengeProofMessage(unsigned), privateKey).toString("base64url"),
  }
}

function sessionProof(): MobileSessionProof {
  const unsigned = {
    sessionId: credential.session.sessionId,
    deviceId: credential.session.deviceId,
    sessionToken: credential.sessionToken,
    nonce: `${String(++nonceCounter).padStart(4, "0")}${"n".repeat(32)}`,
    issuedAt: now,
    rotation: credential.session.rotation,
    signature: "",
  }
  return {
    ...unsigned,
    signature: sign(null, mobileSessionProofMessage(unsigned), key.privateKey).toString(
      "base64url",
    ),
  }
}

function grantInput(kind: "project" | "task" | "chat" | "run", id: string) {
  return {
    authority: ["control"] as const,
    capabilities: ["orchestration.pause"] as const,
    resources: [{ kind, id }],
  }
}

function invalidation(
  domain: "runs" | "tasks" | "chats" | "projects" | "orchestrations" | "automations",
  ids: {
    runIds?: string[]
    taskIds?: string[]
    chatIds?: string[]
    projectIds?: string[]
    automationIds?: string[]
  },
) {
  return { version: 1 as const, source: "product-mcp" as const, domains: [domain], ...ids }
}

function ed25519Key(): { privateKey: KeyObject; pem: string } {
  const pair = generateKeyPairSync("ed25519")
  return {
    privateKey: pair.privateKey,
    pem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  }
}

class FakeTransport implements MobileBridgeTransportSession {
  readonly remoteAddress = "192.168.50.99"
  readonly sent: string[] = []
  closed: { code: number; reason: string } | null = null
  private readonly messages = new Set<(data: Uint8Array) => void>()
  private readonly closes = new Set<() => void>()

  constructor(
    readonly id: string,
    private readonly sendLimit = Number.POSITIVE_INFINITY,
  ) {}

  send(data: string | Uint8Array): boolean {
    if (this.sent.length >= this.sendLimit) return false
    this.sent.push(typeof data === "string" ? data : new TextDecoder().decode(data))
    return true
  }

  onMessage(listener: (data: Uint8Array) => void): () => void {
    this.messages.add(listener)
    return () => this.messages.delete(listener)
  }

  onClose(listener: () => void): () => void {
    this.closes.add(listener)
    return () => this.closes.delete(listener)
  }

  close(code = 1001, reason = "closed"): void {
    if (this.closed) return
    this.closed = { code, reason }
    for (const listener of [...this.closes]) listener()
  }

  receive(value: unknown): void {
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    for (const listener of [...this.messages]) listener(bytes)
  }
}

class ThrowingCloseTransport extends FakeTransport {
  throwOnClose = false

  override close(code = 1001, reason = "closed"): void {
    if (this.throwOnClose) throw new Error("transport close failed")
    super.close(code, reason)
  }
}

function seedProductState(target: Database.Database): void {
  target.exec(`
    INSERT INTO projects (id, name, path, created_at, updated_at) VALUES
      ('project-1', 'Project One', '/tmp/project-1', ${epochSeconds}, ${epochSeconds}),
      ('project-2', 'Project Two', '/tmp/project-2', ${epochSeconds}, ${epochSeconds});
    INSERT INTO tasks (id, project_id, name, status, board_order, version, created_at, updated_at) VALUES
      ('task-1', 'project-1', 'Task One', 'in-progress', 'a0', 2, ${epochSeconds}, ${epochSeconds}),
      ('task-2', 'project-2', 'Task Two', 'planned', 'a0', 1, ${epochSeconds}, ${epochSeconds});
    INSERT INTO chats (id, name, project_id, task_id, scope, permission_mode, mcp_exposure_enabled, harness, created_at, updated_at) VALUES
      ('chat-1', 'Chat One', 'project-1', 'task-1', 'task', 'ask-before-edits', 0, 'codex', ${epochSeconds}, ${epochSeconds}),
      ('chat-2', 'Chat Two', 'project-2', 'task-2', 'task', 'ask-before-edits', 0, 'claude-code', ${epochSeconds}, ${epochSeconds});
    INSERT INTO agent_runs (
      id, chat_id, harness, permission_mode, status, started_at, initial_prompt,
      runtime_snapshot_version, runtime_preference, runtime_preference_source,
      resolved_runtime, runtime_adapter_version, runtime_protocol_version,
      runtime_capability_snapshot, runtime_control_snapshot
    ) VALUES (
      'run-1', 'chat-1', 'codex', 'ask-before-edits', 'running', ${epochSeconds},
      'raw provider secret prompt', 1, 'auto', 'product', 'codex',
      'mobile-fixture', 'mobile-fixture', '{"schemaVersion":1}', '{"schemaVersion":1}'
    );
    INSERT INTO mcp_approval_requests (
      id, invocation_id, caller_chat_id, caller_run_id, tool_name, tier,
      target_summary, input_summary, decision, grant_session, created_at, expires_at
    ) VALUES (
      'approval-1', 'invocation-1', 'chat-1', 'run-1', 'filesystem.write', 3,
      'project file', 'secret approval input', NULL, 0, ${epochSeconds}, ${epochSeconds + 600}
    );
    INSERT INTO file_change_manifests (
      id, run_id, file_path, change_type, additions, deletions
    ) VALUES ('manifest-1', 'run-1', 'src/index.ts', 'modified', 3, 1);
    INSERT INTO visual_artifacts (
      id, project_id, chat_id, task_id, source_class, stored_path, mime_type,
      byte_length, original_sha256, derivative_sha256, preview_sha256, actor_kind,
      actor_id, captured_at, confirmed_at, width, height, scale_factor,
      redaction_state, redaction_count, annotation_count, created_at
    ) VALUES (
      'artifact-1', 'project-1', 'chat-1', 'task-1', 'screen',
      'C:/private/source.png', 'image/png', 1234, '${"a".repeat(64)}',
      '${"b".repeat(64)}', '${"b".repeat(64)}', 'user', 'local-user',
      ${epochSeconds}, ${epochSeconds}, 640, 480, 1000, 'redacted', 1, 0,
      ${epochSeconds}
    );
    INSERT INTO visual_artifact_links (
      artifact_id, consumer_kind, consumer_id, context_sha256, selected_at
    ) VALUES ('artifact-1', 'run', 'run-1', '${"c".repeat(64)}', ${epochSeconds});
    INSERT INTO automations (
      id, name, scope_type, project_id, action_type, action_config, prompt, harness,
      permission_mode, worktree_strategy, state, enabled, approval_state, created_by_type,
      version, created_at, updated_at
    ) VALUES (
      'automation-1', 'Automation One', 'project', 'project-1', 'create-chat-run',
      '{"rawProviderPayload":"never project"}', 'secret automation prompt', 'codex',
      'ask-before-edits', 'inherit', 'draft', 0, 'pending', 'user', 3,
      ${epochSeconds}, ${epochSeconds}
    );
  `)
  target
    .prepare(
      `INSERT INTO task_orchestrations (
        task_id, initiating_chat_id, status, max_parallel_agents, max_depth,
        stop_conditions, blocker_count, engine_snapshot_version, coordination_engine,
        coordination_engine_version, coordination_engine_source,
        coordination_engine_capability_snapshot, coordination_engine_provider_identity,
        created_at, updated_at
      ) VALUES (
        'task-1', 'chat-1', 'active', 2, 8, '{}', 0, ?, ?, ?, ?, ?, ?,
        ${epochSeconds}, ${epochSeconds}
      )`,
    )
    .run(...testCoordinationEngineSnapshotSqlValues())
}

function seedExtraTasks(target: Database.Database, count: number): void {
  const insert = target.prepare(
    `INSERT INTO tasks (id, project_id, name, status, board_order, version, created_at, updated_at)
     VALUES (?, 'project-1', ?, 'backlog', ?, 1, ?, ?)`,
  )
  for (let index = 1; index <= count; index += 1)
    insert.run(`task-extra-${index}`, `Extra ${index}`, `b${index}`, epochSeconds, epochSeconds)
}

function tableNames(): string[] {
  return (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{
      name: string
    }>
  ).map((row) => row.name)
}
