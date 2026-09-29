import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto"
import { performance } from "node:perf_hooks"
import WebSocket from "ws"
import {
  mobilePairingOfferSchema,
  mobilePairingResultSchema,
  mobileSessionChallengeSchema,
  mobileSessionCredentialSchema,
  mobileCommandEnvelopeSchema,
  parseMobileSnapshotEnvelope,
  parseMobileEventEnvelope,
  evaluateMobileEventCursor,
  mobileControlLimits,
  type MobileSessionCredential,
  type MobileSnapshotEnvelope,
} from "../../../shared/mobile-control"
import type { RemoteIdentity } from "./identity"
import { RemoteTransport, remoteEndpoint } from "./transport"

const digest = (value: string) => createHash("sha256").update(value).digest("hex")
const nonce = () => randomBytes(32).toString("base64url")
type IdentityStore = { load(): RemoteIdentity | null; save(identity: RemoteIdentity): "encrypted" }
type Receipt = {
  commandId: string
  host: string
  targetId: string
  status: string
  summary?: string
}

export class RemoteComputerClient {
  private identity: RemoteIdentity | null = null
  private transport: RemoteTransport | null = null
  private socket: WebSocket | null = null
  private epoch = 0
  private session: MobileSessionCredential | null = null
  private clock: { server: number; monotonic: number } | null = null
  private snapshot: MobileSnapshotEnvelope | null = null
  private ready = false
  private grant = ""
  private connectionId = ""
  private pending: Receipt | null = null
  private pendingExpiresAt = 0
  private receipt: Receipt | null = null
  private sentTargets = new Set<string>()
  private error: string | null = null
  private busy = false
  constructor(
    private readonly store: IdentityStore,
    private readonly createTransport = (endpoint: string, pin: string) =>
      new RemoteTransport(endpoint, pin),
    private readonly monotonic = () => performance.now(),
  ) {}

