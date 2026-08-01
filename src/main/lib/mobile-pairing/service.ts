import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto"
import { and, asc, count, eq, gt, isNotNull, isNull, lt, lte, or } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import {
  MOBILE_CONTROL_PROTOCOL_VERSION,
  mobileChallengeProofSchema,
  mobileControlLimits,
  mobileDeviceRecordSchema,
  mobilePairingOfferSchema,
  mobilePairingRequestSchema,
  mobileSessionCredentialSchema,
  mobileSessionProofSchema,
  mobileSessionSchema,
  type MobileChallengeProof,
  type MobileDeviceRecord,
  type MobilePairingOffer,
  type MobilePairingRequest,
  type MobilePairingResult,
  type MobileSession,
  type MobileSessionCredential,
  type MobileSessionProof,
} from "../../../shared/mobile-control"
import * as schema from "../db/schema"
import {
  mobileAuthChallenges,
  mobileDeviceAuditRecords,
  mobileDevices,
  mobileDeviceSessions,
  mobilePairingTokens,
  mobileSessionNonces,
} from "../db/schema"

export type MobilePairingErrorCode =
  | "invalid-request"
  | "pairing-invalid"
  | "pairing-expired"
  | "pairing-used"
  | "fingerprint-mismatch"
  | "credential-exists"
  | "device-not-found"
  | "device-revoked"
  | "challenge-invalid"
  | "challenge-expired"
  | "signature-invalid"
  | "session-invalid"
  | "session-expired"
  | "rotation-mismatch"
  | "replay"

export class MobilePairingError extends Error {
  constructor(
    readonly code: MobilePairingErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "MobilePairingError"
  }
}

export type MobileDeviceRevocationReason =
  "user" | "credential-suspected" | "device-lost" | "scope-replaced"

export type MobileDeviceConnectionTerminator = {
  terminateDevice(deviceId: string, reason: string): void | Promise<void>
}

export class MobileDeviceConnectionRegistry implements MobileDeviceConnectionTerminator {
  private readonly connections = new Map<string, Map<string, (reason: string) => void>>()

  register(deviceId: string, connectionId: string, close: (reason: string) => void): () => void {
    const deviceConnections = this.connections.get(deviceId) ?? new Map()
    deviceConnections.set(connectionId, close)
    this.connections.set(deviceId, deviceConnections)
    return () => {
      deviceConnections.delete(connectionId)
      if (deviceConnections.size === 0) this.connections.delete(deviceId)
    }
  }

  terminateDevice(deviceId: string, reason: string): void {
    const deviceConnections = this.connections.get(deviceId)
    if (!deviceConnections) return
    this.connections.delete(deviceId)
    let failure: unknown
    for (const close of deviceConnections.values()) {
      try {
        close(reason)
      } catch (error) {
        failure ??= error
      }
    }
    if (failure) throw failure
  }
}

export type MobilePairingServiceOptions = {
  database: BetterSQLite3Database<typeof schema>
  now?: () => number
  randomId?: () => string
  randomSecret?: () => string
  connections?: MobileDeviceConnectionTerminator
}

type DeviceRow = typeof mobileDevices.$inferSelect
type SessionRow = typeof mobileDeviceSessions.$inferSelect
type AuditOutcome = "allowed" | "denied" | "failed"

export class MobilePairingService {
  private readonly now: () => number
  private readonly randomId: () => string
  private readonly randomSecret: () => string
  private readonly connections: MobileDeviceConnectionTerminator

  constructor(private readonly options: MobilePairingServiceOptions) {
    this.now = options.now ?? Date.now
    this.randomId = options.randomId ?? randomUUID
    this.randomSecret = options.randomSecret ?? (() => randomBytes(32).toString("base64url"))
    this.connections = options.connections ?? { terminateDevice: () => undefined }
  }

