import Database from "better-sqlite3"
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto"
import { rmSync } from "node:fs"
import { resolve } from "node:path"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
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
