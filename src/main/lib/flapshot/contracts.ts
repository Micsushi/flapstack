import { z } from "zod"

export const FLAPSHOT_SERVER_NAME = "flapshot"
export const FLAPSHOT_CAPABILITIES_URI = "flapshot://v1/capabilities"
export const FLAPSHOT_MCP_CONTRACT = {
  baseline: "a1fb8a5f163567a65bfbed04bb44c1292f3c6553",
  serverVersion: "0.1.0",
  resourceVersion: 1,
  maxMessageBytes: 1024 * 1024,
  maxResponseBytes: 512 * 1024,
} as const

export const FLAPSHOT_TOOLS = {
  systemCapabilities: "flapshot_system_capabilities",
  authStatus: "flapshot_system_auth_status",
  screenshotCapabilities: "flapshot_screenshot_get_capabilities",
  screenshotTargets: "flapshot_screenshot_list_targets",
  screenshotCapture: "flapshot_screenshot_capture",
  recordingCapabilities: "flapshot_recording_get_capabilities",
  recordingTargets: "flapshot_recording_list_targets",
  recordingStart: "flapshot_recording_start",
  recordingStop: "flapshot_recording_stop",
  operationGet: "flapshot_operations_get",
  operationCancel: "flapshot_operations_cancel",
} as const

export type FlapshotAction = "screenshot" | "recording"

const serviceTokenSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

const capabilityMethodSchema = z.object({
  schema: z.string(),
  schemaVersion: z.number().int().positive(),
  method: z.string(),
  availability: z.enum(["available", "degraded", "unavailable"]),
  available: z.boolean(),
  reason: z.string(),
})

const serviceErrorSchema = z.object({
  code: z.string(),
  reason: z.string(),
  message: z.string(),
  retryable: z.boolean().optional(),
})

const responseMetaSchema = z.object({
  envelopeVersion: z.literal(1),
  schema: z.string(),
  schemaVersion: z.number().int().positive(),
  requestId: serviceTokenSchema,
  correlationId: serviceTokenSchema,
  auditCorrelationId: serviceTokenSchema,
  operationId: serviceTokenSchema.optional(),
})

const capabilitySnapshotSchema = z.object({
  envelopeVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  observedAt: z.string(),
  platform: z.enum(["darwin", "win32", "linux"]),
  methods: z.array(capabilityMethodSchema),
})

export const flapshotDiscoverySchema = z.object({
  server: z.object({
    name: z.literal(FLAPSHOT_SERVER_NAME),
    version: z.string().min(1),
  }),
  applicationSchemas: z.record(z.number().int().positive()),
  tools: z.array(z.object({ name: z.string(), operation: z.string() })),
  application: z.union([
    z.object({ ok: z.literal(true), data: capabilitySnapshotSchema, meta: responseMetaSchema }),
    z.object({ ok: z.literal(false), error: serviceErrorSchema, meta: responseMetaSchema }),
  ]),
})

export type FlapshotDiscovery = z.infer<typeof flapshotDiscoverySchema>
export type FlapshotCapabilityMethod = z.infer<typeof capabilityMethodSchema>

const progressSchema = z.object({
  sequence: z.number().int().nonnegative(),
  completed: z.number().nonnegative(),
  total: z.number().nonnegative().nullable(),
  unit: z.enum(["items", "bytes", "milliseconds", "fraction"]),
  message: z.string().max(256).optional(),
})

const localGrantSchema = z.object({
  path: z.string().min(1).max(32_768),
  grantedToClientId: serviceTokenSchema,
  expiresAt: z.string().datetime().optional(),
})

