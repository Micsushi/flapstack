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
import { resolveStoredOperationScope } from "../src/main/lib/flapshot/lifecycle"

function capabilityDocument(includeAuthStatus = true) {
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
      ...(includeAuthStatus
        ? [{ name: FLAPSHOT_TOOLS.authStatus, operation: "system.authStatus" }]
        : []),
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
  it("rebuilds operation scope from the stored chat, never the triggering chat", () => {
    const resolved: string[] = []
    const scope = resolveStoredOperationScope(
      { chatId: "chat-a", taskId: "stored-task-a", connectionKey: "project-shared" },
      (chatId) => {
        resolved.push(chatId)
        return {
          chatId,
          taskId: "current-task-changed",
          projectPath: "/project",
          connectionKey: "project-shared",
        }
      },
    )
    expect(resolved).toEqual(["chat-a"])
    expect(scope).toMatchObject({ chatId: "chat-a", taskId: "stored-task-a" })
  })

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

  it("keeps standard MCP connected when transport auth status is not advertised", async () => {
    const callTool = vi.fn()
    const factory: FlapshotConnectionFactory = async () => ({
      client: {
        listTools: async () => ({
          tools: [
            { name: FLAPSHOT_TOOLS.screenshotTargets },
            { name: FLAPSHOT_TOOLS.screenshotCapture },
            { name: FLAPSHOT_TOOLS.recordingTargets },
            { name: FLAPSHOT_TOOLS.recordingStart },
          ],
        }),
        readResource: async () => ({ contents: [{ text: capabilityDocument(false) }] }),
        callTool,
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

    await expect(manager.status(null)).resolves.toMatchObject({
      connected: true,
      pairingStatusSupported: false,
      auth: null,
    })
    expect(callTool).not.toHaveBeenCalled()
    await manager.closeAll()
  })

  it("discovers dedicated transport auth outside the frozen application catalog", async () => {
    const callTool = vi.fn(async (input: { arguments?: Record<string, unknown> }) => ({
      structuredContent: {
        ok: true,
        data: { paired: false, connectionId: "connection-transport", pairingCode: "654321" },
        meta: {
          envelopeVersion: 1,
          schema: "transport-auth",
          schemaVersion: 1,
          requestId: String(input.arguments?.requestId),
          correlationId: String(input.arguments?.requestId),
          auditCorrelationId: "audit-auth-transport",
        },
      },
    }))
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
        readResource: async () => ({ contents: [{ text: capabilityDocument(false) }] }),
        callTool,
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

    await expect(manager.status(null)).resolves.toMatchObject({
      connected: true,
      pairingStatusSupported: true,
      auth: {
        paired: false,
        connectionId: "connection-transport",
        pairingCode: "654321",
      },
    })
    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: FLAPSHOT_TOOLS.authStatus }),
      expect.anything(),
    )
    await manager.closeAll()
  })

  it("deduplicates concurrent connection attempts for one scope", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const factory = vi.fn<FlapshotConnectionFactory>(async () => {
      await gate
      const client: FlapshotProtocolClient = {
        listTools: async () => ({
          tools: [
            { name: FLAPSHOT_TOOLS.screenshotTargets },
            { name: FLAPSHOT_TOOLS.screenshotCapture },
            { name: FLAPSHOT_TOOLS.recordingTargets },
            { name: FLAPSHOT_TOOLS.recordingStart },
          ],
        }),
        readResource: async () => ({ contents: [{ text: capabilityDocument(false) }] }),
        callTool: async () => ({ content: [] }),
        getServerVersion: () => ({ name: "flapshot", version: "0.1.0" }),
        close: async () => undefined,
      }
      return { client, close: async () => undefined }
    })
    const manager = new FlapshotMcpClientManager(factory, undefined, async () => ({
      command: "flapshot-mcp",
      args: [],
      env: {},
    }))

    const first = manager.client(null)
    const second = manager.client(null)
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1))
    release()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(factory).toHaveBeenCalledTimes(1)
    await manager.closeAll()
  })

  it("ignores a stale disconnect after configuration replacement", async () => {
    let command = "flapshot-mcp-one"
    const disconnects: Array<(error?: Error) => void> = []
    const factory = vi.fn<FlapshotConnectionFactory>(async (_config, onDisconnect) => {
      disconnects.push(onDisconnect)
      const client: FlapshotProtocolClient = {
        listTools: async () => ({
          tools: [
            { name: FLAPSHOT_TOOLS.screenshotTargets },
            { name: FLAPSHOT_TOOLS.screenshotCapture },
            { name: FLAPSHOT_TOOLS.recordingTargets },
            { name: FLAPSHOT_TOOLS.recordingStart },
          ],
        }),
        readResource: async () => ({ contents: [{ text: capabilityDocument(false) }] }),
        callTool: async () => ({ content: [] }),
        getServerVersion: () => ({ name: "flapshot", version: "0.1.0" }),
        close: async () => undefined,
      }
      return { client, close: async () => undefined }
    })
    const disconnected = vi.fn()
    const manager = new FlapshotMcpClientManager(factory, disconnected, async () => ({
      command,
      args: [],
      env: {},
    }))

    await manager.client(null)
    command = "flapshot-mcp-two"
    await manager.client(null)
    disconnects[0]?.(new Error("late close"))
    await manager.client(null)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(disconnected).not.toHaveBeenCalled()
    await manager.closeAll()
  })

  it("refreshes capability discovery on every status check", async () => {
    const document = JSON.parse(capabilityDocument(false))
    const client: FlapshotProtocolClient = {
      listTools: async () => ({
        tools: [
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
    }
    const manager = new FlapshotMcpClientManager(
      async () => ({ client, close: async () => undefined }),
      undefined,
      async () => ({ command: "flapshot-mcp", args: [], env: {} }),
    )

    await expect(manager.status(null)).resolves.toMatchObject({ connected: true })
    const capture = document.application.data.methods.find(
      (method: { schema: string; method: string }) =>
        method.schema === "screenshot" && method.method === "capture",
    )
    capture.available = false
    capture.availability = "unavailable"
    capture.reason = "PERMISSION_REQUIRED"
    const refreshed = await manager.status(null)
    expect(
      refreshed.discovery?.application.ok &&
        refreshed.discovery.application.data.methods.find(
          (method) => method.schema === "screenshot" && method.method === "capture",
        ),
    ).toMatchObject({ available: false, reason: "PERMISSION_REQUIRED" })
    await manager.closeAll()
  })
})
