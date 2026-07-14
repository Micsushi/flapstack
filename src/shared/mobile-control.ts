import { z } from "zod"

export const MOBILE_CONTROL_PROTOCOL_VERSION = 1 as const
export const MOBILE_REDACTED = "[redacted]" as const

export const mobileControlLimits = {
  pairingTtlMs: 5 * 60_000,
  challengeTtlMs: 60_000,
  sessionIdleTtlMs: 15 * 60_000,
  sessionAbsoluteTtlMs: 12 * 60 * 60_000,
  commandTtlMs: 60_000,
  commandBytes: 32 * 1024,
  eventBytes: 64 * 1024,
  snapshotBytes: 512 * 1024,
  snapshotItems: 500,
  authorityResources: 100,
  authorityCapabilities: 32,
  replayEntries: 2_048,
  commandsPerMinute: 30,
  connectionsPerDevice: 2,
  eventBacklog: 1_000,
  stringBytes: 8_000,
} as const

export const mobileBridgeContract = {
  enabledByDefault: false,
  transport: "authenticated-https-websocket",
  bindPolicy: "explicitly-approved-private-interface",
  publicInternetBinding: false,
  hostedRelay: false,
  remoteAccess: "user-owned-vpn-or-tunnel-only",
  disableBehavior: "close-listener-and-sessions",
} as const

export const mobileThreatModel = [
  {
    threat: "public-network-exposure",
    boundary: "desktop-listener",
    control: "default-off exact approved private or overlay address binding",
    failure: "listener does not start or closes on network change",
  },
  {
    threat: "pairing-token-theft-or-reuse",
    boundary: "pairing",
    control: "short-lived single-use token plus displayed certificate fingerprint",
    failure: "no device or session is created",
  },
  {
    threat: "device-or-session-credential-theft",
    boundary: "authentication",
    control: "per-device public key, challenge nonce, rotation, idle and absolute expiry",
    failure: "authentication fails and the attempt is rate-limited and audited",
  },
  {
    threat: "replayed-or-stale-mutation",
    boundary: "command-dispatch",
    control: "unique command and nonce, short expiry, scope and target versions",
    failure: "command is rejected before dispatch",
  },
  {
    threat: "over-broad-mobile-authority",
    boundary: "authorization",
    control: "revocable grants bind exact resources and capability-listed actions",
    failure: "out-of-scope action is denied before dispatch",
  },
  {
    threat: "secret-or-hidden-reasoning-disclosure",
    boundary: "read-model-projection",
    control: "strict DTOs, redaction, bounded summaries, no raw provider payloads",
    failure: "field is omitted or redacted",
  },
  {
    threat: "slow-client-resource-exhaustion",
    boundary: "event-stream",
    control: "payload, backlog, connection, pagination, and rate limits",
    failure: "client is disconnected and must resnapshot",
  },
  {
    threat: "revocation-race",
    boundary: "session-and-command-dispatch",
    control: "revalidate device, session, grant, and scope immediately before dispatch",
    failure: "connections close and later requests fail",
  },
  {
    threat: "offline-stale-mutation",
    boundary: "companion-client",
    control: "offline snapshots are visibly stale and read-only",
    failure: "reconnect requires a fresh snapshot before mutation",
  },
] as const

export const mobileRiskLevels = ["bounded-input", "lifecycle", "privileged"] as const
export const mobileRiskLevelSchema = z.enum(mobileRiskLevels)
export const mobileApprovalClasses = [
  "device-confirmation",
  "step-up-or-desktop",
  "desktop-only",
] as const
export const mobileApprovalClassSchema = z.enum(mobileApprovalClasses)
export const mobileAuthorityClasses = ["observe", "respond", "control", "approve"] as const
export const mobileAuthorityClassSchema = z.enum(mobileAuthorityClasses)

export const mobileActionIds = [
  "clarification.answer",
  "orchestration.pause",
  "orchestration.resume",
  "orchestration.cancel",
  "approval.approve",
  "approval.deny",
] as const
export const mobileActionIdSchema = z.enum(mobileActionIds)
export type MobileActionId = z.infer<typeof mobileActionIdSchema>

