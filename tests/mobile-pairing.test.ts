import Database from "better-sqlite3"
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  MobileDeviceConnectionRegistry,
  MobilePairingError,
  MobilePairingService,
  mobileChallengeProofMessage,
  mobileSessionProofMessage,
  type MobilePairingServiceOptions,
} from "../src/main/lib/mobile-pairing"
import * as schema from "../src/main/lib/db/schema"
import {
  encodeMobilePairingQrPayload,
  mobileControlLimits,
  parseMobilePairingQrPayload,
  type MobileChallengeProof,
  type MobilePairingRequest,
  type MobileSessionCredential,
  type MobileSessionProof,
} from "../src/shared/mobile-control"
import { MobileControlRuntime } from "../src/main/lib/mobile-events"

const migrationsFolder = resolve(process.cwd(), "drizzle")
const fingerprint = `sha256:${"a".repeat(64)}` as const
const endpoint = "https://192.168.50.24:4317"

type KeyFixture = { publicKey: KeyObject; privateKey: KeyObject; pem: string }

let sqlite: Database.Database
let database: ReturnType<typeof drizzle<typeof schema>>
let now: number
let idCounter: number
let secretCounter: number
const temporaryDirectories: string[] = []

beforeEach(() => {
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder })
  now = 1_800_000_000_000
  idCounter = 0
  secretCounter = 0
})