  createPairingOffer(input: {
    endpoint: string
    certificateFingerprint: `sha256:${string}`
  }): MobilePairingOffer {
    const now = this.now()
    const token = this.randomSecret()
    const offer = mobilePairingOfferSchema.parse({
      protocolVersion: MOBILE_CONTROL_PROTOCOL_VERSION,
      endpoint: input.endpoint,
      certificateFingerprint: input.certificateFingerprint,
      oneTimeToken: token,
      createdAt: now,
      expiresAt: now + mobileControlLimits.pairingTtlMs,
    })
    this.options.database
      .insert(mobilePairingTokens)
      .values({
        id: this.randomId(),
        tokenHash: digest(token),
        certificateFingerprint: offer.certificateFingerprint,
        createdAt: toDate(offer.createdAt),
        expiresAt: toDate(offer.expiresAt),
      })
      .run()
    this.audit(null, "pairing-offer-created", "allowed", { expiresAt: offer.expiresAt })
    return offer
  }

  pairDevice(input: MobilePairingRequest): MobilePairingResult {
    let request: MobilePairingRequest
    try {
      request = mobilePairingRequestSchema.parse(input)
    } catch {
      this.audit(null, "pairing", "denied", { reason: "invalid-request" })
      throw new MobilePairingError("invalid-request", "Pairing request is invalid.")
    }
    const now = this.now()
    const tokenHash = digest(request.oneTimeToken)
    let publicKey: KeyObject
    try {
      publicKey = parsePublicKey(request.publicKey, request.publicKeyAlgorithm)
    } catch {
      this.audit(null, "pairing", "denied", { reason: "invalid-public-key" })
      throw new MobilePairingError("invalid-request", "Device public key is invalid.")
    }
    const deviceId = this.randomId()
    const challengeId = this.randomId()
    const challenge = this.randomSecret()
    const keyFingerprint = publicKeyFingerprint(publicKey)

    try {
      this.prepareChallengeCapacity(now)
      const result = this.options.database.transaction((tx) => {
        const offer = tx
          .select()
          .from(mobilePairingTokens)
          .where(eq(mobilePairingTokens.tokenHash, tokenHash))
          .get()
        if (!offer)
          throw new MobilePairingError("pairing-invalid", "Pairing token is not recognized.")
        if (offer.consumedAt)
          throw new MobilePairingError("pairing-used", "Pairing token was already consumed.")
        if (offer.expiresAt.getTime() <= now)
          throw new MobilePairingError("pairing-expired", "Pairing token expired.")
        if (offer.certificateFingerprint !== request.certificateFingerprint)
          throw new MobilePairingError(
            "fingerprint-mismatch",
            "Certificate fingerprint does not match the pairing offer.",
          )
        const consumed = tx
          .update(mobilePairingTokens)
          .set({ consumedAt: toDate(now) })
          .where(
            and(
              eq(mobilePairingTokens.id, offer.id),
              isNull(mobilePairingTokens.consumedAt),
              gt(mobilePairingTokens.expiresAt, toDate(now)),
            ),
          )
          .returning({ id: mobilePairingTokens.id })
          .get()
        if (!consumed)
          throw new MobilePairingError("pairing-used", "Pairing token is no longer available.")

        tx.insert(mobileDevices)
          .values({
            id: deviceId,
            name: request.deviceName,
            publicKeyAlgorithm: request.publicKeyAlgorithm,
            publicKey: exportPublicKey(publicKey),
            publicKeyFingerprint: keyFingerprint,
            createdAt: toDate(now),
            scopeVersion: 1,
          })
          .run()
        tx.insert(mobileAuthChallenges)
          .values({
            id: challengeId,
            deviceId,
            challengeHash: digest(challenge),
            issuedAt: toDate(now),
            expiresAt: toDate(now + mobileControlLimits.challengeTtlMs),
          })
          .run()
        return {
          device: deviceFromRow(
            tx.select().from(mobileDevices).where(eq(mobileDevices.id, deviceId)).get()!,
          ),
          challenge: {
            sessionId: challengeId,
            deviceId,
            challenge,
            issuedAt: now,
            expiresAt: now + mobileControlLimits.challengeTtlMs,
          },
        }
      })
      this.audit(deviceId, "pairing", "allowed", { publicKeyAlgorithm: request.publicKeyAlgorithm })
      return result
    } catch (error) {
      const normalized = normalizeDatabaseError(error)
      this.audit(deviceId, "pairing", "denied", { reason: normalized.code })
      throw normalized
    }
  }