export const mobileUnsupportedActionIds = [
  "shell.execute",
  "git.execute",
  "deploy.execute",
  "secret.read",
  "vendor-session.control",
  "terminal.open",
  "file.write",
  "run.steer",
  "run.pause",
  "run.resume",
  "run.cancel",
  "automation.pause",
  "automation.resume",
  "automation.cancel",
] as const

export type MobileActionCatalogEntry = {
  id: MobileActionId
  authority: z.infer<typeof mobileAuthorityClassSchema>
  risk: z.infer<typeof mobileRiskLevelSchema>
  approval: z.infer<typeof mobileApprovalClassSchema>
  enabledByDefault: false
  service: {
    module: string
    operation: string
  }
}

/**
 * Contract-only allowlist. Every service points at a current shared desktop
 * production seam. Later tasks may add actions only after their shared service exists.
 */
export const mobileActionCatalog = {
  "clarification.answer": {
    id: "clarification.answer",
    authority: "respond",
    risk: "bounded-input",
    approval: "device-confirmation",
    enabledByDefault: false,
    service: {
      module: "src/main/lib/agent-input/service.ts",
      operation: "agentInputLifecycle.answer",
    },
  },
  "orchestration.pause": {
    id: "orchestration.pause",
    authority: "control",
    risk: "lifecycle",
    approval: "device-confirmation",
    enabledByDefault: false,
    service: {
      module: "src/main/lib/agent-orchestration/service.ts",
      operation: "createAgentOrchestrationService.control:pause",
    },
  },
  "orchestration.resume": {
    id: "orchestration.resume",
    authority: "control",
    risk: "lifecycle",
    approval: "device-confirmation",
    enabledByDefault: false,
    service: {
      module: "src/main/lib/agent-orchestration/service.ts",
      operation: "createAgentOrchestrationService.control:resume",
    },
  },
  "orchestration.cancel": {
    id: "orchestration.cancel",
    authority: "control",
    risk: "privileged",
    approval: "step-up-or-desktop",
    enabledByDefault: false,
    service: {
      module: "src/main/lib/agent-orchestration/service.ts",
      operation: "createAgentOrchestrationService.control:stop",
    },
  },
  "approval.approve": {
    id: "approval.approve",
    authority: "approve",
    risk: "privileged",
    approval: "step-up-or-desktop",
    enabledByDefault: false,
    service: {
      module: "src/main/lib/mcp-control/approval-coordinator.ts",
      operation: "decideMcpApproval:approve",
    },
  },
  "approval.deny": {
    id: "approval.deny",
    authority: "approve",
    risk: "bounded-input",
    approval: "device-confirmation",
    enabledByDefault: false,
    service: {
      module: "src/main/lib/mcp-control/approval-coordinator.ts",
      operation: "decideMcpApproval:deny",
    },
  },
} as const satisfies Record<MobileActionId, MobileActionCatalogEntry>

const identifierSchema = z.string().trim().min(1).max(200)
const timestampSchema = z.number().int().nonnegative()
const sequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const versionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const boundedText = (max: number = mobileControlLimits.stringBytes) =>
  z.string().trim().min(1).max(max)
const publicKeySchema = z.string().trim().min(32).max(8_192)
const fingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const nonceSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/)

export const mobileResourceKinds = [
  "project",
  "task",
  "chat",
  "run",
  "orchestration",
  "automation",
  "approval",
  "agent-input",
] as const
export const mobileResourceKindSchema = z.enum(mobileResourceKinds)
export const mobileResourceRefSchema = z
  .object({ kind: mobileResourceKindSchema, id: identifierSchema })
  .strict()

export const mobilePairingOfferSchema = z
  .object({
    protocolVersion: z.literal(MOBILE_CONTROL_PROTOCOL_VERSION),
    endpoint: z
      .string()
      .url()
      .max(2_048)
      .refine((value) => value.startsWith("https://")),
    certificateFingerprint: fingerprintSchema,
    oneTimeToken: nonceSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expiresAt <= value.createdAt) issue(context, ["expiresAt"], "Pairing must expire.")
    if (value.expiresAt - value.createdAt > mobileControlLimits.pairingTtlMs)
      issue(context, ["expiresAt"], "Pairing TTL exceeds the contract limit.")
  })