export const flapshotFileReferenceSchema = z.object({
  kind: z.enum(["managed-artifact", "export"]),
  artifactId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
    .optional(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"]),
  sizeBytes: z.number().int().nonnegative().safe(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  local: localGrantSchema.optional(),
})

export type FlapshotFileReference = z.infer<typeof flapshotFileReferenceSchema>
export const flapshotAuthorizedFileReferenceSchema = flapshotFileReferenceSchema.extend({
  local: localGrantSchema,
})
export type FlapshotAuthorizedFileReference = z.infer<typeof flapshotAuthorizedFileReferenceSchema>

const operationResultSchema = z
  .object({
    kind: z.string(),
    file: flapshotFileReferenceSchema.optional(),
    artifact: z
      .object({
        id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
        name: z.string().min(1).max(512),
        mimeType: z.string(),
        sizeBytes: z.number().int().nonnegative().safe(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/i),
        sourceApplication: z.string().nullable().optional(),
        status: z.enum(["available", "missing", "tampered", "quarantined", "deleted"]),
        provenance: z.object({
          kind: z.string(),
          producer: z.string(),
          producerContractVersion: z.number().int().nullable(),
          requestId: z.string().nullable(),
          metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
        }),
      })
      .optional(),
  })
  .passthrough()

export const operationSnapshotSchema = z.object({
  operationId: serviceTokenSchema,
  requestId: serviceTokenSchema,
  correlationId: serviceTokenSchema,
  auditCorrelationId: serviceTokenSchema,
  clientId: serviceTokenSchema,
  sessionId: serviceTokenSchema,
  state: z.enum([
    "queued",
    "running",
    "cancelling",
    "succeeded",
    "failed",
    "cancelled",
    "timed-out",
    "interrupted",
  ]),
  progress: progressSchema,
  terminal: z
    .union([
      z.object({
        sequence: z.number().int().nonnegative(),
        state: z.literal("succeeded"),
        finishedAt: z.string(),
        result: operationResultSchema,
      }),
      z.object({
        sequence: z.number().int().nonnegative(),
        state: z.enum(["failed", "cancelled", "timed-out", "interrupted"]),
        finishedAt: z.string(),
        error: serviceErrorSchema,
      }),
    ])
    .nullable(),
})

export type FlapshotOperationSnapshot = z.infer<typeof operationSnapshotSchema>

const successResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ ok: z.literal(true), data, meta: responseMetaSchema })

export const operationAcceptedResponseSchema = successResponseSchema(
  z.object({
    accepted: z.literal(true),
    reused: z.boolean(),
    operation: operationSnapshotSchema,
  }),
)

export const operationGetResponseSchema = successResponseSchema(operationSnapshotSchema.nullable())

export function assertOperationResponseBinding(
  response: z.infer<typeof operationGetResponseSchema>,
  expected: {
    operationId: string
    requestId: string
    clientId: string
    sessionId: string
  },
): void {
  if (response.meta.operationId !== expected.operationId) {
    throw new Error("Flapshot operation response metadata does not match the requested operation")
  }
  const snapshot = response.data
  if (!snapshot) return
  for (const key of ["operationId", "requestId", "clientId", "sessionId"] as const) {
    if (snapshot[key] !== expected[key]) {
      throw new Error(`Flapshot operation ${key} does not match the accepted owner`)
    }
  }
}

export const screenshotTargetsResponseSchema = successResponseSchema(
  z.object({
    displays: z.array(z.object({ id: z.string().min(1).max(128) }).passthrough()).max(32),
    windows: z.array(z.unknown()).max(32),
  }),
)

const recordingBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
})

const recordingWindowLabelSchema = z
  .string()
  .min(1)
  .refine((value) => Array.from(value).length <= 80, "Window label exceeds 80 code points")
  .refine(
    (value) => !/[\\/\p{Cc}\p{Cf}]/u.test(value),
    "Window label contains private path or control characters",
  )

export const recordingTargetsResponseSchema = successResponseSchema(
  z.object({
    version: z.literal(1),
    targets: z
      .array(
        z.union([
          z.object({
            kind: z.literal("display"),
            sourceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
            displayId: z.number().int(),
            bounds: recordingBoundsSchema,
            scaleFactor: z.number().positive().finite(),
          }),
          z.object({
            kind: z.literal("window"),
            sourceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
            windowId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
            label: recordingWindowLabelSchema,
          }),
        ]),
      )
      .max(32),
    truncated: z.boolean(),
  }),
)

export type FlapshotRecordingTarget = z.infer<
  typeof recordingTargetsResponseSchema
>["data"]["targets"][number]

export const FLAPSHOT_RECORDING_LIMITS = {
  maxDurationMs: 5 * 60 * 1000,
  fps: 30,
  maxWidth: 3_840,
  maxHeight: 2_160,
} as const