  createChallenge(deviceId: string): MobilePairingResult["challenge"] {
    const now = this.now()
    try {
      const device = this.requireActiveDevice(deviceId)
      this.prepareChallengeCapacity(now)
      const challenge = this.randomSecret()
      const sessionId = this.randomId()
      this.options.database
        .insert(mobileAuthChallenges)
        .values({
          id: sessionId,
          deviceId,
          challengeHash: digest(challenge),
          issuedAt: toDate(now),
          expiresAt: toDate(now + mobileControlLimits.challengeTtlMs),
        })
        .run()
      this.audit(device.id, "challenge-created", "allowed", {})
      return {
        sessionId,
        deviceId,
        challenge,
        issuedAt: now,
        expiresAt: now + mobileControlLimits.challengeTtlMs,
      }
    } catch (error) {
      const normalized = normalizeDatabaseError(error)
      this.audit(deviceId, "challenge-created", "denied", { reason: normalized.code })
      throw normalized
    }
  }

  authenticateChallenge(input: MobileChallengeProof): MobileSessionCredential {
    let proof: MobileChallengeProof
    try {
      proof = mobileChallengeProofSchema.parse(input)
    } catch {
      this.audit(null, "session-created", "denied", { reason: "invalid-request" })
      throw new MobilePairingError("invalid-request", "Challenge proof is invalid.")
    }
    const now = this.now()
    const challenge = this.options.database
      .select()
      .from(mobileAuthChallenges)
      .where(eq(mobileAuthChallenges.id, proof.sessionId))
      .get()
    const device = this.options.database
      .select()
      .from(mobileDevices)
      .where(eq(mobileDevices.id, proof.deviceId))
      .get()
    try {
      if (!challenge || challenge.deviceId !== proof.deviceId)
        throw new MobilePairingError("challenge-invalid", "Challenge is not valid for this device.")
      assertActiveDevice(device)
      if (challenge.consumedAt)
        throw new MobilePairingError("challenge-invalid", "Challenge was already consumed.")
      if (challenge.expiresAt.getTime() <= now)
        throw new MobilePairingError("challenge-expired", "Challenge expired.")
      if (challenge.challengeHash !== digest(proof.challenge))
        throw new MobilePairingError("challenge-invalid", "Challenge does not match.")
      if (!verifyDeviceSignature(device!, mobileChallengeProofMessage(proof), proof.signature))
        throw new MobilePairingError("signature-invalid", "Challenge signature is invalid.")

      const token = this.randomSecret()
      const credential = this.options.database.transaction((tx) => {
        const activeDevice = tx
          .select()
          .from(mobileDevices)
          .where(and(eq(mobileDevices.id, proof.deviceId), isNull(mobileDevices.revokedAt)))
          .get()
        if (!activeDevice)
          throw new MobilePairingError("device-revoked", "Device is revoked or missing.")
        const consumed = tx
          .update(mobileAuthChallenges)
          .set({ consumedAt: toDate(now) })
          .where(
            and(
              eq(mobileAuthChallenges.id, proof.sessionId),
              eq(mobileAuthChallenges.deviceId, proof.deviceId),
              eq(mobileAuthChallenges.challengeHash, digest(proof.challenge)),
              isNull(mobileAuthChallenges.consumedAt),
              gt(mobileAuthChallenges.expiresAt, toDate(now)),
            ),
          )
          .returning({ id: mobileAuthChallenges.id })
          .get()
        if (!consumed)
          throw new MobilePairingError("challenge-invalid", "Challenge is no longer available.")
        const absoluteExpiresAt = now + mobileControlLimits.sessionAbsoluteTtlMs
        const idleExpiresAt = Math.min(
          now + mobileControlLimits.sessionIdleTtlMs,
          absoluteExpiresAt,
        )
        tx.insert(mobileDeviceSessions)
          .values({
            id: proof.sessionId,
            deviceId: proof.deviceId,
            tokenHash: digest(token),
            issuedAt: toDate(now),
            lastSeenAt: toDate(now),
            idleExpiresAt: toDate(idleExpiresAt),
            absoluteExpiresAt: toDate(absoluteExpiresAt),
            scopeVersion: activeDevice.scopeVersion,
            rotation: 0,
          })
          .run()
        tx.update(mobileDevices)
          .set({ lastSeenAt: toDate(now) })
          .where(eq(mobileDevices.id, proof.deviceId))
          .run()
        return mobileSessionCredentialSchema.parse({
          session: sessionFromRow(
            tx
              .select()
              .from(mobileDeviceSessions)
              .where(eq(mobileDeviceSessions.id, proof.sessionId))
              .get()!,
          ),
          sessionToken: token,
        })
      })
      this.audit(proof.deviceId, "session-created", "allowed", { rotation: 0 })
      return credential
    } catch (error) {
      const normalized = normalizeDatabaseError(error)
      this.audit(proof.deviceId, "session-created", "denied", { reason: normalized.code })
      throw normalized
    }
  }