export const mobilePairingRequestSchema = z
  .object({
    protocolVersion: z.literal(MOBILE_CONTROL_PROTOCOL_VERSION),
    oneTimeToken: nonceSchema,
    certificateFingerprint: fingerprintSchema,
    deviceName: boundedText(120),
    publicKeyAlgorithm: z.enum(["Ed25519", "P-256"]),
    publicKey: publicKeySchema,
  })
  .strict()

export const mobileDeviceRecordSchema = z
  .object({
    deviceId: identifierSchema,
    name: boundedText(120),
    publicKeyAlgorithm: z.enum(["Ed25519", "P-256"]),
    publicKey: publicKeySchema,
    createdAt: timestampSchema,
    lastSeenAt: timestampSchema.optional(),
    revokedAt: timestampSchema.optional(),
    scopeVersion: versionSchema,
  })
  .strict()

export const mobileSessionChallengeSchema = z
  .object({
    sessionId: identifierSchema,
    deviceId: identifierSchema,
    challenge: nonceSchema,
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expiresAt <= value.issuedAt)
      issue(context, ["expiresAt"], "Session challenge must expire.")
    if (value.expiresAt - value.issuedAt > mobileControlLimits.challengeTtlMs)
      issue(context, ["expiresAt"], "Session challenge TTL exceeds the contract limit.")
  })

export const mobileSessionSchema = z
  .object({
    sessionId: identifierSchema,
    deviceId: identifierSchema,
    issuedAt: timestampSchema,
    lastSeenAt: timestampSchema,
    idleExpiresAt: timestampSchema,
    absoluteExpiresAt: timestampSchema,
    scopeVersion: versionSchema,
    rotation: z.number().int().nonnegative(),
    revokedAt: timestampSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.lastSeenAt < value.issuedAt)
      issue(context, ["lastSeenAt"], "Last-seen time cannot predate session issue.")
    if (value.idleExpiresAt <= value.lastSeenAt)
      issue(context, ["idleExpiresAt"], "Idle expiry must follow last-seen time.")
    if (value.absoluteExpiresAt <= value.issuedAt)
      issue(context, ["absoluteExpiresAt"], "Absolute expiry must follow session issue.")
    if (value.idleExpiresAt > value.absoluteExpiresAt)
      issue(context, ["idleExpiresAt"], "Idle expiry cannot outlive absolute expiry.")
    if (value.idleExpiresAt - value.lastSeenAt > mobileControlLimits.sessionIdleTtlMs)
      issue(context, ["idleExpiresAt"], "Idle session TTL exceeds the contract limit.")
    if (value.absoluteExpiresAt - value.issuedAt > mobileControlLimits.sessionAbsoluteTtlMs)
      issue(context, ["absoluteExpiresAt"], "Absolute session TTL exceeds the contract limit.")
  })

export const mobileRevocationSchema = z
  .object({
    deviceId: identifierSchema,
    revokedAt: timestampSchema,
    reason: z.enum(["user", "credential-suspected", "device-lost", "scope-replaced"]),
    closeSessions: z.literal(true),
  })
  .strict()

export const mobileAuthorityGrantSchema = z
  .object({
    grantId: identifierSchema,
    deviceId: identifierSchema,
    authority: z.array(mobileAuthorityClassSchema).min(1).max(4),
    capabilities: z
      .array(mobileActionIdSchema)
      .min(1)
      .max(mobileControlLimits.authorityCapabilities),
    resources: z.array(mobileResourceRefSchema).min(1).max(mobileControlLimits.authorityResources),
    issuedAt: timestampSchema,
    expiresAt: timestampSchema.optional(),
    revokedAt: timestampSchema.optional(),
    scopeVersion: versionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    unique(value.authority, context, ["authority"])
    unique(value.capabilities, context, ["capabilities"])
    unique(
      value.resources.map((resource) => `${resource.kind}:${resource.id}`),
      context,
      ["resources"],
    )
    for (const capability of value.capabilities) {
      const required = mobileActionCatalog[capability].authority
      if (!value.authority.includes(required))
        issue(context, ["authority"], `${capability} requires ${required} authority.`)
    }
    if (value.expiresAt !== undefined && value.expiresAt <= value.issuedAt)
      issue(context, ["expiresAt"], "Authority grant must expire after issue.")
    if (value.revokedAt !== undefined && value.revokedAt < value.issuedAt)
      issue(context, ["revokedAt"], "Authority grant revocation cannot predate issue.")
  })

