import { describe, expect, it } from "vitest"
import {
  assertServiceResponseCorrelation,
  assertOperationResponseBinding,
  authStatusResponseSchema,
  deriveFlapshotActions,
  buildRecordingStartInput,
  flapshotDiscoverySchema,
  FLAPSHOT_TOOLS,
  recordingTargetsResponseSchema,
  operationSnapshotSchema,
  runtimeRecordingAvailability,
  runtimeScreenshotAvailability,
} from "../src/main/lib/flapshot/contracts"

function discovery(methodOverrides: Record<string, boolean> = {}) {
  const methods = [
    ["screenshot", "listTargets"],
    ["screenshot", "capture"],
    ["recording", "listTargets"],
    ["recording", "start"],
  ].map(([schema, method]) => ({
    schema,
    schemaVersion: 1,
    method,
    availability: methodOverrides[`${schema}.${method}`] === false ? "unavailable" : "available",
    available: methodOverrides[`${schema}.${method}`] !== false,
    reason: methodOverrides[`${schema}.${method}`] === false ? "PERMISSION_REQUIRED" : "AVAILABLE",
  }))
  return flapshotDiscoverySchema.parse({
    server: { name: "flapshot", version: "0.1.0" },
    applicationSchemas: {
      screenshot: 1,
      recording: 1,
      artifacts: 1,
      operations: 1,
      system: 1,
    },
    tools: [
      { name: FLAPSHOT_TOOLS.screenshotTargets, operation: "screenshot.listTargets" },
      { name: FLAPSHOT_TOOLS.screenshotCapture, operation: "screenshot.capture" },
      { name: FLAPSHOT_TOOLS.recordingTargets, operation: "recording.listTargets" },
      { name: FLAPSHOT_TOOLS.recordingStart, operation: "recording.start" },
    ],
    application: {
      ok: true,
      data: {
        envelopeVersion: 1,
        revision: 1,
        observedAt: "2026-07-11T00:00:00.000Z",
        platform: "darwin",
        methods,
      },
      meta: {
        envelopeVersion: 1,
        schema: "system",
        schemaVersion: 1,
        requestId: "request-1",
        correlationId: "correlation-1",
        auditCorrelationId: "audit-1",
      },
    },
  })
}