  authenticateSession(input: MobileSessionProof): MobileSession {
    return this.useSession(input, false).session
  }

  rotateSession(input: MobileSessionProof): MobileSessionCredential {
    const result = this.useSession(input, true)
    if (!result.sessionToken) throw new Error("Session rotation did not issue a token.")
    return mobileSessionCredentialSchema.parse({
      session: result.session,
      sessionToken: result.sessionToken,
    })
  }

  revokeActiveSessionsForRuntimeRestart(): number {
    const active = this.options.database
      .select({ deviceId: mobileDeviceSessions.deviceId })
      .from(mobileDeviceSessions)
      .where(isNull(mobileDeviceSessions.revokedAt))
      .all()
    if (active.length === 0) return 0
    const now = this.now()
    const changed = this.options.database
      .update(mobileDeviceSessions)
      .set({ revokedAt: toDate(now) })
      .where(isNull(mobileDeviceSessions.revokedAt))
      .run().changes
    for (const deviceId of new Set(active.map((row) => row.deviceId))) {
      this.audit(deviceId, "sessions-revoked-on-restart", "allowed", { count: changed })
    }
    return changed
  }

  listDevices(): MobileDeviceRecord[] {
    return this.options.database
      .select()
      .from(mobileDevices)
      .orderBy(asc(mobileDevices.createdAt), asc(mobileDevices.id))
      .all()
      .map(deviceFromRow)
  }

  renameDevice(deviceId: string, name: string): MobileDeviceRecord {
    try {
      const device = this.requireActiveDevice(deviceId)
      const parsed = mobileDeviceRecordSchema.parse({ ...deviceFromRow(device), name })
      const updated = this.options.database
        .update(mobileDevices)
        .set({ name: parsed.name })
        .where(and(eq(mobileDevices.id, deviceId), isNull(mobileDevices.revokedAt)))
        .returning()
        .get()
      if (!updated) throw new MobilePairingError("device-revoked", "Device is revoked.")
      this.audit(deviceId, "device-renamed", "allowed", {})
      return deviceFromRow(updated)
    } catch (error) {
      const normalized = normalizeDatabaseError(error)
      this.audit(deviceId, "device-renamed", "denied", { reason: normalized.code })
      throw normalized
    }
  }

