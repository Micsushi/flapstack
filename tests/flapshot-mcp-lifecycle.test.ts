import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: { getVersion: () => "0.0.72-test", isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: vi.fn() },
}))

import {
  FlapshotMcpClientManager,
  type FlapshotConnectionFactory,
  type FlapshotProtocolClient,
} from "../src/main/lib/flapshot/client"
import { FLAPSHOT_TOOLS } from "../src/main/lib/flapshot/contracts"

function capabilityDocument() {
  const methods = [
    ["screenshot", "listTargets"],
    ["screenshot", "capture"],
    ["recording", "listTargets"],
    ["recording", "start"],
  ].map(([schema, method]) => ({
    schema,
    schemaVersion: 1,
    method,
    availability: "available",
    available: true,
    reason: "AVAILABLE",
  }))
  return JSON.stringify({
    server: { name: "flapshot", version: "0.1.0" },
    applicationSchemas: {
      screenshot: 1,
      recording: 1,
      artifacts: 1,
      operations: 1,
      system: 1,
    },
    tools: [
      { name: FLAPSHOT_TOOLS.authStatus, operation: "system.authStatus" },
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

describe("Flapshot MCP connection lifecycle", () => {
  it("discovers once, reconnects after disconnect, and closes without leaking", async () => {
    let disconnect: ((error?: Error) => void) | null = null
    const close = vi.fn(async () => undefined)
    const factory = vi.fn<FlapshotConnectionFactory>(async (_config, onDisconnect) => {
      disconnect = onDisconnect
      const client: FlapshotProtocolClient = {
        listTools: async () => ({
          tools: [
            { name: FLAPSHOT_TOOLS.authStatus },
            { name: FLAPSHOT_TOOLS.screenshotTargets },
            { name: FLAPSHOT_TOOLS.screenshotCapture },
            { name: FLAPSHOT_TOOLS.recordingTargets },
            { name: FLAPSHOT_TOOLS.recordingStart },
          ],
        }),
        readResource: async () => ({ contents: [{ text: capabilityDocument() }] }),
        callTool: async (input) => ({
          content: [{ type: "text", text: "{}" }],
          structuredContent: {
            ok: true,
            data: {
              paired: true,
              connectionId: "connection-1",
              pairingCode: null,
            },
            meta: {
              envelopeVersion: 1,
              schema: "system",
              schemaVersion: 1,
              requestId: String(input.arguments?.requestId),
              correlationId: String(input.arguments?.requestId),
              auditCorrelationId: "audit-auth-1",
            },
          },
        }),
        getServerVersion: () => ({ name: "flapshot", version: "0.1.0" }),
        close,
      }
      return { client, close }
    })
    const disconnected = vi.fn()
    const manager = new FlapshotMcpClientManager(factory, disconnected, async () => ({
      command: "flapshot-mcp",
      args: [],
      env: {},
    }))

    await manager.client(null)
    await manager.client(null)
    expect(factory).toHaveBeenCalledTimes(1)
    await expect(manager.status(null)).resolves.toMatchObject({
      connected: true,
      auth: { paired: true, connectionId: "connection-1", pairingCode: null },
    })

    disconnect?.(new Error("transport closed"))
    expect(disconnected).toHaveBeenCalledWith("__global__", expect.any(Error))
    await manager.client(null)
    expect(factory).toHaveBeenCalledTimes(2)

    await manager.closeAll()
    expect(close).toHaveBeenCalled()
  })

  it("rejects incompatible application schema versions", async () => {
    const document = JSON.parse(capabilityDocument())
    document.applicationSchemas.operations = 2
    const factory: FlapshotConnectionFactory = async () => ({
      client: {
        listTools: async () => ({
          tools: [
            { name: FLAPSHOT_TOOLS.authStatus },
            { name: FLAPSHOT_TOOLS.screenshotTargets },
            { name: FLAPSHOT_TOOLS.screenshotCapture },
            { name: FLAPSHOT_TOOLS.recordingTargets },
            { name: FLAPSHOT_TOOLS.recordingStart },
          ],
        }),
        readResource: async () => ({ contents: [{ text: JSON.stringify(document) }] }),
        callTool: async () => ({ content: [] }),
        getServerVersion: () => ({ name: "flapshot", version: "0.1.0" }),
        close: async () => undefined,
      },
      close: async () => undefined,
    })
    const manager = new FlapshotMcpClientManager(factory, undefined, async () => ({
      command: "flapshot-mcp",
      args: [],
      env: {},
    }))
    await expect(manager.client(null)).rejects.toThrow("Unsupported Flapshot operations schema")
  })
})