describe("Flapshot MCP capability gating", () => {
  it("enables only discovered tools backed by available application methods", () => {
    expect(deriveFlapshotActions(discovery())).toEqual({
      screenshot: { available: true, reason: "AVAILABLE" },
      recording: { available: true, reason: "AVAILABLE" },
    })
  })

  it("keeps a denied action disabled with the server reason", () => {
    expect(deriveFlapshotActions(discovery({ "screenshot.capture": false })).screenshot).toEqual({
      available: false,
      reason: "PERMISSION_REQUIRED",
    })
  })

  it("requires bounded target discovery before enabling recording", () => {
    const value = discovery()
    value.tools = value.tools.filter((tool) => tool.name !== FLAPSHOT_TOOLS.recordingTargets)
    expect(deriveFlapshotActions(value).recording).toMatchObject({ available: false })
  })

  it("rejects a capability document from a different server", () => {
    const value = { ...discovery(), server: { name: "not-flapshot", version: "1" } }
    expect(() => flapshotDiscoverySchema.parse(value)).toThrow()
  })

  it("accepts bounded public recording targets with privacy-safe window labels", () => {
    const response = recordingTargetsResponseSchema.parse({
      ok: true,
      data: {
        version: 1,
        truncated: false,
        targets: [
          {
            kind: "display",
            sourceId: "screen:7:0",
            displayId: 7,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            scaleFactor: 2,
            privateLabel: "must be discarded",
          },
          {
            kind: "window",
            sourceId: "window:42:0",
            windowId: "42",
            label: "Terminal",
          },
        ],
      },
      meta: {
        envelopeVersion: 1,
        schema: "recording",
        schemaVersion: 1,
        requestId: "targets-1",
        correlationId: "targets-1",
        auditCorrelationId: "audit-targets-1",
      },
    })
    expect(response.data.targets[0]).not.toHaveProperty("privateLabel")
    expect(response.data.targets[1]).toMatchObject({ label: "Terminal" })
    const target = response.data.targets[0]
    if (target?.kind !== "display") throw new Error("Expected display target")
    expect(buildRecordingStartInput(target, true)).toEqual({
      target: { kind: "display", sourceId: "screen:7:0", displayId: 7 },
      audio: { system: false, microphone: false },
      cursor: "system",
      limits: { maxDurationMs: 300_000 },
      video: { fps: 30, maxWidth: 3_840, maxHeight: 2_160 },
    })
  })

  it("rejects a recording window label containing a private path", () => {
    expect(() =>
      recordingTargetsResponseSchema.parse({
        ok: true,
        data: {
          version: 1,
          truncated: false,
          targets: [
            {
              kind: "window",
              sourceId: "window:42:0",
              windowId: "42",
              label: "/Users/example/private.mov",
            },
          ],
        },
        meta: {
          envelopeVersion: 1,
          schema: "recording",
          schemaVersion: 1,
          requestId: "targets-private",
          correlationId: "targets-private",
          auditCorrelationId: "audit-targets-private",
        },
      }),
    ).toThrow()
  })

  it("rejects a response correlated to a different request", () => {
    expect(() =>
      assertServiceResponseCorrelation(
        { meta: { requestId: "request-from-another-call" } },
        "expected-request",
      ),
    ).toThrow("correlation")
  })

  it("rejects path separators in server operation identifiers", () => {
    expect(() =>
      operationSnapshotSchema.parse({
        operationId: "../escape",
        requestId: "request-1",
        correlationId: "correlation-1",
        auditCorrelationId: "audit-1",
        clientId: "client-1",
        sessionId: "session-1",
        state: "running",
        progress: { sequence: 1, completed: 0, total: null, unit: "items" },
        terminal: null,
      }),
    ).toThrow()
  })

  it.each(["operationId", "requestId", "clientId", "sessionId"] as const)(
    "rejects an operations.get snapshot with a foreign %s",
    (field) => {
      const expected = {
        operationId: "operation-1",
        requestId: "capture-request-1",
        clientId: "client-1",
        sessionId: "session-1",
      }
      const response = {
        ok: true as const,
        data: operationSnapshotSchema.parse({
          ...expected,
          [field]: `foreign-${field}`,
          correlationId: "correlation-1",
          auditCorrelationId: "audit-1",
          state: "running",
          progress: { sequence: 1, completed: 0, total: null, unit: "items" },
          terminal: null,
        }),
        meta: {
          envelopeVersion: 1 as const,
          schema: "operations",
          schemaVersion: 1,
          requestId: "poll-request-1",
          correlationId: "poll-request-1",
          auditCorrelationId: "poll-audit-1",
          operationId: "operation-1",
        },
      }
      expect(() => assertOperationResponseBinding(response, expected)).toThrow("accepted owner")
    },
  )

  it("rejects operations.get metadata bound to another operation", () => {
    expect(() =>
      assertOperationResponseBinding(
        {
          ok: true,
          data: null,
          meta: {
            envelopeVersion: 1,
            schema: "operations",
            schemaVersion: 1,
            requestId: "poll-request-1",
            correlationId: "poll-request-1",
            auditCorrelationId: "poll-audit-1",
            operationId: "foreign-operation",
          },
        },
        {
          operationId: "operation-1",
          requestId: "capture-request-1",
          clientId: "client-1",
          sessionId: "session-1",
        },
      ),
    ).toThrow("metadata")
  })

  it("requires pairing codes only for unpaired live connections", () => {
    const meta = {
      envelopeVersion: 1,
      schema: "system",
      schemaVersion: 1,
      requestId: "auth-1",
      correlationId: "auth-1",
      auditCorrelationId: "audit-auth-1",
    }
    expect(() =>
      authStatusResponseSchema.parse({
        ok: true,
        data: { paired: true, connectionId: "connection-1", pairingCode: "123456" },
        meta,
      }),
    ).toThrow()
    expect(() =>
      authStatusResponseSchema.parse({
        ok: true,
        data: { paired: false, connectionId: "connection-1", pairingCode: null },
        meta,
      }),
    ).toThrow()

    const expectedRequestId = "auth-transport-1"
    const unpaired = authStatusResponseSchema.parse({
      ok: true,
      data: { paired: false, connectionId: "connection-1", pairingCode: "123456" },
      meta: {
        ...meta,
        schema: "transport-auth",
        requestId: expectedRequestId,
        correlationId: expectedRequestId,
      },
    })
    expect(() => assertServiceResponseCorrelation(unpaired, expectedRequestId)).not.toThrow()
  })

  it("fails closed when detailed screenshot or recording capabilities deny capture", () => {
    expect(
      runtimeScreenshotAvailability({
        contractVersion: 1,
        backend: "macos-electron",
        permission: "denied",
        cursorModes: ["exclude"],
        targets: [
          {
            target: "display",
            availability: "unavailable",
            reason: "PERMISSION_DENIED",
            detail: "Allow Screen Recording in System Settings",
          },
        ],
        canCapture: false,
      }),
    ).toEqual({
      available: false,
      reason: "Allow Screen Recording in System Settings",
    })

    const unsupported = { supported: false, reason: "PERMISSION_REQUIRED" }
    const supported = { supported: true }
    expect(
      runtimeRecordingAvailability({
        version: 1,
        platform: "darwin",
        adapter: "screencapturekit",
        targets: { display: supported, window: unsupported, region: unsupported },
        cursor: { hidden: supported, system: supported, "editable-overlay": unsupported },
        permissions: { screen: unsupported, microphone: unsupported },
      }),
    ).toEqual({ available: false, reason: "PERMISSION_REQUIRED" })
  })
})