  async revokeDevice(deviceId: string, reason: MobileDeviceRevocationReason): Promise<void> {
    const now = this.now()
    const result = this.options.database.transaction((tx) => {
      const device = tx.select().from(mobileDevices).where(eq(mobileDevices.id, deviceId)).get()
      if (!device) throw new MobilePairingError("device-not-found", "Mobile device was not found.")
      tx.update(mobileDevices)
        .set({
          revokedAt: device.revokedAt ?? toDate(now),
          revocationReason: device.revocationReason ?? reason,
          scopeVersion: device.revokedAt ? device.scopeVersion : device.scopeVersion + 1,
        })
        .where(eq(mobileDevices.id, deviceId))
        .run()
      tx.update(mobileDeviceSessions)
        .set({ revokedAt: toDate(now) })
        .where(
          and(eq(mobileDeviceSessions.deviceId, deviceId), isNull(mobileDeviceSessions.revokedAt)),
        )
        .run()
      tx.update(mobileAuthChallenges)
        .set({ consumedAt: toDate(now) })
        .where(
          and(eq(mobileAuthChallenges.deviceId, deviceId), isNull(mobileAuthChallenges.consumedAt)),
        )
        .run()
      return { alreadyRevoked: Boolean(device.revokedAt) }
    })
    this.audit(deviceId, "device-revoked", "allowed", { reason, ...result })
    try {
      await this.connections.terminateDevice(deviceId, "device-revoked")
    } catch {
      this.audit(deviceId, "connection-termination", "failed", { reason: "hook-failed" })
      throw new MobilePairingError(
        "device-revoked",
        "Device is revoked, but connection termination reported a failure.",
      )
    }
  }

  listAuditRecords(): Array<{
    id: string
    deviceId: string | null
    event: string
    outcome: AuditOutcome
    summary: Record<string, unknown>
    createdAt: number
  }> {
    return this.options.database
      .select()
      .from(mobileDeviceAuditRecords)
      .orderBy(asc(mobileDeviceAuditRecords.createdAt), asc(mobileDeviceAuditRecords.id))
      .all()
      .map((row) => ({
        ...row,
        outcome: row.outcome as AuditOutcome,
        summary: JSON.parse(row.summary) as Record<string, unknown>,
        createdAt: row.createdAt.getTime(),
      }))
  }

  private useSession(
    input: MobileSessionProof,
    rotate: boolean,
  ): { session: MobileSession; sessionToken?: string } {
    let proof: MobileSessionProof
    try {
      proof = mobileSessionProofSchema.parse(input)
    } catch {
      this.audit(null, rotate ? "session-rotated" : "session-authenticated", "denied", {
        reason: "invalid-request",
      })
      throw new MobilePairingError("invalid-request", "Session proof is invalid.")
    }
    const now = this.now()
    const current = this.options.database
      .select()
      .from(mobileDeviceSessions)
      .where(eq(mobileDeviceSessions.id, proof.sessionId))
      .get()
    const device = this.options.database
      .select()
      .from(mobileDevices)
      .where(eq(mobileDevices.id, proof.deviceId))
      .get()
    try {
      assertUsableSession(current, device, proof, now)
      if (!verifyDeviceSignature(device!, mobileSessionProofMessage(proof), proof.signature))
        throw new MobilePairingError("signature-invalid", "Session signature is invalid.")
      const nextToken = rotate ? this.randomSecret() : undefined
      const result = this.options.database.transaction((tx) => {
        const activeDevice = tx
          .select()
          .from(mobileDevices)
          .where(and(eq(mobileDevices.id, proof.deviceId), isNull(mobileDevices.revokedAt)))
          .get()
        const session = tx
          .select()
          .from(mobileDeviceSessions)
          .where(eq(mobileDeviceSessions.id, proof.sessionId))
          .get()
        assertUsableSession(session, activeDevice, proof, now)
        tx.delete(mobileSessionNonces)
          .where(
            lt(mobileSessionNonces.usedAt, toDate(now - mobileControlLimits.sessionAbsoluteTtlMs)),
          )
          .run()
        try {
          tx.insert(mobileSessionNonces)
            .values({
              sessionId: proof.sessionId,
              nonceHash: digest(proof.nonce),
              usedAt: toDate(now),
            })
            .run()
        } catch {
          throw new MobilePairingError("replay", "Session nonce was already used.")
        }
        const idleExpiresAt = Math.min(
          now + mobileControlLimits.sessionIdleTtlMs,
          session!.absoluteExpiresAt.getTime(),
        )
        const updated = tx
          .update(mobileDeviceSessions)
          .set({
            lastSeenAt: toDate(now),
            idleExpiresAt: toDate(idleExpiresAt),
            ...(nextToken ? { tokenHash: digest(nextToken), rotation: proof.rotation + 1 } : {}),
          })
          .where(
            and(
              eq(mobileDeviceSessions.id, proof.sessionId),
              eq(mobileDeviceSessions.deviceId, proof.deviceId),
              eq(mobileDeviceSessions.tokenHash, digest(proof.sessionToken)),
              eq(mobileDeviceSessions.rotation, proof.rotation),
              isNull(mobileDeviceSessions.revokedAt),
              gt(mobileDeviceSessions.idleExpiresAt, toDate(now)),
              gt(mobileDeviceSessions.absoluteExpiresAt, toDate(now)),
            ),
          )
          .returning()
          .get()
        if (!updated)
          throw new MobilePairingError("session-invalid", "Session changed during authentication.")
        tx.update(mobileDevices)
          .set({ lastSeenAt: toDate(now) })
          .where(and(eq(mobileDevices.id, proof.deviceId), isNull(mobileDevices.revokedAt)))
          .run()
        return {
          session: sessionFromRow(updated),
          ...(nextToken ? { sessionToken: nextToken } : {}),
        }
      })
      this.audit(proof.deviceId, rotate ? "session-rotated" : "session-authenticated", "allowed", {
        rotation: result.session.rotation,
      })
      return result
    } catch (error) {
      const normalized = normalizeDatabaseError(error)
      this.audit(proof.deviceId, rotate ? "session-rotated" : "session-authenticated", "denied", {
        reason: normalized.code,
      })
      throw normalized
    }
  }

