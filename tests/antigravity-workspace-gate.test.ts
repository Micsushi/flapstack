import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { expect, it, vi } from "vitest"
import type { RuntimeAdapterContext } from "../src/shared/agent-runtime"
import { createAntigravityAdapter } from "../src/main/lib/agent-runtime/antigravity/adapter"

const acp = vi.hoisted(() => ({
  spawn: vi.fn(),
  initialize: vi.fn(async () => ({ protocolVersion: 1 })),
  newSession: vi.fn(async () => ({ sessionId: "test" })),
  setSessionMode: vi.fn(),
}))
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: acp.spawn,
}))
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  existsSync: () => true,
}))
vi.mock("@agentclientprotocol/sdk", async (original) => ({
  ...(await original<typeof import("@agentclientprotocol/sdk")>()),
  ClientSideConnection: class {
    initialize = acp.initialize
    newSession = acp.newSession
    setSessionMode = acp.setSessionMode
  },
}))

it("initializes ACP independently and only gives it the project once its checkpoint is ready", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill() {
      this.emit("close")
    },
  })
  acp.spawn.mockReturnValue(child)
  let release!: () => void
  const workspace = new Promise<void>((resolve) => {
    release = resolve
  })
  const cwd = vi.fn(() => "/selected/project")
  const adapter = createAntigravityAdapter({
    cwd,
    registration: () => ({
      command: "electron",
      args: ["app/mcp-control-stdio.js"],
      env: { FLAPSTACK_MCP_CHAT_ID: "chat-1", FLAPSTACK_MCP_RUN_ID: "workspace-gate" },
    }),
    images: () => [],
    append: vi.fn(),
    permission: vi.fn(),
    ask: vi.fn(),
  })
  const context = {
    runId: "workspace-gate",
    signal: new AbortController().signal,
    launch: { permission: { mode: "full-access" }, controls: { antigravityNativeApprovals: true } },
    waitForWorkspace: () => workspace,
  } as RuntimeAdapterContext
  try {
    const session = adapter.startSession(context)
    await vi.waitFor(() => expect(acp.initialize).toHaveBeenCalledTimes(1))
    expect(acp.spawn.mock.calls[0]?.[2].cwd).not.toBe("/selected/project")
    expect(cwd).not.toHaveBeenCalled()
    expect(acp.newSession).not.toHaveBeenCalled()
    release()
    await expect(session).resolves.toMatchObject({ providerSessionId: "test" })
    expect(acp.newSession).toHaveBeenCalledWith({
      cwd: "/selected/project",
      mcpServers: [
        {
          name: "flapstack",
          command: "electron",
          args: ["app/mcp-control-stdio.js"],
          env: [
            { name: "FLAPSTACK_MCP_CHAT_ID", value: "chat-1" },
            { name: "FLAPSTACK_MCP_RUN_ID", value: "workspace-gate" },
          ],
        },
      ],
    })
  } finally {
    release()
    await adapter.cleanup(context)
  }
})
