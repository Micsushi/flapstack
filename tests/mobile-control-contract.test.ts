import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  MOBILE_CONTROL_PROTOCOL_VERSION,
  MOBILE_REDACTED,
  MobileReplayWindow,
  authorizeMobileCommand,
  canBindMobileBridge,
  classifyMobileBindAddress,
  evaluateMobileClientState,
  evaluateMobileEventCursor,
  mobileActionCatalog,
  mobileActionIds,
  mobileAuthorityGrantSchema,
  mobileBridgeContract,
  mobileControlLimits,
  mobileDeviceRecordSchema,
  mobileEventEnvelopeSchema,
  mobilePairingOfferSchema,
  mobilePairingRequestSchema,
  mobileRevocationSchema,
  mobileSessionSchema,
  mobileSnapshotEnvelopeSchema,
  mobileThreatModel,
  mobileUnsupportedActionIds,
  parseMobileCommandEnvelope,
  redactMobilePayload,
} from "../src/shared/mobile-control"

const now = 2_000_000

const device = mobileDeviceRecordSchema.parse({
  deviceId: "device-1",
  name: "Personal phone",
  publicKeyAlgorithm: "Ed25519",
  publicKey: "A".repeat(64),
  createdAt: now - 10_000,
  lastSeenAt: now,
  scopeVersion: 1,
})

const session = mobileSessionSchema.parse({
  sessionId: "session-1",
  deviceId: device.deviceId,
  issuedAt: now - 10_000,
  lastSeenAt: now,
  idleExpiresAt: now + 60_000,
  absoluteExpiresAt: now + 120_000,
  scopeVersion: 1,
  rotation: 0,
})

const grant = mobileAuthorityGrantSchema.parse({
  grantId: "grant-1",
  deviceId: device.deviceId,
  authority: ["control"],
  capabilities: ["orchestration.pause"],
  resources: [{ kind: "orchestration", id: "task-1" }],
  issuedAt: now - 10_000,
  expiresAt: now + 120_000,
  scopeVersion: 1,
})

function commandFixture(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: MOBILE_CONTROL_PROTOCOL_VERSION,
    kind: "command",
    commandId: "command-1",
    sessionId: session.sessionId,
    deviceId: device.deviceId,
    authorityGrantId: grant.grantId,
    nonce: "n".repeat(32),
    issuedAt: now - 1_000,
    expiresAt: now + 30_000,
    scopeVersion: 1,
    target: { kind: "orchestration", id: "task-1", version: 4 },
    action: { type: "orchestration.pause" },
    ...overrides,
  }
}