  private requireActiveDevice(deviceId: string): DeviceRow {
    const device = this.options.database
      .select()
      .from(mobileDevices)
      .where(eq(mobileDevices.id, deviceId))
      .get()
    assertActiveDevice(device)
    return device!
  }

  private prepareChallengeCapacity(now: number): void {
    this.options.database
      .delete(mobileAuthChallenges)
      .where(
        or(
          isNotNull(mobileAuthChallenges.consumedAt),
          lte(mobileAuthChallenges.expiresAt, toDate(now)),
        ),
      )
      .run()
    const total =
      this.options.database.select({ value: count() }).from(mobileAuthChallenges).get()?.value ?? 0
    if (total >= mobileControlLimits.challengeEntries) {
      throw new MobilePairingError(
        "invalid-request",
        "Mobile authentication challenge capacity was reached.",
      )
    }
  }

  private audit(
    deviceId: string | null,
    event: string,
    outcome: AuditOutcome,
    summary: Record<string, string | number | boolean>,
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
        event,
        outcome,
        summary: JSON.stringify(summary),
        createdAt: toDate(this.now()),
      })
      .run()
  }
}

export function mobileChallengeProofMessage(
  proof: Pick<MobileChallengeProof, "sessionId" | "deviceId" | "challenge">,
): Buffer {
  return Buffer.from(
    `flapstack-mobile-challenge-v1\n${proof.sessionId}\n${proof.deviceId}\n${digest(proof.challenge)}`,
    "utf8",
  )
}

export function mobileSessionProofMessage(
  proof: Pick<
    MobileSessionProof,
    "sessionId" | "deviceId" | "sessionToken" | "nonce" | "issuedAt" | "rotation"
  >,
): Buffer {
  return Buffer.from(
    [
      "flapstack-mobile-session-v1",
      proof.sessionId,
      proof.deviceId,
      digest(proof.sessionToken),
      digest(proof.nonce),
      String(proof.issuedAt),
      String(proof.rotation),
    ].join("\n"),
    "utf8",
  )
}