export function buildRecordingStartInput(
  target: Extract<FlapshotRecordingTarget, { kind: "display" }>,
  systemCursorSupported: boolean,
) {
  return {
    target: {
      kind: "display" as const,
      sourceId: target.sourceId,
      displayId: target.displayId,
    },
    audio: { system: false, microphone: false },
    cursor: systemCursorSupported ? ("system" as const) : ("hidden" as const),
    limits: { maxDurationMs: FLAPSHOT_RECORDING_LIMITS.maxDurationMs },
    video: {
      fps: FLAPSHOT_RECORDING_LIMITS.fps,
      maxWidth: Math.max(
        1,
        Math.min(
          FLAPSHOT_RECORDING_LIMITS.maxWidth,
          Math.ceil(target.bounds.width * target.scaleFactor),
        ),
      ),
      maxHeight: Math.max(
        1,
        Math.min(
          FLAPSHOT_RECORDING_LIMITS.maxHeight,
          Math.ceil(target.bounds.height * target.scaleFactor),
        ),
      ),
    },
  }
}

const recordingFeatureSchema = z.object({
  supported: z.boolean(),
  reason: z.string().optional(),
  remediation: z.string().optional(),
})

export const recordingCapabilitiesResponseSchema = successResponseSchema(
  z.object({
    version: z.literal(1),
    platform: z.enum(["darwin", "win32", "linux"]),
    adapter: z.string(),
    targets: z.object({
      display: recordingFeatureSchema,
      window: recordingFeatureSchema,
      region: recordingFeatureSchema,
    }),
    cursor: z.object({
      hidden: recordingFeatureSchema,
      system: recordingFeatureSchema,
      "editable-overlay": recordingFeatureSchema,
    }),
    permissions: z.object({
      screen: recordingFeatureSchema,
      microphone: recordingFeatureSchema,
    }),
  }),
)

export const screenshotCapabilitiesResponseSchema = successResponseSchema(
  z.object({
    contractVersion: z.literal(1),
    backend: z.enum(["macos-electron", "windows-wgc", "wayland-portal", "x11"]),
    permission: z.enum([
      "granted",
      "denied",
      "restricted",
      "not-determined",
      "unknown",
      "portal-managed",
    ]),
    cursorModes: z.array(z.enum(["include", "exclude"])),
    targets: z.array(
      z.object({
        target: z.enum(["display", "window", "region"]),
        availability: z.enum(["available", "degraded", "unavailable"]),
        reason: z.string(),
        detail: z.string(),
      }),
    ),
    canCapture: z.boolean(),
  }),
)

type ScreenshotCapabilities = z.infer<typeof screenshotCapabilitiesResponseSchema>["data"]
type RecordingCapabilities = z.infer<typeof recordingCapabilitiesResponseSchema>["data"]

export function runtimeScreenshotAvailability(
  capabilities: ScreenshotCapabilities,
): FlapshotActionAvailability {
  const display = capabilities.targets.find((target) => target.target === "display")
  if (!capabilities.canCapture || !display || display.availability === "unavailable") {
    return {
      available: false,
      reason:
        display?.detail || display?.reason || `Screenshot permission is ${capabilities.permission}`,
    }
  }
  return { available: true, reason: display.reason }
}

export function runtimeRecordingAvailability(
  capabilities: RecordingCapabilities,
): FlapshotActionAvailability {
  const requirements = [capabilities.targets.display, capabilities.permissions.screen]
  for (const requirement of requirements) {
    if (!requirement.supported) {
      return {
        available: false,
        reason: requirement.remediation ?? requirement.reason ?? "Recording is unavailable",
      }
    }
  }
  if (!capabilities.cursor.system.supported && !capabilities.cursor.hidden.supported) {
    const cursor = capabilities.cursor.system.remediation
      ? capabilities.cursor.system
      : capabilities.cursor.hidden
    return {
      available: false,
      reason: cursor.remediation ?? cursor.reason ?? "No supported recording cursor mode",
    }
  }
  return { available: true, reason: "AVAILABLE" }
}

