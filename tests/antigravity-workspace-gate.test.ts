import { EventEmitter } from "node:events"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  Client,
  ClientSideConnection,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  RequestPermissionRequest,
} from "@agentclientprotocol/sdk"
import { PassThrough } from "node:stream"
import { beforeEach, expect, it, vi } from "vitest"
import type { RuntimeAdapterContext } from "../src/shared/agent-runtime"
import {
  antigravityModels,
  createAntigravityAdapter,
} from "../src/main/lib/agent-runtime/antigravity/adapter"

import { antigravityPermissionDecision } from "../src/main/lib/agent-runtime/antigravity/permissions"

const acp = vi.hoisted(() => ({
  client: null as Client | null,
  prompt: vi.fn(),
  resume: vi.fn<ClientSideConnection["unstable_resumeSession"]>(async () => ({})),
  configure: vi.fn(),
  extension: vi.fn(async () => ({})),
  spawn: vi.fn(),
  initialize: vi.fn<() => Promise<InitializeResponse>>(async () => ({ protocolVersion: 1 })),
  newSession: vi.fn<(request: NewSessionRequest) => Promise<NewSessionResponse>>(async () => ({
    sessionId: "test",
  })),
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
    constructor(createClient: () => Client) {
      acp.client = createClient()
    }
    prompt = acp.prompt
    unstable_resumeSession = acp.resume
    setSessionConfigOption = acp.configure
    extMethod = acp.extension
    initialize = acp.initialize
    newSession = acp.newSession
    setSessionMode = acp.setSessionMode
  },
}))

beforeEach(() => vi.clearAllMocks())

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
          name: expect.stringMatching(/^flapstack[0-9a-f]{20}$/),
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

const approveOnce = { optionId: "allow", kind: "allow_once", name: "Allow" } as const
const rejectOnce = { optionId: "reject", kind: "reject_once", name: "Reject" } as const