function assertUsableSession(
  session: SessionRow | undefined,
  device: DeviceRow | undefined,
  proof: MobileSessionProof,
  now: number,
): void {
  assertActiveDevice(device)
  if (
    !session ||
    session.deviceId !== proof.deviceId ||
    session.tokenHash !== digest(proof.sessionToken)
  )
    throw new MobilePairingError("session-invalid", "Session is invalid for this device.")
  if (session.rotation !== proof.rotation)
    throw new MobilePairingError("rotation-mismatch", "Session rotation is stale.")
  if (
    session.revokedAt ||
    session.idleExpiresAt.getTime() <= now ||
    session.absoluteExpiresAt.getTime() <= now
  )
    throw new MobilePairingError("session-expired", "Session expired or was revoked.")
  if (proof.issuedAt > now || now - proof.issuedAt > mobileControlLimits.commandTtlMs)
    throw new MobilePairingError("session-expired", "Session proof is outside its time window.")
}

function assertActiveDevice(device: DeviceRow | undefined): void {
  if (!device) throw new MobilePairingError("device-not-found", "Mobile device was not found.")
  if (device.revokedAt) throw new MobilePairingError("device-revoked", "Mobile device is revoked.")
}

function parsePublicKey(value: string, algorithm: "Ed25519" | "P-256"): KeyObject {
  const normalized = value.trim()
  if (
    !normalized.startsWith("-----BEGIN PUBLIC KEY-----") ||
    !normalized.endsWith("-----END PUBLIC KEY-----")
  )
    throw new Error("Only SPKI public keys are accepted.")
  const key = createPublicKey(normalized)
  if (algorithm === "Ed25519" && key.asymmetricKeyType !== "ed25519")
    throw new Error("Public key algorithm mismatch.")
  if (
    algorithm === "P-256" &&
    (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1")
  )
    throw new Error("Public key algorithm mismatch.")
  return key
}

function exportPublicKey(key: KeyObject): string {
  return key.export({ type: "spki", format: "pem" }).toString().trim()
}

function verifyDeviceSignature(device: DeviceRow, message: Buffer, signature: string): boolean {
  try {
    const key = parsePublicKey(device.publicKey, device.publicKeyAlgorithm as "Ed25519" | "P-256")
    return verifySignature(
      device.publicKeyAlgorithm === "Ed25519" ? null : "sha256",
      message,
      key,
      Buffer.from(signature, "base64url"),
    )
  } catch {
    return false
  }
}

function publicKeyFingerprint(key: KeyObject): string {
  return createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex")
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function toDate(milliseconds: number): Date {
  return new Date(Math.floor(milliseconds / 1_000) * 1_000)
}

function deviceFromRow(row: DeviceRow): MobileDeviceRecord {
  return mobileDeviceRecordSchema.parse({
    deviceId: row.id,
    name: row.name,
    publicKeyAlgorithm: row.publicKeyAlgorithm,
    publicKey: row.publicKey,
    createdAt: row.createdAt.getTime(),
    ...(row.lastSeenAt ? { lastSeenAt: row.lastSeenAt.getTime() } : {}),
    ...(row.revokedAt ? { revokedAt: row.revokedAt.getTime() } : {}),
    scopeVersion: row.scopeVersion,
  })
}

function sessionFromRow(row: SessionRow): MobileSession {
  return mobileSessionSchema.parse({
    sessionId: row.id,
    deviceId: row.deviceId,
    issuedAt: row.issuedAt.getTime(),
    lastSeenAt: row.lastSeenAt.getTime(),
    idleExpiresAt: row.idleExpiresAt.getTime(),
    absoluteExpiresAt: row.absoluteExpiresAt.getTime(),
    scopeVersion: row.scopeVersion,
    rotation: row.rotation,
    ...(row.revokedAt ? { revokedAt: row.revokedAt.getTime() } : {}),
  })
}

function normalizeDatabaseError(error: unknown): MobilePairingError {
  if (error instanceof MobilePairingError) return error
  if (
    error instanceof Error &&
    /mobile_devices_public_key_idx|UNIQUE constraint failed/.test(error.message)
  )
    return new MobilePairingError("credential-exists", "Device credential is already registered.")
  return new MobilePairingError("invalid-request", "Mobile pairing operation failed safely.")
}