describe("mobile-control-contract", () => {
  it("keeps bridge and every action default-off on approved private interfaces only", () => {
    expect(mobileBridgeContract.enabledByDefault).toBe(false)
    expect(Object.values(mobileActionCatalog).every((action) => !action.enabledByDefault)).toBe(
      true,
    )
    expect(canBindMobileBridge("192.168.1.22", ["192.168.1.22"])).toBe(true)
    expect(canBindMobileBridge("100.96.0.3", ["100.96.0.3"])).toBe(true)
    expect(canBindMobileBridge("192.168.1.22", ["192.168.1.23"])).toBe(false)
    expect(canBindMobileBridge("0.0.0.0", ["0.0.0.0"])).toBe(false)
    expect(canBindMobileBridge("8.8.8.8", ["8.8.8.8"])).toBe(false)
    expect(classifyMobileBindAddress("::1")).toBe("loopback")
    expect(classifyMobileBindAddress("fd7a:115c:a1e0::1")).toBe("private")
  })

  it("documents all material trust boundaries and fail-closed behavior", () => {
    expect(mobileThreatModel.map((entry) => entry.threat)).toEqual(
      expect.arrayContaining([
        "public-network-exposure",
        "pairing-token-theft-or-reuse",
        "replayed-or-stale-mutation",
        "over-broad-mobile-authority",
        "secret-or-hidden-reasoning-disclosure",
        "revocation-race",
        "offline-stale-mutation",
      ]),
    )
    expect(mobileThreatModel.every((entry) => entry.control && entry.failure)).toBe(true)
  })

  it("allows no shell, git, deploy, secret, terminal, vendor-session, or fake service action", () => {
    const allowed = new Set<string>(mobileActionIds)
    for (const forbidden of mobileUnsupportedActionIds) expect(allowed.has(forbidden)).toBe(false)

    for (const action of Object.values(mobileActionCatalog)) {
      const modulePath = resolve(action.service.module)
      expect(existsSync(modulePath), `${action.id} service module`).toBe(true)
      const source = readFileSync(modulePath, "utf8")
      const operationRoot = action.service.operation.split(/[.:]/, 1)[0]
      expect(source, `${action.id} service operation`).toContain(operationRoot)
      expect(["bounded-input", "lifecycle", "privileged"]).toContain(action.risk)
      expect(["device-confirmation", "step-up-or-desktop", "desktop-only"]).toContain(
        action.approval,
      )
    }
  })

  it("rejects unsupported, arbitrary, and oversize command envelopes", () => {
    expect(
      parseMobileCommandEnvelope({
        ...commandFixture(),
        action: { type: "shell.execute", command: "rm -rf /" },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid-envelope" } })
    expect(
      parseMobileCommandEnvelope({
        ...commandFixture(),
        action: { type: "orchestration.pause", command: "git push" },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid-envelope" } })
    expect(
      parseMobileCommandEnvelope({
        ...commandFixture(),
        padding: "x".repeat(mobileControlLimits.commandBytes),
      }),
    ).toMatchObject({ ok: false, error: { code: "oversize" } })
  })

  it("authorizes exact enabled capability and rejects replay, stale target, and missing scope", () => {
    const parsed = parseMobileCommandEnvelope(commandFixture())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error("fixture failed")
    const replay = new MobileReplayWindow()
    const input = {
      now,
      connected: true,
      bridgeEnabled: true,
      device,
      session,
      grant,
      trustedTarget: { kind: "orchestration" as const, id: "task-1", version: 4 },
      enabledActions: ["orchestration.pause" as const],
      stepUpVerified: false,
      replay,
    }
    expect(authorizeMobileCommand(parsed.value, input)).toMatchObject({ ok: true })
    expect(authorizeMobileCommand(parsed.value, input)).toMatchObject({
      ok: false,
      error: { code: "replay" },
    })

    const reusedNonce = parseMobileCommandEnvelope(commandFixture({ commandId: "command-new-id" }))
    if (!reusedNonce.ok) throw new Error("fixture failed")
    expect(authorizeMobileCommand(reusedNonce.value, input)).toMatchObject({
      ok: false,
      error: { code: "replay" },
    })
    const reusedCommandId = parseMobileCommandEnvelope(commandFixture({ nonce: "z".repeat(32) }))
    if (!reusedCommandId.ok) throw new Error("fixture failed")
    expect(authorizeMobileCommand(reusedCommandId.value, input)).toMatchObject({
      ok: false,
      error: { code: "replay" },
    })

    const fresh = parseMobileCommandEnvelope(
      commandFixture({ commandId: "command-2", nonce: "r".repeat(32) }),
    )
    if (!fresh.ok) throw new Error("fixture failed")
    expect(
      authorizeMobileCommand(fresh.value, {
        ...input,
        enabledActions: [],
        replay: new MobileReplayWindow(),
      }),
    ).toMatchObject({ ok: false, error: { code: "capability-disabled" } })
    expect(
      authorizeMobileCommand(fresh.value, {
        ...input,
        trustedTarget: { kind: "orchestration", id: "task-1", version: 5 },
        replay: new MobileReplayWindow(),
      }),
    ).toMatchObject({ ok: false, error: { code: "stale-target" } })
    expect(
      authorizeMobileCommand(fresh.value, {
        ...input,
        session: { ...session, scopeVersion: 2 },
        replay: new MobileReplayWindow(),
      }),
    ).toMatchObject({ ok: false, error: { code: "stale-scope" } })
    expect(
      authorizeMobileCommand(fresh.value, {
        ...input,
        grant: mobileAuthorityGrantSchema.parse({
          ...grant,
          resources: [{ kind: "orchestration", id: "task-2" }],
        }),
        replay: new MobileReplayWindow(),
      }),
    ).toMatchObject({ ok: false, error: { code: "out-of-scope" } })
  })

  it("requires step-up for privileged cancellation and approval", () => {
    const cancelGrant = mobileAuthorityGrantSchema.parse({
      ...grant,
      capabilities: ["orchestration.cancel"],
    })
    const parsed = parseMobileCommandEnvelope(
      commandFixture({
        commandId: "command-cancel",
        nonce: "c".repeat(32),
        action: { type: "orchestration.cancel" },
      }),
    )
    if (!parsed.ok) throw new Error("fixture failed")
    const base = {
      now,
      connected: true,
      bridgeEnabled: true,
      device,
      session,
      grant: cancelGrant,
      trustedTarget: { kind: "orchestration" as const, id: "task-1", version: 4 },
      enabledActions: ["orchestration.cancel" as const],
      replay: new MobileReplayWindow(),
    }
    expect(authorizeMobileCommand(parsed.value, { ...base, stepUpVerified: false })).toMatchObject({
      ok: false,
      error: { code: "step-up-required" },
    })
    expect(
      authorizeMobileCommand(parsed.value, {
        ...base,
        stepUpVerified: true,
        replay: new MobileReplayWindow(),
      }),
    ).toMatchObject({ ok: true })
  })

  it("defines short-lived pairing, public-only device identity, bounded sessions, and revocation", () => {
    expect(
      mobilePairingOfferSchema.safeParse({
        protocolVersion: MOBILE_CONTROL_PROTOCOL_VERSION,
        endpoint: "https://192.168.1.22:4317",
        certificateFingerprint: `sha256:${"a".repeat(64)}`,
        oneTimeToken: "p".repeat(32),
        createdAt: now,
        expiresAt: now + mobileControlLimits.pairingTtlMs,
      }).success,
    ).toBe(true)
    expect(
      mobilePairingRequestSchema.safeParse({
        protocolVersion: MOBILE_CONTROL_PROTOCOL_VERSION,
        oneTimeToken: "p".repeat(32),
        certificateFingerprint: `sha256:${"a".repeat(64)}`,
        deviceName: "Phone",
        publicKeyAlgorithm: "Ed25519",
        publicKey: "A".repeat(64),
        privateKey: "must-never-cross-the-boundary",
      }).success,
    ).toBe(false)
    expect(
      mobileSessionSchema.safeParse({
        ...session,
        idleExpiresAt: now + mobileControlLimits.sessionIdleTtlMs + 1,
      }).success,
    ).toBe(false)
    expect(
      mobileSessionSchema.safeParse({
        ...session,
        absoluteExpiresAt: session.issuedAt,
      }).success,
    ).toBe(false)
    expect(
      mobileRevocationSchema.parse({
        deviceId: device.deviceId,
        revokedAt: now,
        reason: "device-lost",
        closeSessions: true,
      }),
    ).toMatchObject({ closeSessions: true })
  })

  it("uses monotonic snapshot/event cursors and forces resnapshot on gaps or scope changes", () => {
    const snapshot = mobileSnapshotEnvelopeSchema.parse({
      protocolVersion: MOBILE_CONTROL_PROTOCOL_VERSION,
      kind: "snapshot",
      snapshotId: "snapshot-1",
      scopeVersion: 1,
      sequence: 10,
      generatedAt: now,
      items: [
        {
          kind: "run",
          id: "run-1",
          version: 2,
          updatedAt: now,
          chatId: "chat-1",
          harness: "codex",
          status: "running",
          startedAt: now - 5_000,
        },
      ],
    })
    const event = mobileEventEnvelopeSchema.parse({
      protocolVersion: MOBILE_CONTROL_PROTOCOL_VERSION,
      kind: "event",
      eventId: "event-11",
      snapshotId: snapshot.snapshotId,
      scopeVersion: snapshot.scopeVersion,
      sequence: 11,
      occurredAt: now + 1,
      payload: { type: "heartbeat" },
    })
    const cursor = {
      snapshotId: snapshot.snapshotId,
      scopeVersion: snapshot.scopeVersion,
      sequence: snapshot.sequence,
    }
    expect(evaluateMobileEventCursor(cursor, event)).toBe("accept")
    expect(evaluateMobileEventCursor({ ...cursor, sequence: 11 }, event)).toBe("replay")
    expect(evaluateMobileEventCursor(cursor, { ...event, sequence: 12 })).toBe("resnapshot")
    expect(evaluateMobileEventCursor(cursor, { ...event, scopeVersion: 2 })).toBe("resnapshot")
  })

  it("redacts secrets and hidden reasoning and makes offline state stale and read-only", () => {
    expect(
      redactMobilePayload({
        apiKey: "sk-1234567890abcdef",
        hiddenReasoning: "private chain",
        detail: "Authorization: Bearer abc.def.ghi",
        nested: { accessToken: "token-value" },
      }),
    ).toEqual({
      apiKey: MOBILE_REDACTED,
      hiddenReasoning: MOBILE_REDACTED,
      detail: `Authorization: Bearer ${MOBILE_REDACTED}`,
      nested: { accessToken: MOBILE_REDACTED },
    })
    expect(
      evaluateMobileClientState({
        connected: false,
        snapshotGeneratedAt: now - 60_000,
        now,
        gapDetected: false,
        scopeVersionMatches: true,
      }),
    ).toEqual({
      mode: "offline-read-only",
      mutable: false,
      stale: true,
      lastUpdatedAt: now - 60_000,
    })
    expect(
      evaluateMobileClientState({
        connected: true,
        snapshotGeneratedAt: now,
        now,
        gapDetected: true,
        scopeVersionMatches: true,
      }).mode,
    ).toBe("resnapshot-required")
  })
})