afterEach(() => {
  sqlite.close()
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

describe("mobile-pairing", () => {
  it("upgrades an existing 0046 profile through the current additive mobile schema", () => {
    const legacy = new Database(":memory:")
    try {
      legacy.pragma("foreign_keys = ON")
      migrate(drizzle(legacy, { schema }), { migrationsFolder: migrationsThrough0046() })
      expect(tableNames(legacy)).not.toContain("mobile_devices")
      legacy
        .prepare(
          `INSERT INTO projects (id, name, path, created_at, updated_at)
           VALUES ('pairing-upgrade-project', 'Pairing upgrade', '/tmp/pairing-upgrade', 1784030400, 1784030400)`,
        )
        .run()

      migrate(drizzle(legacy, { schema }), { migrationsFolder })

      expect(tableNames(legacy)).toEqual(
        expect.arrayContaining([
          "mobile_pairing_tokens",
          "mobile_devices",
          "mobile_auth_challenges",
          "mobile_device_sessions",
          "mobile_session_nonces",
          "mobile_device_audit_records",
        ]),
      )
      expect(sqliteJournal().entries.find((entry) => entry.idx === 47)).toMatchObject({
        idx: 47,
        tag: "0047_mobile_pairing_identity",
      })
      expect(sqliteJournal().entries.find((entry) => entry.idx === 48)).toMatchObject({
        idx: 48,
        tag: "0048_mobile_sequenced_events",
      })
      expect(sqliteJournal().entries.find((entry) => entry.idx === 50)).toMatchObject({
        idx: 50,
        tag: "0050_mobile_projection_families",
      })
      expect(sqliteJournal().entries.find((entry) => entry.idx === 53)).toMatchObject({
        idx: 53,
        tag: "0053_chat-tags",
      })
      expect(
        legacy
          .prepare("SELECT name, path FROM projects WHERE id = 'pairing-upgrade-project'")
          .get(),
      ).toEqual({ name: "Pairing upgrade", path: "/tmp/pairing-upgrade" })
    } finally {
      legacy.close()
    }
  })

  it("creates a bounded QR offer and atomically rejects mismatch, reuse, expiry, and concurrency", async () => {
    const service = createService()
    const key = ed25519Key()
    const offer = service.createPairingOffer({ endpoint, certificateFingerprint: fingerprint })

    expect(parseMobilePairingQrPayload(encodeMobilePairingQrPayload(offer))).toEqual(offer)
    expect(offer.expiresAt - offer.createdAt).toBe(mobileControlLimits.pairingTtlMs)
    expect(rawValue("SELECT created_at value FROM mobile_pairing_tokens")).toBe(
      Math.floor(now / 1_000),
    )
    expect(sqlite.prepare("SELECT token_hash FROM mobile_pairing_tokens").get()).not.toEqual(
      expect.objectContaining({ token_hash: offer.oneTimeToken }),
    )

    const request = pairingRequest(offer.oneTimeToken, key)
    expectCode(
      () => service.pairDevice({ ...request, certificateFingerprint: `sha256:${"b".repeat(64)}` }),
      "fingerprint-mismatch",
    )
    const results = await Promise.allSettled([
      Promise.resolve().then(() => service.pairDevice(request)),
      Promise.resolve().then(() => service.pairDevice(request)),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    expectCode(() => service.pairDevice(request), "pairing-used")

    const expired = service.createPairingOffer({ endpoint, certificateFingerprint: fingerprint })
    now = expired.expiresAt
    expectCode(
      () => service.pairDevice(pairingRequest(expired.oneTimeToken, ed25519Key())),
      "pairing-expired",
    )
  })

  it("registers only public identity and requires a matching one-time signed challenge", () => {
    const service = createService()
    const key = ed25519Key()
    const paired = pair(service, key)
    const wrongKey = ed25519Key()

    expect(service.listDevices()).toEqual([
      expect.objectContaining({
        deviceId: paired.device.deviceId,
        name: "Phone",
        publicKeyAlgorithm: "Ed25519",
        publicKey: key.pem.trim(),
        scopeVersion: 1,
      }),
    ])
    expectCode(
      () => service.authenticateChallenge(challengeProof(paired.challenge, wrongKey.privateKey)),
      "signature-invalid",
    )
    const credential = service.authenticateChallenge(
      challengeProof(paired.challenge, key.privateKey),
    )
    expect(credential.session).toMatchObject({
      sessionId: paired.challenge.sessionId,
      deviceId: paired.device.deviceId,
      rotation: 0,
    })
    expectCode(
      () => service.authenticateChallenge(challengeProof(paired.challenge, key.privateKey)),
      "challenge-invalid",
    )
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM mobile_devices").all())).not.toContain(
      credential.sessionToken,
    )
  })

  it("rejects private key material without consuming the pairing token", () => {
    const service = createService()
    const key = ed25519Key()
    const offer = service.createPairingOffer({ endpoint, certificateFingerprint: fingerprint })
    const privateKey = key.privateKey.export({ type: "pkcs8", format: "pem" }).toString()

    expectCode(
      () =>
        service.pairDevice({ ...pairingRequest(offer.oneTimeToken, key), publicKey: privateKey }),
      "invalid-request",
    )
    expect(service.pairDevice(pairingRequest(offer.oneTimeToken, key)).device.publicKey).toBe(
      key.pem.trim(),
    )
  })

  it("supports P-256 registration and fails expired or mismatched challenges safely", () => {
    const service = createService()
    const p256 = p256Key()
    const paired = pair(service, p256, "Tablet", "P-256")
    expect(
      service.authenticateChallenge(challengeProof(paired.challenge, p256.privateKey, "sha256")),
    ).toMatchObject({ session: { deviceId: paired.device.deviceId } })

    const other = pair(service, ed25519Key(), "Other")
    const challenge = service.createChallenge(other.device.deviceId)
    expectCode(
      () =>
        service.authenticateChallenge(
          challengeProof(
            { ...challenge, deviceId: paired.device.deviceId },
            p256.privateKey,
            "sha256",
          ),
        ),
      "challenge-invalid",
    )
    now = challenge.expiresAt
    expectCode(
      () => service.authenticateChallenge(challengeProof(challenge, ed25519Key().privateKey)),
      "challenge-expired",
    )
  })

  it("bounds active challenges, prunes expired rows, and still rejects replay", () => {
    const service = createService()
    const key = ed25519Key()
    const paired = pair(service, key)
    sqlite.prepare("DELETE FROM mobile_auth_challenges").run()
    expect(mobileControlLimits.challengeEntries).toBe(2_048)
    const insert = sqlite.prepare(
      `INSERT INTO mobile_auth_challenges
       (id, device_id, challenge_hash, issued_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    sqlite.transaction(() => {
      for (let index = 0; index < mobileControlLimits.challengeEntries; index += 1) {
        insert.run(
          `challenge-${index}`,
          paired.device.deviceId,
          `${index}`.padStart(64, "0"),
          Math.floor(now / 1_000),
          Math.floor((now + mobileControlLimits.challengeTtlMs) / 1_000),
        )
      }
    })()

    expectCode(() => service.createChallenge(paired.device.deviceId), "invalid-request")
    expect(rawValue("SELECT count(*) value FROM mobile_auth_challenges")).toBe(
      mobileControlLimits.challengeEntries,
    )

    now += mobileControlLimits.challengeTtlMs
    const fresh = service.createChallenge(paired.device.deviceId)
    expect(rawValue("SELECT count(*) value FROM mobile_auth_challenges")).toBe(1)
    expectCode(
      () =>
        service.authenticateChallenge({
          sessionId: "challenge-0",
          deviceId: paired.device.deviceId,
          challenge: "e".repeat(32),
          signature: sign(
            null,
            mobileChallengeProofMessage({
              sessionId: "challenge-0",
              deviceId: paired.device.deviceId,
              challenge: "e".repeat(32),
            }),
            key.privateKey,
          ).toString("base64url"),
        }),
      "challenge-invalid",
    )
    expect(fresh.expiresAt).toBe(now + mobileControlLimits.challengeTtlMs)
  })

  it("caps append-only mobile audit admission without weakening stored records", () => {
    const service = createService()
    expect(mobileControlLimits.auditEntries).toBe(2_048)
    const insert = sqlite.prepare(
      `INSERT INTO mobile_device_audit_records
       (id, device_id, event, outcome, summary, created_at)
       VALUES (?, NULL, 'seed', 'allowed', '{}', ?)`,
    )
    sqlite.transaction(() => {
      for (let index = 0; index < mobileControlLimits.auditEntries; index += 1) {
        insert.run(`audit-${index}`, Math.floor(now / 1_000))
      }
    })()

    service.createPairingOffer({ endpoint, certificateFingerprint: fingerprint })

    expect(rawValue("SELECT count(*) value FROM mobile_device_audit_records")).toBe(
      mobileControlLimits.auditEntries,
    )
    expect(() =>
      sqlite.exec("DELETE FROM mobile_device_audit_records WHERE id = 'audit-0'"),
    ).toThrow(/append-only/)
  })

  it("persists replay protection but revokes active sessions on runtime restart", async () => {
    const service = createService()
    const key = ed25519Key()
    const credential = createCredential(service, key)
    const proof = sessionProof(credential, key.privateKey, "n".repeat(32))

    const results = await Promise.allSettled([
      Promise.resolve().then(() => service.authenticateSession(proof)),
      Promise.resolve().then(() => service.authenticateSession(proof)),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    expectCode(() => service.authenticateSession(proof), "replay")

    const restarted = new MobileControlRuntime(database, { now: () => now })
    expect(rawValue("SELECT revoked_at IS NOT NULL value FROM mobile_device_sessions")).toBe(1)
    expectCode(
      () =>
        restarted.pairing.authenticateSession(
          sessionProof(credential, key.privateKey, "r".repeat(32)),
        ),
      "session-expired",
    )
    const [preservedDevice] = restarted.pairing.listDevices()
    expect(preservedDevice).toMatchObject({ deviceId: credential.session.deviceId })
    expect(preservedDevice).not.toHaveProperty("revokedAt")
    restarted.stop()
  })

  it("rotates session tokens atomically and rejects old, stale, mismatched, and expired proofs", () => {
    const service = createService()
    const key = ed25519Key()
    const credential = createCredential(service, key)
    expectCode(
      () =>
        service.authenticateSession(
          sessionProof(credential, ed25519Key().privateKey, "s".repeat(32)),
        ),
      "signature-invalid",
    )
    const rotated = service.rotateSession(sessionProof(credential, key.privateKey, "a".repeat(32)))
    expect(rotated.session.rotation).toBe(1)
    expect(rotated.sessionToken).not.toBe(credential.sessionToken)
    expectCode(
      () => service.authenticateSession(sessionProof(credential, key.privateKey, "b".repeat(32))),
      "session-invalid",
    )
    expectCode(
      () =>
        service.authenticateSession({
          ...sessionProof(rotated, key.privateKey, "c".repeat(32)),
          rotation: 0,
        }),
      "rotation-mismatch",
    )

    const other = createCredential(service, ed25519Key(), "Other")
    const mismatch = sessionProof(rotated, key.privateKey, "d".repeat(32))
    expectCode(
      () => service.authenticateSession({ ...mismatch, deviceId: other.session.deviceId }),
      "session-invalid",
    )
    now = rotated.session.idleExpiresAt
    expectCode(
      () => service.authenticateSession(sessionProof(rotated, key.privateKey, "e".repeat(32))),
      "session-expired",
    )
  })

  it("lists, renames, revokes, and terminates active device connections immediately", async () => {
    const connections = new MobileDeviceConnectionRegistry()
    const service = createService({ connections })
    const key = ed25519Key()
    const credential = createCredential(service, key)
    const close = vi.fn()
    connections.register(credential.session.deviceId, "connection-1", close)

    expect(service.renameDevice(credential.session.deviceId, "Work phone").name).toBe("Work phone")
    await service.revokeDevice(credential.session.deviceId, "device-lost")

    expect(close).toHaveBeenCalledWith("device-revoked")
    expect(service.listDevices()[0]).toMatchObject({
      name: "Work phone",
      revokedAt: now,
      scopeVersion: 2,
    })
    expectCode(
      () => service.authenticateSession(sessionProof(credential, key.privateKey, "z".repeat(32))),
      "device-revoked",
    )
    expectCode(() => service.createChallenge(credential.session.deviceId), "device-revoked")
    expectCode(
      () =>
        createService().authenticateSession(
          sessionProof(credential, key.privateKey, "y".repeat(32)),
        ),
      "device-revoked",
    )
  })

  it("stores append-only redacted audit without credentials, challenges, signatures, or keys", () => {
    const service = createService()
    const key = ed25519Key()
    const offer = service.createPairingOffer({ endpoint, certificateFingerprint: fingerprint })
    const paired = service.pairDevice(pairingRequest(offer.oneTimeToken, key))
    const proof = challengeProof(paired.challenge, key.privateKey)
    const credential = service.authenticateChallenge(proof)
    service.authenticateSession(sessionProof(credential, key.privateKey, "q".repeat(32)))

    const serialized = JSON.stringify(service.listAuditRecords())
    for (const forbidden of [
      offer.oneTimeToken,
      paired.challenge.challenge,
      proof.signature,
      credential.sessionToken,
      key.pem,
    ])
      expect(serialized).not.toContain(forbidden)
    expect(service.listAuditRecords()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "pairing", outcome: "allowed" }),
        expect.objectContaining({ event: "session-authenticated", outcome: "allowed" }),
      ]),
    )
    expect(() => sqlite.exec("UPDATE mobile_device_audit_records SET outcome = 'failed'")).toThrow(
      /append-only/,
    )
    expect(() => sqlite.exec("DELETE FROM mobile_device_audit_records")).toThrow(/append-only/)
  })
})

function createService(overrides: Partial<MobilePairingServiceOptions> = {}): MobilePairingService {
  return new MobilePairingService({
    database,
    now: () => now,
    randomId: () => `id-${++idCounter}`,
    randomSecret: () => `${String(++secretCounter).padStart(4, "0")}${"s".repeat(40)}`,
    ...overrides,
  })
}

function ed25519Key(): KeyFixture {
  const pair = generateKeyPairSync("ed25519")
  return {
    ...pair,
    pem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  }
}

function p256Key(): KeyFixture {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  return {
    ...pair,
    pem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  }
}

function pairingRequest(
  token: string,
  key: KeyFixture,
  name = "Phone",
  algorithm: "Ed25519" | "P-256" = "Ed25519",
): MobilePairingRequest {
  return {
    protocolVersion: 1,
    oneTimeToken: token,
    certificateFingerprint: fingerprint,
    deviceName: name,
    publicKeyAlgorithm: algorithm,
    publicKey: key.pem,
  }
}

function pair(
  service: MobilePairingService,
  key: KeyFixture,
  name = "Phone",
  algorithm: "Ed25519" | "P-256" = "Ed25519",
) {
  const offer = service.createPairingOffer({ endpoint, certificateFingerprint: fingerprint })
  return service.pairDevice(pairingRequest(offer.oneTimeToken, key, name, algorithm))
}

function createCredential(service: MobilePairingService, key: KeyFixture, name = "Phone") {
  const paired = pair(service, key, name)
  return service.authenticateChallenge(challengeProof(paired.challenge, key.privateKey))
}

function challengeProof(
  challenge: { sessionId: string; deviceId: string; challenge: string },
  privateKey: KeyObject,
  algorithm: null | "sha256" = null,
): MobileChallengeProof {
  const unsigned = {
    sessionId: challenge.sessionId,
    deviceId: challenge.deviceId,
    challenge: challenge.challenge,
    signature: "",
  }
  return {
    sessionId: unsigned.sessionId,
    deviceId: unsigned.deviceId,
    challenge: unsigned.challenge,
    signature: sign(algorithm, mobileChallengeProofMessage(unsigned), privateKey).toString(
      "base64url",
    ),
  }
}

function sessionProof(
  credential: MobileSessionCredential,
  privateKey: KeyObject,
  nonce: string,
): MobileSessionProof {
  const unsigned = {
    sessionId: credential.session.sessionId,
    deviceId: credential.session.deviceId,
    sessionToken: credential.sessionToken,
    nonce,
    issuedAt: now,
    rotation: credential.session.rotation,
    signature: "",
  }
  return {
    ...unsigned,
    signature: sign(null, mobileSessionProofMessage(unsigned), privateKey).toString("base64url"),
  }
}

function expectCode(operation: () => unknown, code: string): void {
  try {
    operation()
    throw new Error(`Expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(MobilePairingError)
    expect(error).toMatchObject({ code })
  }
}

function rawValue(query: string): unknown {
  return (sqlite.prepare(query).get() as { value: unknown }).value
}

function migrationsThrough0046(): string {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-mobile-migrations-"))
  temporaryDirectories.push(directory)
  mkdirSync(join(directory, "meta"))
  const journal = sqliteJournal()
  const subset = { ...journal, entries: journal.entries.filter((entry) => entry.idx <= 46) }
  writeFileSync(join(directory, "meta", "_journal.json"), JSON.stringify(subset))
  for (const entry of subset.entries)
    cpSync(join(migrationsFolder, `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`))
  return directory
}

function sqliteJournal(): {
  version: string
  dialect: string
  entries: Array<{ idx: number; tag: string }>
} {
  return JSON.parse(readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8")) as {
    version: string
    dialect: string
    entries: Array<{ idx: number; tag: string }>
  }
}

function tableNames(target: Database.Database): string[] {
  return (
    target
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>
  ).map((row) => row.name)
}