export const authStatusResponseSchema = successResponseSchema(
  z
    .object({
      paired: z.boolean(),
      connectionId: serviceTokenSchema,
      pairingCode: z
        .string()
        .regex(/^\d{6}$/)
        .nullable(),
    })
    .superRefine((value, context) => {
      if (value.paired === (value.pairingCode !== null)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Pairing code must be present only while the connection is unpaired",
          path: ["pairingCode"],
        })
      }
    }),
)

export type FlapshotAuthStatus = z.infer<typeof authStatusResponseSchema>["data"]

export const serviceFailureResponseSchema = z.object({
  ok: z.literal(false),
  error: serviceErrorSchema,
  meta: responseMetaSchema.optional(),
})

export interface FlapshotActionAvailability {
  available: boolean
  reason: string
}

export function deriveFlapshotActions(
  discovery: FlapshotDiscovery,
): Record<FlapshotAction, FlapshotActionAvailability> {
  const methods = discovery.application.ok ? discovery.application.data.methods : []
  const tools = new Set(discovery.tools.map((tool) => tool.name))

  const methodAvailability = (schema: string, method: string, tool: string) => {
    if (!tools.has(tool)) return { available: false, reason: `MCP tool ${tool} is unavailable` }
    const capability = methods.find((item) => item.schema === schema && item.method === method)
    if (!capability) return { available: false, reason: `${schema}.${method} was not discovered` }
    return capability.available && capability.availability !== "unavailable"
      ? { available: true, reason: capability.reason }
      : { available: false, reason: capability.reason }
  }

  const combinedAvailability = (
    requirements: Array<{ schema: string; method: string; tool: string }>,
  ) => {
    for (const requirement of requirements) {
      const availability = methodAvailability(
        requirement.schema,
        requirement.method,
        requirement.tool,
      )
      if (!availability.available) return availability
    }
    return { available: true, reason: "AVAILABLE" }
  }

  return {
    screenshot: combinedAvailability([
      {
        schema: "screenshot",
        method: "listTargets",
        tool: FLAPSHOT_TOOLS.screenshotTargets,
      },
      { schema: "screenshot", method: "capture", tool: FLAPSHOT_TOOLS.screenshotCapture },
    ]),
    recording: combinedAvailability([
      {
        schema: "recording",
        method: "listTargets",
        tool: FLAPSHOT_TOOLS.recordingTargets,
      },
      { schema: "recording", method: "start", tool: FLAPSHOT_TOOLS.recordingStart },
    ]),
  }
}

export function parseToolStructuredContent(result: unknown): unknown {
  if (!result || typeof result !== "object") throw new Error("Flapshot returned no tool result")
  const record = result as Record<string, unknown>
  const structured = record.structuredContent
  if (structured !== undefined) return structured
  const content = Array.isArray(record.content) ? record.content : []
  const first = content.find(
    (item): item is { type: "text"; text: string } =>
      !!item && typeof item === "object" && (item as { type?: unknown }).type === "text",
  )
  if (!first || typeof first.text !== "string") throw new Error("Flapshot returned no JSON result")
  return JSON.parse(first.text)
}

export function assertServiceResponseCorrelation(value: unknown, expectedRequestId: string): void {
  if (!value || typeof value !== "object") throw new Error("Flapshot response is invalid")
  const meta = (value as { meta?: unknown }).meta
  if (!meta || typeof meta !== "object") throw new Error("Flapshot response has no correlation")
  const requestId = (meta as { requestId?: unknown }).requestId
  if (requestId !== expectedRequestId) {
    throw new Error("Flapshot response request correlation does not match")
  }
}

export function throwIfServiceFailure(value: unknown): void {
  const failure = serviceFailureResponseSchema.safeParse(value)
  if (failure.success) {
    throw new Error(
      `${failure.data.error.code}/${failure.data.error.reason}: ${failure.data.error.message}`,
    )
  }
  if (value && typeof value === "object" && (value as { ok?: unknown }).ok === false) {
    const error = (value as { error?: { code?: unknown; message?: unknown } }).error
    throw new Error(
      `${String(error?.code ?? "MCP_ERROR")}: ${String(error?.message ?? "Flapshot failed")}`,
    )
  }
}