const entityBase = {
  id: identifierSchema,
  version: versionSchema,
  updatedAt: timestampSchema,
}

export const mobileSnapshotItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), ...entityBase, name: boundedText(240) }).strict(),
  z
    .object({
      kind: z.literal("task"),
      ...entityBase,
      projectId: identifierSchema,
      name: boundedText(240),
      status: boundedText(80),
    })
    .strict(),
  z
    .object({
      kind: z.literal("chat"),
      ...entityBase,
      projectId: identifierSchema.optional(),
      taskId: identifierSchema.optional(),
      name: boundedText(240),
      harness: boundedText(80),
    })
    .strict(),
  z
    .object({
      kind: z.literal("run"),
      ...entityBase,
      chatId: identifierSchema,
      harness: boundedText(80),
      status: boundedText(80),
      startedAt: timestampSchema,
      completedAt: timestampSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("orchestration"),
      ...entityBase,
      taskId: identifierSchema,
      status: boundedText(80),
      progressPercent: z.number().int().min(0).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("automation"),
      ...entityBase,
      projectId: identifierSchema,
      name: boundedText(240),
      status: boundedText(80),
      nextRunAt: timestampSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("approval"),
      ...entityBase,
      chatId: identifierSchema,
      runId: identifierSchema.optional(),
      projectId: identifierSchema.optional(),
      taskId: identifierSchema.optional(),
      worktreeDisplay: boundedText(1_024).optional(),
      action: boundedText(240),
      risk: mobileRiskLevelSchema,
      expiresAt: timestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("artifact"),
      ...entityBase,
      runId: identifierSchema,
      name: boundedText(240),
      mediaType: boundedText(120),
      sizeBytes: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("diff"),
      ...entityBase,
      runId: identifierSchema,
      filesChanged: z.number().int().nonnegative().max(100_000),
      additions: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      deletions: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("check"),
      ...entityBase,
      runId: identifierSchema,
      label: boundedText(240),
      status: z.enum(["pending", "running", "passed", "failed", "cancelled"]),
      summary: boundedText(2_000).optional(),
    })
    .strict(),
])

export const mobileSnapshotEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(MOBILE_CONTROL_PROTOCOL_VERSION),
    kind: z.literal("snapshot"),
    snapshotId: identifierSchema,
    scopeVersion: versionSchema,
    sequence: sequenceSchema,
    generatedAt: timestampSchema,
    items: z.array(mobileSnapshotItemSchema).max(mobileControlLimits.snapshotItems),
    nextCursor: z.string().trim().min(1).max(512).optional(),
  })
  .strict()

const eventPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("entity.upsert"), item: mobileSnapshotItemSchema }).strict(),
  z.object({ type: z.literal("entity.remove"), resource: mobileResourceRefSchema }).strict(),
  z
    .object({
      type: z.literal("action.result"),
      commandId: identifierSchema,
      action: mobileActionIdSchema,
      status: z.enum(["completed", "denied", "stale", "failed"]),
      summary: boundedText(2_000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("scope.revoked"),
      scopeVersion: versionSchema,
      reason: boundedText(500),
    })
    .strict(),
  z.object({ type: z.literal("resnapshot.required"), reason: boundedText(500) }).strict(),
  z.object({ type: z.literal("heartbeat") }).strict(),
])

export const mobileEventEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(MOBILE_CONTROL_PROTOCOL_VERSION),
    kind: z.literal("event"),
    eventId: identifierSchema,
    snapshotId: identifierSchema,
    scopeVersion: versionSchema,
    sequence: sequenceSchema,
    occurredAt: timestampSchema,
    payload: eventPayloadSchema,
  })
  .strict()

const clarificationAnswerActionSchema = z
  .object({
    type: z.literal("clarification.answer"),
    requestId: identifierSchema,
    answers: z
      .record(z.array(boundedText(4_000)).min(1).max(13))
      .refine((answers) => Object.keys(answers).length <= 8, {
        message: "Clarification answers exceed the question limit.",
      }),
  })
  .strict()
