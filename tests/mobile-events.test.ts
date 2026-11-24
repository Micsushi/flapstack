import Database from "better-sqlite3"
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto"
import { resolve } from "node:path"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { MobileActionService } from "../src/main/lib/mobile-actions"
import { MobileEventService, MobileScopeGrantService } from "../src/main/lib/mobile-events"
import type { MobileBridgeTransportSession } from "../src/main/lib/mobile-bridge"
import {
  MobileDeviceConnectionRegistry,
  MobilePairingService,
  mobileChallengeProofMessage,
  mobileSessionProofMessage,
} from "../src/main/lib/mobile-pairing"
import {
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
  it("reads conversations only inside the authenticated grant and rechecks revocation", () => {
    const readConversation = vi.fn(() => ({ messages: [] }))
    events.stop()
    events = new MobileEventService({
      database,
      pairing,
      grants,
      connections,
      now: () => now,
      readConversation,
    })
    const socket = new FakeTransport("conversation-socket")
    events.handleWebSocket(socket)
    socket.receive(subscribeProof())
    socket.receive({ kind: "conversation.read", chatId: "chat-1" })
    expect(readConversation).toHaveBeenCalledWith("chat-1", undefined, undefined)
    socket.receive({ kind: "conversation.read", chatId: "chat-2" })
    expect(readConversation).toHaveBeenCalledTimes(1)
    expect(socket.closed?.code).toBe(1008)
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