  status() {
    this.identity ??= this.store.load()
    const now = this.now()
    if (this.pending && now !== null && now >= this.pendingExpiresAt) {
      this.receipt = {
        ...this.pending,
        status: "unknown",
        summary: "No host receipt arrived before expiry. Check the host before submitting again.",
      }
      this.pending = null
    }
    const current =
      this.ready &&
      this.socket?.readyState === WebSocket.OPEN &&
      now !== null &&
      this.snapshot !== null &&
      now < this.snapshot.freshUntil &&
      now < (this.session?.session.idleExpiresAt ?? 0) &&
      now < (this.session?.session.absoluteExpiresAt ?? 0)
    return {
      host: this.identity
        ? {
            endpoint: this.identity.endpoint,
            fingerprint: this.identity.fingerprint,
            label: this.identity.label,
            deviceId: this.identity.deviceId,
          }
        : null,
      connectionId: this.connectionId,
      current,
      busy: this.busy,
      grantId: this.grant,
      snapshot: this.snapshot,
      pending: this.pending,
      receipt: this.receipt,
      error: this.error,
    }
  }
  disconnect() {
    this.epoch++
    this.busy = false
    this.ready = false
    this.clock = null
    this.session = null
    this.socket?.removeAllListeners()
    this.socket?.on("error", () => {})
    this.socket?.terminate()
    this.socket = null
    this.transport?.close()
    this.transport = null
    if (this.pending) {
      this.receipt = {
        ...this.pending,
        status: "unknown",
        summary: "Connection ended before a host receipt. Check the host before submitting again.",
      }
      this.pending = null
    }
    return this.status()
  }
  async pair(input: {
    offer: unknown
    label: string
    confirmedEndpoint: string
    confirmedFingerprint: string
  }) {
    const offer = mobilePairingOfferSchema.parse(input.offer)
    const endpoint = remoteEndpoint(offer.endpoint).origin
    if (
      endpoint !== input.confirmedEndpoint ||
      offer.certificateFingerprint !== input.confirmedFingerprint
    )
      throw new Error("Confirm the exact endpoint and fingerprint shown by the host.")
    this.disconnect()
    this.snapshot = null
    this.receipt = null
    this.busy = true
    const epoch = this.epoch
    const transport = (this.transport = this.createTransport(
      endpoint,
      offer.certificateFingerprint,
    ))
    try {
      const keys = generateKeyPairSync("ec", {
        namedCurve: "prime256v1",
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      })
      const paired = mobilePairingResultSchema.parse(
        await transport.post("/mobile/v1/pair", {
          protocolVersion: 1,
          oneTimeToken: offer.oneTimeToken,
          certificateFingerprint: offer.certificateFingerprint,
          deviceName: input.label,
          publicKeyAlgorithm: "P-256",
          publicKey: keys.publicKey,
        }),
      )
      this.checkEpoch(epoch)
      if (
        paired.device.publicKey !== keys.publicKey.trim() ||
        paired.device.deviceId !== paired.challenge.deviceId
      )
        throw new Error("Host returned a mismatched device identity.")
      const identity = {
        endpoint,
        fingerprint: offer.certificateFingerprint,
        label: input.label,
        deviceId: paired.device.deviceId,
        privateKey: keys.privateKey,
      }
      this.store.save(identity)
      this.identity = identity
      this.error = null
      return this.status()
    } catch (error) {
      if (epoch === this.epoch)
        this.error =
          "Pairing failed. Check the host offer and protected storage, then try a fresh offer."
      throw error
    } finally {
      if (epoch === this.epoch) {
        this.busy = false
        transport.close()
        this.transport = null
      }
    }
  }
  async connect(grantId: string) {
    this.identity ??= this.store.load()
    if (!this.identity) throw new Error("Pair a remote computer first.")
    this.disconnect()
    this.busy = true
    this.error = null
    this.snapshot = null
    this.grant = grantId
    this.connectionId = randomUUID()
    const epoch = this.epoch,
      identity = this.identity
    const transport = (this.transport = this.createTransport(
      identity.endpoint,
      identity.fingerprint,
    ))
    try {
      const challenge = mobileSessionChallengeSchema.parse(
        await transport.post("/mobile/v1/challenge", { deviceId: identity.deviceId }),
      )
      this.checkEpoch(epoch)
      if (challenge.deviceId !== identity.deviceId)
        throw new Error("Wrong remote device challenge.")
      const proof = {
        sessionId: challenge.sessionId,
        deviceId: identity.deviceId,
        challenge: challenge.challenge,
      }
      const signature = this.sign(
        `flapstack-mobile-challenge-v1\n${proof.sessionId}\n${proof.deviceId}\n${digest(proof.challenge)}`,
        identity,
      )
      const credential = mobileSessionCredentialSchema.parse(
        await transport.post("/mobile/v1/authenticate", { ...proof, signature }),
      )
      this.checkEpoch(epoch)
      if (
        credential.session.deviceId !== identity.deviceId ||
        credential.session.sessionId !== challenge.sessionId ||
        credential.session.revokedAt !== undefined
      )
        throw new Error("Host session identity mismatch.")
      this.session = credential
      this.clock = { server: credential.session.issuedAt, monotonic: this.monotonic() }
      const unsigned = {
        sessionId: credential.session.sessionId,
        deviceId: identity.deviceId,
        sessionToken: credential.sessionToken,
        nonce: nonce(),
        issuedAt: this.now()!,
        rotation: credential.session.rotation,
      }
      const sessionSignature = this.sign(
        [
          "flapstack-mobile-session-v1",
          unsigned.sessionId,
          unsigned.deviceId,
          digest(unsigned.sessionToken),
          digest(unsigned.nonce),
          String(unsigned.issuedAt),
          String(unsigned.rotation),
        ].join("\n"),
        identity,
      )
      const socket = (this.socket = transport.socket())
      socket.on("open", () => {
        if (epoch === this.epoch)
          socket.send(
            JSON.stringify({
              protocolVersion: 1,
              kind: "subscribe",
              proof: { ...unsigned, signature: sessionSignature },
              authorityGrantId: grantId,
            }),
          )
      })
      socket.on("message", (data) => {
        if (epoch !== this.epoch) return
        try {
          this.receive(JSON.parse(data.toString()))
        } catch {
          this.fail("Remote state could not be verified. Reconnect for a fresh snapshot.")
        }
      })
      socket.on("close", () => {
        if (epoch === this.epoch)
          this.fail("Remote connection closed. Check the host grant, then reconnect.")
      })
      socket.on("error", () => {
        if (epoch === this.epoch)
          this.fail("Remote connection failed. Verify the endpoint and fingerprint.")
      })
      return this.status()
    } catch (error) {
      if (epoch === this.epoch)
        this.fail("Could not authenticate with the remote host. Check pairing and grant.")
      throw error
    } finally {
      if (epoch === this.epoch) this.busy = false
    }
  }
  private receive(value: unknown) {
    const snapshot = parseMobileSnapshotEnvelope(value)
    if (snapshot.ok) {
      const next = snapshot.value
      if (this.ready) throw new Error("Unexpected replacement snapshot")
      if (this.snapshot) {
        if (
          next.snapshotId !== this.snapshot.snapshotId ||
          next.scopeVersion !== this.snapshot.scopeVersion ||
          next.sequence !== this.snapshot.sequence
        )
          throw new Error("Snapshot pages changed")
        next.items = [...this.snapshot.items, ...next.items]
      }
      if (
        next.items.length > mobileControlLimits.snapshotItems ||
        new Set(next.items.map((item) => item.kind + item.id)).size !== next.items.length
      )
        throw new Error("Invalid snapshot size or duplicate")
      this.snapshot = next
      if (next.nextCursor)
        this.socket!.send(
          JSON.stringify({ protocolVersion: 1, kind: "snapshot.page", cursor: next.nextCursor }),
        )
      else this.ready = true
      return
    }
    const parsed = parseMobileEventEnvelope(value)
    if (!parsed.ok || !this.snapshot || !this.ready) throw new Error("Invalid remote event")
    const event = parsed.value
    if (evaluateMobileEventCursor(this.snapshot, event) !== "accept")
      throw new Error("Stale remote event")
    this.snapshot.sequence = event.sequence
    const payload = event.payload
    if (payload.type === "scope.revoked" || payload.type === "resnapshot.required") {
      this.fail("Remote authority changed. Reconnect for current access.")
      return
    }
    if (payload.type === "entity.upsert") {
      this.snapshot.items = this.snapshot.items.filter(
        (item) => item.kind !== payload.item.kind || item.id !== payload.item.id,
      )
      this.snapshot.items.push(payload.item)
      if (this.snapshot.items.length > mobileControlLimits.snapshotItems)
        throw new Error("Too many remote items")
    } else if (payload.type === "entity.remove")
      this.snapshot.items = this.snapshot.items.filter(
        (item) => item.kind !== payload.resource.kind || item.id !== payload.resource.id,
      )
    else if (
      payload.type === "action.result" &&
      this.pending?.commandId === payload.commandId &&
      payload.action === "clarification.answer"
    ) {
      this.receipt = { ...this.pending, status: payload.status, summary: payload.summary }
      this.pending = null
    }
    this.snapshot.freshUntil = Math.min(
      (this.now() ?? 0) + mobileControlLimits.snapshotFreshnessMs,
      event.occurredAt + mobileControlLimits.snapshotFreshnessMs,
    )
  }
  answer(input: {
    connectionId: string
    targetId: string
    targetVersion: number
    scopeVersion: number
    answers: Record<string, string[]>
    confirmed: true
  }) {
    const state = this.status()
    if (
      !state.current ||
      input.connectionId !== this.connectionId ||
      input.confirmed !== true ||
      this.pending ||
      input.scopeVersion !== this.snapshot?.scopeVersion
    )
      throw new Error("Remote state is stale or changed. Reconnect and review the exact target.")
    const target = this.snapshot!.items.find(
      (item) => item.kind === "agent-input" && item.id === input.targetId,
    )
    const key = `${this.identity!.endpoint}:${input.targetId}:${input.targetVersion}`
    if (
      !target ||
      target.kind !== "agent-input" ||
      target.version !== input.targetVersion ||
      this.sentTargets.has(key)
    )
      throw new Error("Target changed or this answer was already submitted. Check the host.")
    if (Object.keys(input.answers).some((id) => !target.questions.some((q) => q.id === id)))
      throw new Error("Answers contain an unknown question.")
    for (const question of target.questions) {
      const values = input.answers[question.id] ?? []
      if (!values.length || (!question.multiSelect && values.length !== 1))
        throw new Error(`Review the answer for ${question.question}`)
      if (!question.allowCustom && values.some((value) => !question.options.includes(value)))
        throw new Error(`Choose an offered answer for ${question.question}`)
    }
    const now = this.now()!
    const command = mobileCommandEnvelopeSchema.parse({
      protocolVersion: 1,
      kind: "command",
      commandId: randomUUID(),
      sessionId: this.session!.session.sessionId,
      deviceId: this.identity!.deviceId,
      authorityGrantId: this.grant,
      nonce: nonce(),
      issuedAt: now,
      expiresAt: now + 30_000,
      scopeVersion: this.snapshot!.scopeVersion,
      deviceConfirmedAt: now,
      target: { kind: "agent-input", id: target.id, version: target.version },
      action: { type: "clarification.answer", requestId: target.id, answers: input.answers },
    })
    this.sentTargets.add(key)
    this.pending = {
      commandId: command.commandId,
      host: this.identity!.endpoint,
      targetId: target.id,
      status: "pending",
    }
    this.receipt = null
    this.pendingExpiresAt = command.expiresAt
    this.socket!.send(JSON.stringify(command), (error) => {
      if (error && input.connectionId === this.connectionId)
        this.fail("Answer delivery is unknown. Check the host before trying again.")
    })
    return this.status()
  }
  private sign(message: string, identity: RemoteIdentity) {
    return sign("sha256", Buffer.from(message), identity.privateKey).toString("base64url")
  }
  private now() {
    if (!this.clock) return null
    const elapsed = this.monotonic() - this.clock.monotonic
    return Number.isFinite(elapsed) && elapsed >= 0 ? this.clock.server + Math.floor(elapsed) : null
  }
  private checkEpoch(epoch: number) {
    if (epoch !== this.epoch) throw new Error("Remote connection changed.")
  }
  private fail(message: string) {
    this.disconnect()
    this.error = message
  }
}