const targetOnlyAction = <T extends MobileActionId>(type: T) =>
  z.object({ type: z.literal(type) }).strict()

export const mobileCommandActionSchema = z.discriminatedUnion("type", [
  clarificationAnswerActionSchema,
  targetOnlyAction("orchestration.pause"),
  targetOnlyAction("orchestration.resume"),
  targetOnlyAction("orchestration.cancel"),
  targetOnlyAction("approval.approve"),
  targetOnlyAction("approval.deny"),
])

export const mobileCommandEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(MOBILE_CONTROL_PROTOCOL_VERSION),
    kind: z.literal("command"),
    commandId: identifierSchema,
    sessionId: identifierSchema,
    deviceId: identifierSchema,
    authorityGrantId: identifierSchema,
    nonce: nonceSchema,
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
    scopeVersion: versionSchema,
    target: z.object({ ...mobileResourceRefSchema.shape, version: versionSchema }).strict(),
    action: mobileCommandActionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expiresAt <= value.issuedAt) issue(context, ["expiresAt"], "Command must expire.")
    if (value.expiresAt - value.issuedAt > mobileControlLimits.commandTtlMs)
      issue(context, ["expiresAt"], "Command TTL exceeds the contract limit.")
    const targetKind = actionTargetKind(value.action.type)
    if (value.target.kind !== targetKind)
      issue(context, ["target", "kind"], `${value.action.type} requires a ${targetKind} target.`)
  })

export type MobileDeviceRecord = z.infer<typeof mobileDeviceRecordSchema>
export type MobileSession = z.infer<typeof mobileSessionSchema>
export type MobileAuthorityGrant = z.infer<typeof mobileAuthorityGrantSchema>
export type MobileSnapshotEnvelope = z.infer<typeof mobileSnapshotEnvelopeSchema>
export type MobileEventEnvelope = z.infer<typeof mobileEventEnvelopeSchema>
export type MobileCommandEnvelope = z.infer<typeof mobileCommandEnvelopeSchema>

export type MobileContractErrorCode =
  | "invalid-envelope"
  | "oversize"
  | "bridge-disabled"
  | "offline"
  | "device-revoked"
  | "session-invalid"
  | "session-expired"
  | "grant-invalid"
  | "capability-disabled"
  | "out-of-scope"
  | "stale-scope"
  | "stale-target"
  | "step-up-required"
  | "replay"

export type MobileContractResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: MobileContractErrorCode; message: string } }

export function parseMobileCommandEnvelope(
  input: unknown,
): MobileContractResult<MobileCommandEnvelope> {
  return parseEnvelope(input, mobileCommandEnvelopeSchema, mobileControlLimits.commandBytes)
}

export function parseMobileEventEnvelope(
  input: unknown,
): MobileContractResult<MobileEventEnvelope> {
  return parseEnvelope(input, mobileEventEnvelopeSchema, mobileControlLimits.eventBytes)
}

export function parseMobileSnapshotEnvelope(
  input: unknown,
): MobileContractResult<MobileSnapshotEnvelope> {
  return parseEnvelope(input, mobileSnapshotEnvelopeSchema, mobileControlLimits.snapshotBytes)
}

export class MobileReplayWindow {
  private readonly entries = new Map<string, number>()

  accept(command: MobileCommandEnvelope, now: number): boolean {
    for (const [key, expiry] of this.entries) if (expiry < now) this.entries.delete(key)
    const commandKey = `${command.sessionId}\u0000command\u0000${command.commandId}`
    const nonceKey = `${command.sessionId}\u0000nonce\u0000${command.nonce}`
    if (this.entries.has(commandKey) || this.entries.has(nonceKey)) return false
    while (this.entries.size > mobileControlLimits.replayEntries - 2) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (!oldest) break
      this.entries.delete(oldest)
    }
    this.entries.set(commandKey, command.expiresAt)
    this.entries.set(nonceKey, command.expiresAt)
    return true
  }
}

export type MobileTrustedTarget = z.infer<typeof mobileResourceRefSchema> & { version: number }

