import Database from "better-sqlite3"
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
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
import type {
  MobileAuthorityGrant,
  MobileChallengeProof,
  MobileSession,
  MobileSessionCredential,
  MobileSessionProof,
} from "../src/shared/mobile-control"

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
  it("keeps canonical 0031 and adds only the serialized 0032 event schema", () => {
    const journal = JSON.parse(
      readFileSync(resolve(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> }
    expect(journal.entries.find((entry) => entry.idx === 31)).toEqual(
      expect.objectContaining({ tag: "0031_mobile_pairing_identity" }),
    )
    expect(journal.entries.at(-1)).toEqual(
      expect.objectContaining({ idx: 32, tag: "0032_mobile_sequenced_events" }),
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
    ])
    expect(JSON.stringify(snapshot)).not.toContain("project-2")
    expect(JSON.stringify(snapshot)).not.toContain("raw provider")
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
      expect(resumed.events).toHaveLength(1)
      expect(resumed.events[0]).toMatchObject({
        sequence: 1,
        payload: { type: "entity.upsert", item: { kind: "run", id: "run-1" } },
      })
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
    if (resumed.type === "snapshot") expect(resumed.snapshot.sequence).toBe(3)
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

function createEvents(eventBacklog?: number): MobileEventService {
  return new MobileEventService({
    database,
    pairing,
    grants,
    connections,
    now: () => now,
    randomId: () => `event-${++eventId}`,
    cursorKey: Buffer.alloc(32, 7),
    ...(eventBacklog ? { eventBacklog } : {}),
  })
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
    INSERT INTO agent_runs (id, chat_id, harness, permission_mode, status, started_at, initial_prompt) VALUES
      ('run-1', 'chat-1', 'codex', 'ask-before-edits', 'running', ${epochSeconds}, 'raw provider secret prompt');
    INSERT INTO task_orchestrations (task_id, initiating_chat_id, status, max_parallel_agents, max_depth, stop_conditions, blocker_count, created_at, updated_at) VALUES
      ('task-1', 'chat-1', 'active', 2, 8, '{}', 0, ${epochSeconds}, ${epochSeconds});
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
