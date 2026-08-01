import { describe, expect, it } from "vitest"
import {
  MobileReplayWindow,
  authorizeMobileCommand,
  mobileActionCatalog,
  mobileActionIds,
  mobileCommandEnvelopeSchema,
} from "../src/shared/mobile-control"
import { MobileStepUpTokenService } from "../src/main/lib/mobile-actions"

const base = {
  protocolVersion: 1 as const,
  kind: "command" as const,
  commandId: "command-1",
  sessionId: "session-1",
  deviceId: "device-1",
  authorityGrantId: "grant-1",
  nonce: "n".repeat(32),
  issuedAt: 1_800_000_000_000,
  expiresAt: 1_800_000_030_000,
  scopeVersion: 1,
  deviceConfirmedAt: 1_800_000_000_000,
}

describe("mobile action contract", () => {
  it("allowlists the shared run, orchestration, automation, clarification, and approval actions", () => {
    expect(mobileActionIds).toEqual([
      "clarification.answer",
      "run.steer",
      "run.pause",
      "run.resume",
      "run.cancel",
      "orchestration.pause",
      "orchestration.resume",
      "orchestration.cancel",
      "automation.pause",
      "automation.resume",
      "automation.cancel",
      "approval.approve",
      "approval.deny",
    ])
    expect(Object.keys(mobileActionCatalog)).toEqual(mobileActionIds)
  })

  it.each([
    ["run.steer", "run", { type: "run.steer", message: "Check the failing test." }],
    ["run.pause", "run", { type: "run.pause" }],
    ["run.resume", "run", { type: "run.resume" }],
    ["run.cancel", "run", { type: "run.cancel" }],
    ["automation.pause", "automation", { type: "automation.pause" }],
    ["automation.resume", "automation", { type: "automation.resume" }],
    ["automation.cancel", "automation", { type: "automation.cancel" }],
  ] as const)("parses %s only against its exact resource kind", (_name, kind, action) => {
    expect(
      mobileCommandEnvelopeSchema.parse({
        ...base,
        target: { kind, id: `${kind}-1`, version: 3 },
        action,
      }),
    ).toMatchObject({ action, target: { kind } })
  })

  it("requires explicit device confirmation and a bounded token for privileged commands", () => {
    const privileged = {
      ...base,
      target: { kind: "run" as const, id: "run-1", version: 3 },
      action: { type: "run.cancel" as const },
      stepUpToken: "step-up-token",
    }
    expect(mobileCommandEnvelopeSchema.safeParse(privileged).success).toBe(true)
    expect(
      mobileCommandEnvelopeSchema.safeParse({
        ...privileged,
        deviceConfirmedAt: undefined,
      }).success,
    ).toBe(false)
    expect(
      mobileCommandEnvelopeSchema.safeParse({
        ...privileged,
        stepUpToken: "x".repeat(513),
      }).success,
    ).toBe(false)
  })

  it("binds one-time desktop step-up to the exact device, action, target, and version", () => {
    const stepUp = new MobileStepUpTokenService(
      () => base.issuedAt,
      () => "desktop-step-up-token",
    )
    const issued = stepUp.issue({
      deviceId: base.deviceId,
      action: "run.cancel",
      targetKind: "run",
      targetId: "run-1",
      targetVersion: 3,
      expiresAt: base.issuedAt + 60_000,
    })
    const command = mobileCommandEnvelopeSchema.parse({
      ...base,
      target: { kind: "run", id: "run-1", version: 3 },
      action: { type: "run.cancel" },
      stepUpToken: issued.token,
    })
    expect(stepUp.consume(command)).toBe(true)
    expect(stepUp.consume(command)).toBe(false)
  })

  it.each([
    ["offline", { connected: false }],
    ["device-revoked", { revokedAt: base.issuedAt }],
    ["stale-scope", { scopeVersion: 2 }],
    ["stale-target", { targetVersion: 4 }],
    ["step-up-required", { stepUpVerified: false }],
  ] as const)("fails closed with %s", (expected, override) => {
    const command = mobileCommandEnvelopeSchema.parse({
      ...base,
      target: { kind: "run", id: "run-1", version: 3 },
      action: { type: "run.cancel" },
      stepUpToken: "desktop-step-up-token",
    })
    const result = authorizeMobileCommand(command, {
      now: base.issuedAt,
      connected: "connected" in override ? override.connected : true,
      bridgeEnabled: true,
      device: {
        deviceId: base.deviceId,
        name: "Phone",
        publicKeyAlgorithm: "P-256",
        publicKey: "p".repeat(32),
        createdAt: base.issuedAt,
        scopeVersion: "scopeVersion" in override ? override.scopeVersion : 1,
        ...("revokedAt" in override ? { revokedAt: override.revokedAt } : {}),
      },
      session: {
        sessionId: base.sessionId,
        deviceId: base.deviceId,
        issuedAt: base.issuedAt,
        lastSeenAt: base.issuedAt,
        idleExpiresAt: base.issuedAt + 60_000,
        absoluteExpiresAt: base.issuedAt + 60_000,
        scopeVersion: 1,
        rotation: 0,
      },
      grant: {
        grantId: base.authorityGrantId,
        deviceId: base.deviceId,
        authority: ["control"],
        capabilities: ["run.cancel"],
        resources: [{ kind: "run", id: "run-1" }],
        issuedAt: base.issuedAt,
        scopeVersion: 1,
      },
      trustedTarget: {
        kind: "run",
        id: "run-1",
        version: "targetVersion" in override ? override.targetVersion : 3,
      },
      enabledActions: ["run.cancel"],
      stepUpVerified: "stepUpVerified" in override ? override.stepUpVerified : true,
      replay: new MobileReplayWindow(),
    })
    expect(result).toMatchObject({ ok: false, error: { code: expected } })
  })

  it("rejects command and nonce replay after successful authorization", () => {
    const command = mobileCommandEnvelopeSchema.parse({
      ...base,
      target: { kind: "run", id: "run-1", version: 3 },
      action: { type: "run.pause" },
    })
    const replay = new MobileReplayWindow()
    const input = {
      now: base.issuedAt,
      connected: true,
      bridgeEnabled: true,
      device: {
        deviceId: base.deviceId,
        name: "Phone",
        publicKeyAlgorithm: "P-256" as const,
        publicKey: "p".repeat(32),
        createdAt: base.issuedAt,
        scopeVersion: 1,
      },
      session: {
        sessionId: base.sessionId,
        deviceId: base.deviceId,
        issuedAt: base.issuedAt,
        lastSeenAt: base.issuedAt,
        idleExpiresAt: base.issuedAt + 60_000,
        absoluteExpiresAt: base.issuedAt + 60_000,
        scopeVersion: 1,
        rotation: 0,
      },
      grant: {
        grantId: base.authorityGrantId,
        deviceId: base.deviceId,
        authority: ["control" as const],
        capabilities: ["run.pause" as const],
        resources: [{ kind: "run" as const, id: "run-1" }],
        issuedAt: base.issuedAt,
        scopeVersion: 1,
      },
      trustedTarget: { kind: "run" as const, id: "run-1", version: 3 },
      enabledActions: ["run.pause" as const],
      stepUpVerified: false,
      replay,
    }
    expect(authorizeMobileCommand(command, input).ok).toBe(true)
    expect(authorizeMobileCommand(command, input)).toMatchObject({
      ok: false,
      error: { code: "replay" },
    })
  })
})