export function authorizeMobileCommand(
  command: MobileCommandEnvelope,
  input: {
    now: number
    connected: boolean
    bridgeEnabled: boolean
    device: MobileDeviceRecord
    session: MobileSession
    grant: MobileAuthorityGrant
    trustedTarget: MobileTrustedTarget
    enabledActions: readonly MobileActionId[]
    stepUpVerified: boolean
    replay: MobileReplayWindow
  },
): MobileContractResult<MobileCommandEnvelope> {
  if (!input.bridgeEnabled) return denied("bridge-disabled", "Mobile bridge is disabled.")
  if (!input.connected) return denied("offline", "Offline mobile state is read-only.")
  if (input.device.revokedAt !== undefined)
    return denied("device-revoked", "Mobile device is revoked.")
  if (
    command.deviceId !== input.device.deviceId ||
    command.sessionId !== input.session.sessionId ||
    input.session.deviceId !== input.device.deviceId
  )
    return denied("session-invalid", "Session is not bound to this device and command.")
  if (
    input.session.revokedAt !== undefined ||
    input.now > input.session.idleExpiresAt ||
    input.now > input.session.absoluteExpiresAt ||
    input.now > command.expiresAt ||
    input.now < command.issuedAt
  )
    return denied("session-expired", "Session or command is expired.")
  if (
    command.authorityGrantId !== input.grant.grantId ||
    input.grant.deviceId !== input.device.deviceId ||
    input.grant.revokedAt !== undefined ||
    (input.grant.expiresAt !== undefined && input.now > input.grant.expiresAt)
  )
    return denied("grant-invalid", "Authority grant is missing, expired, or revoked.")
  if (!input.enabledActions.includes(command.action.type))
    return denied("capability-disabled", "Mobile action is not explicitly enabled.")
  if (!input.grant.capabilities.includes(command.action.type))
    return denied("out-of-scope", "Authority grant does not include this action.")
  const requiredAuthority = mobileActionCatalog[command.action.type].authority
  if (!input.grant.authority.includes(requiredAuthority))
    return denied("out-of-scope", `Authority grant lacks ${requiredAuthority} authority.`)
  if (
    !input.grant.resources.some(
      (resource) =>
        resource.kind === input.trustedTarget.kind && resource.id === input.trustedTarget.id,
    )
  )
    return denied("out-of-scope", "Authority grant does not include the trusted target.")
  if (
    command.scopeVersion !== input.device.scopeVersion ||
    command.scopeVersion !== input.session.scopeVersion ||
    command.scopeVersion !== input.grant.scopeVersion
  )
    return denied("stale-scope", "Authority scope changed; resnapshot is required.")
  if (
    command.target.kind !== input.trustedTarget.kind ||
    command.target.id !== input.trustedTarget.id ||
    command.target.version !== input.trustedTarget.version
  )
    return denied("stale-target", "Command target is stale or mismatched.")
  if (
    mobileActionCatalog[command.action.type].approval === "step-up-or-desktop" &&
    !input.stepUpVerified
  )
    return denied("step-up-required", "Strong device verification or desktop approval is required.")
  if (!input.replay.accept(command, input.now))
    return denied("replay", "Command ID and nonce have already been used.")
  return { ok: true, value: command }
}

export type MobileEventCursorResult = "accept" | "replay" | "resnapshot"

export function evaluateMobileEventCursor(
  cursor: { snapshotId: string; scopeVersion: number; sequence: number },
  event: MobileEventEnvelope,
): MobileEventCursorResult {
  if (event.snapshotId !== cursor.snapshotId || event.scopeVersion !== cursor.scopeVersion)
    return "resnapshot"
  if (event.sequence <= cursor.sequence) return "replay"
  return event.sequence === cursor.sequence + 1 ? "accept" : "resnapshot"
}

export function evaluateMobileClientState(input: {
  connected: boolean
  snapshotGeneratedAt: number | null
  now: number
  gapDetected: boolean
  scopeVersionMatches: boolean
}): {
  mode: "online" | "offline-read-only" | "resnapshot-required"
  mutable: boolean
  stale: boolean
  lastUpdatedAt: number | null
} {
  if (!input.connected)
    return {
      mode: "offline-read-only",
      mutable: false,
      stale: true,
      lastUpdatedAt: input.snapshotGeneratedAt,
    }
  if (input.gapDetected || !input.scopeVersionMatches || input.snapshotGeneratedAt === null)
    return {
      mode: "resnapshot-required",
      mutable: false,
      stale: true,
      lastUpdatedAt: input.snapshotGeneratedAt,
    }
  return {
    mode: "online",
    mutable: true,
    stale: false,
    lastUpdatedAt: input.snapshotGeneratedAt,
  }
}