it("applies a second turn's permission policy on the same ACP process", async () => {
  const root = await mkdtemp(join(tmpdir(), "flapstack-agy-permission-"))
  const file = join(root, "owned-fixture.txt")
  await writeFile(file, "original\n")
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: vi.fn(function (this: EventEmitter) {
      this.emit("close")
    }),
  })
  acp.initialize.mockResolvedValueOnce({
    protocolVersion: 1,
    agentCapabilities: { sessionCapabilities: { close: {} } },
  } as InitializeResponse)
  acp.spawn.mockReturnValue(child)
  const toolCall = {
    toolCallId: "fixture-write",
    kind: "edit",
    title: "Edit owned fixture",
    locations: [{ path: file }],
  } as const
  const ask = vi.fn()
  const adapter = createAntigravityAdapter({
    cwd: () => root,
    registration: (runId) => ({
      command: "electron",
      args: ["app/mcp-control-stdio.js"],
      env: { FLAPSTACK_MCP_RUN_ID: runId },
    }),
    images: () => [],
    append: vi.fn(),
    permission: ask,
    ask: vi.fn(),
  })
  function context(runId: string, mode: "read-only" | "ask-before-edits" | "full-access") {
    return {
      runId,
      chatId: "chat",
      subChatId: "subchat",
      signal: new AbortController().signal,
      launch: { permission: { mode }, controls: { reasoningDisplay: false } },
    } as RuntimeAdapterContext
  }
  const first = context("first", "read-only")
  const second = context("second", "full-access")
  const third = context("third", "ask-before-edits")
  acp.prompt.mockImplementation(async () => {
    const result = await acp.client!.requestPermission({
      sessionId: "test",
      options: [approveOnce, rejectOnce],
      toolCall: { ...toolCall, locations: [...toolCall.locations] },
    })
    if (result.outcome.outcome === "selected" && result.outcome.optionId === "allow")
      await writeFile(file, "approved update\n")
    await acp.client!.sessionUpdate({
      sessionId: "test",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Finished." },
      },
    })
    return { stopReason: "end_turn" }
  })
  async function finishTurn(
    current: RuntimeAdapterContext,
    session: Awaited<ReturnType<typeof adapter.startSession>>,
  ) {
    const turn = await adapter.startTurn(current, session, "Check the owned file.")
    for await (const _event of adapter.streamActivity(current, session, turn)) {
      // Drain the provider events before reusing the process.
    }
    await adapter.complete(current)
    await adapter.cleanup(current)
  }
  try {
    const session = await adapter.startSession(first)
    await finishTurn(first, session)
    expect(await readFile(file, "utf8")).toBe("original\n")
    expect(ask).not.toHaveBeenCalled()
    expect(child.kill).not.toHaveBeenCalled()

    await finishTurn(second, await adapter.resumeSession(second, session))
    expect(await readFile(file, "utf8")).toBe("approved update\n")
    expect(ask).not.toHaveBeenCalled()

    ask.mockResolvedValueOnce({ decision: "decline", userDeclined: true })
    await finishTurn(third, await adapter.resumeSession(third, session))
    expect(ask).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledWith(
      "third",
      expect.objectContaining({ toolName: "Edit owned fixture" }),
    )
    expect(acp.spawn).toHaveBeenCalledTimes(1)
    expect(acp.spawn.mock.calls[0]![1]).toEqual(["acp"])
    expect(acp.initialize).toHaveBeenCalledTimes(1)
    expect(acp.extension).toHaveBeenCalledWith("session/close", { sessionId: "test" })
    expect(acp.setSessionMode.mock.calls.map(([request]) => request.modeId)).toEqual([
      "default",
      "default",
      "default",
    ])
    expect(acp.resume).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: "test",
        mcpServers: [
          expect.objectContaining({ env: [{ name: "FLAPSTACK_MCP_RUN_ID", value: "third" }] }),
        ],
      }),
    )
    const names = [
      acp.newSession.mock.calls[0]![0].mcpServers[0]!.name,
      ...acp.resume.mock.calls.map(([request]) => request.mcpServers[0]!.name),
    ]
    expect(names).toHaveLength(3)
    expect(new Set(names).size).toBe(names.length)
  } finally {
    await Promise.all([first, second, third].map((current) => adapter.cleanup(current)))
    adapter.closeIdleSessions?.()
    await rm(root, { recursive: true, force: true })
  }
})

it("allows scoped file changes only inside the real checkout", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "flapstack-agy-scope-"))
  const project = join(fixture, "project")
  const neighbour = join(fixture, "neighbour")
  await Promise.all([mkdir(project), mkdir(neighbour)])
  const portal = join(project, "linked-directory")
  await symlink(neighbour, portal, process.platform === "win32" ? "junction" : "dir")
  const permission = { mode: "auto-edit-project-only", customPermissions: null } as const
  const check = (kind: RequestPermissionRequest["toolCall"]["kind"], paths: string[]) =>
    antigravityPermissionDecision(
      permission,
      {
        toolCallId: "file",
        kind,
        locations: paths.map((path) => ({ path })),
      },
      project,
      null,
    )
  try {
    expect(check("edit", [join(project, "new.txt")])).toBe("allow")
    expect(check("edit", [join(portal, "other.txt")])).toBe("deny")
    expect(check("move", [join(project, "new.txt"), join(neighbour, "other.txt")])).toBe("deny")
    expect(check("move", [join(project, "new.txt")])).toBe("deny")
    expect(check("delete", [project])).toBe("deny")
    expect(check("execute", [project])).toBe("deny")
    expect(check("read", [])).toBe("allow")
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

it("allows only the authenticated Flapstack server to use the scoped MCP gate", () => {
  const productName = "flapstack0123456789abcdef0123"
  const tool = {
    toolCallId: "fixture",
    kind: "other",
    title: "MCP Tool ping",
    rawInput: { ServerName: productName, ToolName: "ping" },
  } as const
  const scope = { mode: "auto-edit-project-only", customPermissions: null } as const
  expect(antigravityPermissionDecision(scope, tool, ".", productName)).toBe("allow")
  expect(antigravityPermissionDecision(scope, tool, ".", null)).toBe("deny")
  expect(
    antigravityPermissionDecision(
      scope,
      {
        ...tool,
        rawInput: { ...tool.rawInput, ServerName: "project-data" },
      },
      ".",
      productName,
    ),
  ).toBe("deny")
  expect(
    antigravityPermissionDecision(
      { mode: "read-only", customPermissions: null },
      {
        ...tool,
        title: "MCP Tool create_chat",
        rawInput: { ServerName: productName, ToolName: "create_chat" },
      },
      ".",
      productName,
    ),
  ).toBe("deny")
})

it("uses the ordinary approval when native MCP identity does not match this run", () => {
  const permission = { mode: "ask-before-edits", customPermissions: null } as const
  const productName = "flapstack0123456789abcdef0123"
  const tool = {
    toolCallId: "product-ping",
    kind: "other",
    title: `Run mcp_${productName}_ping?`,
  } as const
  expect(antigravityPermissionDecision(permission, tool, ".", productName)).toBe("allow")
  expect(antigravityPermissionDecision(permission, tool, ".", null)).toBe("ask")
  expect(
    antigravityPermissionDecision(permission, tool, ".", "flapstackabcdef0123456789abcd"),
  ).toBe("ask")
  expect(
    antigravityPermissionDecision(
      permission,
      { ...tool, title: "Run mcp_flapstack_ping?" },
      ".",
      productName,
    ),
  ).toBe("ask")
  expect(
    antigravityPermissionDecision(
      permission,
      { ...tool, rawInput: { ServerName: "project-data" } },
      ".",
      productName,
    ),
  ).toBe("ask")
  expect(
    antigravityPermissionDecision(
      permission,
      { ...tool, _meta: { serverName: "project-data" } },
      ".",
      productName,
    ),
  ).toBe("ask")
  expect(
    antigravityPermissionDecision(
      permission,
      { ...tool, rawInput: { ToolName: "describe" } },
      ".",
      productName,
    ),
  ).toBe("ask")
  expect(
    antigravityPermissionDecision(
      permission,
      {
        ...tool,
        title: "MCP Tool ping",
        rawInput: { ServerName: "flapstack", ToolName: "ping" },
      },
      ".",
      productName,
    ),
  ).toBe("ask")
})

it("refreshes each ACP model's own reasoning options without a prompt", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill() {
      this.emit("close")
    },
  })
  acp.spawn.mockReturnValue(child)
  acp.initialize.mockResolvedValueOnce({
    protocolVersion: 1,
    agentInfo: { name: "Antigravity", version: "1.5.1" },
  })
  acp.newSession.mockResolvedValueOnce({
    sessionId: "catalog-probe",
    configOptions: [
      {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "gemini-fixture",
        options: [
          { value: "gemini-fixture", name: "Gemini fixture" },
          { value: "other-fixture", name: "Other fixture" },
        ],
      },
      {
        id: "thinking",
        category: "thought_level",
        name: "Thinking",
        type: "select",
        currentValue: "low",
        options: [{ value: "low", name: "Low" }],
      },
    ],
  })
  acp.configure.mockResolvedValueOnce({
    configOptions: [
      {
        id: "thinking",
        category: "thought_level",
        name: "Thinking",
        type: "select",
        currentValue: "high",
        options: [{ value: "high", name: "High" }],
      },
    ],
  })
  await expect(antigravityModels()).resolves.toEqual([
    {
      id: "gemini-fixture",
      name: "Gemini fixture",
      defaultEffort: "low",
      nativeEfforts: [{ value: "low", name: "Low" }],
    },
    {
      id: "other-fixture",
      name: "Other fixture",
      defaultEffort: "high",
      nativeEfforts: [{ value: "high", name: "High" }],
    },
  ])
  expect(acp.configure).toHaveBeenCalledWith({
    sessionId: "catalog-probe",
    configId: "model",
    value: "other-fixture",
  })
  expect(acp.prompt).not.toHaveBeenCalled()
})