export type MobileBindAddressClass =
  "private" | "private-overlay" | "link-local" | "loopback" | "unspecified" | "public-or-invalid"

export function classifyMobileBindAddress(address: string): MobileBindAddressClass {
  const normalized = address.trim().toLowerCase()
  if (normalized === "0.0.0.0" || normalized === "::") return "unspecified"
  if (normalized === "::1") return "loopback"
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return "private"
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return "link-local"
  const octets = normalized.split(".").map(Number)
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return "public-or-invalid"
  if (octets[0] === 127) return "loopback"
  if (octets[0] === 169 && octets[1] === 254) return "link-local"
  if (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  )
    return "private"
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return "private-overlay"
  return "public-or-invalid"
}

export function canBindMobileBridge(
  address: string,
  approvedAddresses: readonly string[],
): boolean {
  const classification = classifyMobileBindAddress(address)
  return (
    (classification === "private" || classification === "private-overlay") &&
    approvedAddresses.some(
      (approved) => approved.trim().toLowerCase() === address.trim().toLowerCase(),
    )
  )
}

type RedactedValue =
  null | boolean | number | string | RedactedValue[] | { [key: string]: RedactedValue }
const sensitiveKey =
  /(?:secret|token|password|credential|authorization|cookie|private.?key|hidden.?reasoning|chain.?of.?thought|system.?prompt)/i

export function redactMobilePayload(value: unknown, depth = 0): RedactedValue {
  if (value === null) return null
  if (typeof value === "boolean" || typeof value === "number") return value
  if (typeof value === "string") return redactMobileText(value)
  if (depth >= 8) return "[truncated]"
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => redactMobilePayload(item, depth + 1))
  if (typeof value !== "object") return String(value).slice(0, mobileControlLimits.stringBytes)
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 100)
      .map(([key, item]) => [
        key,
        sensitiveKey.test(key) ? MOBILE_REDACTED : redactMobilePayload(item, depth + 1),
      ]),
  )
}

export function redactMobileText(value: string): string {
  return value
    .slice(0, mobileControlLimits.stringBytes)
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, `Bearer ${MOBILE_REDACTED}`)
    .replace(/\b(?:sk|sess|key)-[A-Za-z0-9_-]{8,}\b/g, MOBILE_REDACTED)
    .replace(
      /\b(?:api[-_ ]?key|access[-_ ]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
      (match) => `${match.split(/[:=]/, 1)[0]}=${MOBILE_REDACTED}`,
    )
}

function actionTargetKind(action: MobileActionId): z.infer<typeof mobileResourceKindSchema> {
  if (action === "clarification.answer") return "agent-input"
  if (action.startsWith("orchestration.")) return "orchestration"
  return "approval"
}

function parseEnvelope<T>(
  input: unknown,
  schema: z.ZodType<T>,
  maxBytes: number,
): MobileContractResult<T> {
  let bytes: number
  try {
    const serialized = JSON.stringify(input)
    if (serialized === undefined) return denied("invalid-envelope", "Envelope is not serializable.")
    bytes = new TextEncoder().encode(serialized).byteLength
  } catch {
    return denied("invalid-envelope", "Envelope is not serializable.")
  }
  if (bytes > maxBytes) return denied("oversize", `Envelope exceeds ${maxBytes} bytes.`)
  const parsed = schema.safeParse(input)
  if (!parsed.success)
    return denied("invalid-envelope", parsed.error.issues[0]?.message ?? "Invalid envelope.")
  return { ok: true, value: parsed.data }
}

function denied<T>(code: MobileContractErrorCode, message: string): MobileContractResult<T> {
  return { ok: false, error: { code, message } }
}

function unique(
  values: readonly string[],
  context: z.RefinementCtx,
  path: (string | number)[],
): void {
  if (new Set(values).size !== values.length) issue(context, path, "Values must be unique.")
}

function issue(context: z.RefinementCtx, path: (string | number)[], message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message })
}
