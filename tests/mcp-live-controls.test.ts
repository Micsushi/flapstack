import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import { signedMcpHttpFetch } from "../src/main/lib/mcp-control/http-auth"
import { drainPendingMcpRuns } from "../src/main/lib/run-launch-service"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { startProductMcpRuntime } from "../src/main/lib/mcp-control/desktop-invocation"
import { agentInputLifecycle } from "../src/main/lib/agent-input/service"
import { invokeDesktopRunTool } from "../src/main/lib/mcp-control/desktop-run-actions"
import { childLiveKey, CHILD_LIVE_KEY } from "../src/main/lib/mcp-control/child-live-key"
import {
  advertiseProductMcpRuntime,
  readProductMcpRuntimePointer,
} from "../src/main/lib/mcp-control/live-discovery"
import { startDesktopMcpTransport } from "../src/main/lib/mcp-control/live-transport"
import { openDesktopMcpEndpoint } from "../src/main/lib/mcp-control/stdio-relay"
import { createProductMcpInvalidationEndpoint } from "../src/main/lib/mcp-control/invalidation-bridge"
import { createExternalMcpRegistration } from "../src/main/lib/mcp-control/external-registration"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"
import type { McpCallerIdentity } from "../src/main/lib/mcp-control/types"

const runtime = vi.hoisted(() => ({
  cancel: vi.fn(),
  steer: vi.fn(),
  activeRunIds: vi.fn(() => ["turn"]),
  compatibilityCancel: vi.fn(),
}))
vi.mock("../src/main/lib/trpc/routers/codex", () => ({
  cancelActiveCodexRun: runtime.compatibilityCancel,
}))
vi.mock("../src/main/lib/mcp-control/desktop-workflows", () => ({ invokeDesktopWorkflow: vi.fn() }))
vi.mock("../src/main/lib/mcp-control/desktop-project-actions", () => ({
  invokeDesktopProjectTool: vi.fn(),
}))
vi.mock("../src/main/lib/mcp-control/desktop-models", () => ({
  invokeDesktopModelDiscovery: vi.fn(),
}))
vi.mock("../src/main/lib/main-run-launcher", () => ({ getMainRuntimeLaunchService: () => runtime }))
vi.mock("../src/main/lib/trpc/routers/opencode", () => ({
  listPendingOpencodeApprovals: () => [],
  replyPendingOpencodeApproval: vi.fn(),
}))
vi.mock("../src/main/lib/db", async (original) => ({
  ...(await original<typeof import("../src/main/lib/db")>()),
  withDatabaseOperation: async (operation: () => Promise<unknown>) => operation(),
  getDatabase: () => drizzle(sqlite, { schema }),
  getDatabasePath: () => databasePath,
  getSqliteDatabase: () => sqlite,
}))

let directory: string, databasePath: string, sqlite: Database.Database
const child: McpCallerIdentity = {
  chatId: "controller",
  runId: "child",
  permissionMode: "full-access",
  projectId: null,
}
const owner: McpCallerIdentity = {
  callerKind: "external-owner",
  chatId: "external-owner:test",
  permissionMode: "full-access",
  projectId: null,
}

async function callDesktopMcpTool(
  name: string,
  caller: McpCallerIdentity,
  args: Record<string, unknown>,
) {
  const endpoint = readProductMcpRuntimePointer()!.controlEndpoint
  const client = new Client({ name: "direct-http-fixture", version: "1" })
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    fetch: signedMcpHttpFetch(endpoint, caller, "direct"),
  })
  try {
    await client.connect(transport)
    return (await client.callTool({ name, arguments: args })).structuredContent
  } catch (error) {
    if (error instanceof Error && error.message.includes("proof was rejected"))
      return { ok: false, error: { code: "invalid-caller" } }
    throw error
  } finally {
    await transport.terminateSession().catch(() => undefined)
    await client.close()
  }
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-live-control-"))
  databasePath = join(directory, "agents.db")
  vi.stubEnv("FLAPSTACK_DB_PATH", databasePath)
  vi.stubEnv("FLAPSTACK_CONFIG_DIR", directory)
  sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve("drizzle") })
  for (const [chat, run] of [
    ["controller", "child"],
    ["target", "turn"],
  ]) {
    sqlite
      .prepare(
        "INSERT INTO chats(id,scope,harness,permission_mode,mcp_exposure_enabled) VALUES (?,'global','codex','full-access',1)",
      )
      .run(chat)
    sqlite
      .prepare(
        "INSERT INTO sub_chats(id,chat_id,harness,permission_mode,messages) VALUES (?,?,'codex','full-access','[]')",
      )
      .run(chat + "-sub", chat)
    sqlite
      .prepare(
        `INSERT INTO agent_runs (id,chat_id,sub_chat_id,harness,permission_mode,status,started_at,initial_prompt,runtime_snapshot_version,
      runtime_preference,runtime_preference_source,resolved_runtime,runtime_adapter_version,runtime_protocol_version,runtime_capability_snapshot,runtime_control_snapshot)
      VALUES (?,?,?,'codex','full-access','running',0,'original turn',?,?,?,?,?,?,?,?)`,
      )
      .run(run, chat, chat + "-sub", ...testRuntimeSnapshotSqlValues())
  }
})
afterEach(() => {
  agentInputLifecycle.dispose()
  sqlite.close()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  rmSync(directory, { recursive: true, force: true })
})

describe("live app control", () => {
  it("authenticates the launch-bound child over authenticated loopback HTTP and rejects a completed caller", async () => {
    const desktop = await startDesktopMcpTransport(
      databasePath,
      async (name, input, resolveCaller) => invokeDesktopRunTool(name, resolveCaller(), input),
    )
    const withdraw = advertiseProductMcpRuntime(directory, {
      version: 1,
      databasePath,
      invalidationEndpoint: createProductMcpInvalidationEndpoint(),
      controlEndpoint: desktop.endpoint,
    })
    try {
      vi.stubEnv(CHILD_LIVE_KEY, childLiveKey("controller", "other-run"))
      expect(await callDesktopMcpTool("stop_run", child, { runId: "turn" })).toMatchObject({
        ok: false,
        error: { code: "invalid-caller" },
      })
      for (const name of ["list_chats", "create_chat"]) {
        expect(await callDesktopMcpTool(name, child, {})).toMatchObject({
          ok: false,
          error: { code: "invalid-caller" },
        })
      }
      expect(runtime.cancel).not.toHaveBeenCalled()
      vi.stubEnv(CHILD_LIVE_KEY, childLiveKey("controller", "child"))
      expect(await callDesktopMcpTool("list_pending_approvals", child, {})).toMatchObject({
        ok: true,
        data: { items: [] },
      })
      expect(
        await callDesktopMcpTool("steer_run", child, { runId: "turn", message: "Please clarify." }),
      ).toMatchObject({ ok: true, data: { delivery: "steered" } })
      expect(runtime.steer).toHaveBeenCalledWith("turn", "target-sub", "Please clarify.")
      runtime.cancel.mockResolvedValueOnce(true)
      expect(await callDesktopMcpTool("stop_run", child, { runId: "turn" })).toMatchObject({
        ok: true,
        data: { stopped: true },
      })
      sqlite.prepare("UPDATE agent_runs SET status='completed' WHERE id='child'").run()
      expect(await callDesktopMcpTool("stop_run", child, { runId: "turn" })).toMatchObject({
        ok: false,
        error: { code: "invalid-caller" },
      })
      expect(runtime.cancel).toHaveBeenCalledTimes(1)
    } finally {
      withdraw()
      await desktop.stop()
    }
    expect(readProductMcpRuntimePointer()).toBeNull()
  })

  it("only uses offline discovery for a refused endpoint when its publisher is confirmed gone", async () => {
    await expect(openDesktopMcpEndpoint()).resolves.toBeNull()
    const desktop = await startDesktopMcpTransport(databasePath, async () => ({
      ok: true,
      data: {},
    }))
    const pointer = {
      version: 1 as const,
      databasePath,
      invalidationEndpoint: createProductMcpInvalidationEndpoint(),
      controlEndpoint: desktop.endpoint,
    }
    const withdraw = advertiseProductMcpRuntime(directory, pointer)
    try {
      await expect(openDesktopMcpEndpoint()).resolves.toBe(desktop.endpoint)
    } finally {
      await desktop.stop()
    }
    const kill = vi.spyOn(process, "kill")
    try {
      await expect(openDesktopMcpEndpoint()).rejects.toThrow(/could not confirm/i)
      expect(kill).toHaveBeenLastCalledWith(process.pid, 0)
      kill.mockImplementationOnce(() => {
        throw Object.assign(new Error("Access denied"), { code: "EPERM" })
      })
      await expect(openDesktopMcpEndpoint()).rejects.toThrow(/could not confirm/i)
      kill.mockImplementationOnce(() => {
        advertiseProductMcpRuntime(directory, {
          ...pointer,
          invalidationEndpoint: createProductMcpInvalidationEndpoint(),
        })
        throw Object.assign(new Error("No such process"), { code: "ESRCH" })
      })
      await expect(openDesktopMcpEndpoint()).rejects.toThrow(/could not confirm/i)
      kill.mockImplementationOnce(() => {
        throw Object.assign(new Error("No such process"), { code: "ESRCH" })
      })
      await expect(openDesktopMcpEndpoint()).resolves.toBeNull()
    } finally {
      kill.mockRestore()
      withdraw()
    }
  })

  it("discovers the selected profile and wakes its pending run from a separate stdio process", async () => {
    sqlite.prepare("UPDATE agent_runs SET status='completed' WHERE id='turn'").run()
    const launch = vi.fn().mockResolvedValue(undefined)
    const receiver = await startProductMcpRuntime(databasePath, (event) => {
      if (event.domains.includes("runs")) void drainPendingMcpRuns(databasePath, launch)
    })
    const client = new Client({ name: "stdio-relay-fixture", version: "1" })
    const changes = vi.fn()
    client.setNotificationHandler(ToolListChangedNotificationSchema, changes)

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", resolve("src/main/mcp-control-stdio.ts")],
      env: {
        PATH: process.env.PATH ?? "",
        FLAPSTACK_CONFIG_DIR: directory,
        FLAPSTACK_DB_PATH: databasePath,
        [CHILD_LIVE_KEY]: childLiveKey(child.chatId, child.runId!),
        FLAPSTACK_MCP_CHAT_ID: child.chatId,
        FLAPSTACK_MCP_RUN_ID: child.runId!,
      },
      stderr: "pipe",
    })
    try {
      await client.connect(transport)
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
        "ping",
        "describe",
        "list_chats",
        "create_chat",
        "spawn_thread",
        "launch_run",
        "tool_search",
      ])
      const resultSearch = await client.callTool({
        name: "tool_search",
        arguments: { query: "read_chat" },
      })
      expect(resultSearch.structuredContent).toMatchObject({
        ok: true,
        data: { tools: [{ name: "read_chat" }] },
      })
      await vi.waitFor(() => expect(changes).toHaveBeenCalled())
      expect((await client.listTools()).tools.some((tool) => tool.name === "read_chat")).toBe(true)
      expect(
        (await client.callTool({ name: "read_chat", arguments: { chatId: "target" } }))
          .structuredContent,
      ).toMatchObject({ ok: true, data: { chat: { id: "target" } } })
      const result = await client.callTool({
        name: "launch_run",
        arguments: { chatId: "target", initialPrompt: "Live pickup", idempotencyKey: "wakeup" },
      })
      expect(result.structuredContent).toMatchObject({ ok: true })
      await vi.waitFor(() =>
        expect(launch).toHaveBeenCalledWith(
          expect.objectContaining({ chatId: "target", prompt: "Live pickup" }),
        ),
      )
      const childRun = await client.callTool({
        name: "spawn_thread",
        arguments: {
          targetHarness: "claude-code",
          scope: { kind: "global" },
          permission: { mode: "read-only" },
          worktree: { strategy: "none" },
          launch: { initialPrompt: "Child pickup without polling" },
        },
      })
      expect(childRun.structuredContent).toMatchObject({ ok: true })
      await vi.waitFor(() =>
        expect(launch).toHaveBeenCalledWith(
          expect.objectContaining({
            harness: "claude-code",
            prompt: "Child pickup without polling",
          }),
        ),
      )
    } finally {
      await client.close()
      await receiver.stop()
    }
  }, 30_000)

  it("accepts the registered external client's signed call and checks revocation on the next connection", async () => {
    const credentials = mkdtempSync(join(tmpdir(), "flapstack-live-registration-"))
    const issued = createExternalMcpRegistration({
      client: "claude",
      configDir: directory,
      databasePath,
      entryPoint: resolve("src/main/mcp-control-stdio.ts"),
      executablePath: process.execPath,
      outputRoot: credentials,
      permissionMode: "full-access",
    })
    const config = JSON.parse(readFileSync(issued.configPath, "utf8")).mcpServers[
      "flapstack-app-control"
    ]
    const desktop = await startDesktopMcpTransport(
      databasePath,
      async (name, input, resolveCaller) => invokeDesktopRunTool(name, resolveCaller(), input),
    )
    const withdraw = advertiseProductMcpRuntime(directory, {
      version: 1,
      databasePath,
      controlEndpoint: desktop.endpoint,
      invalidationEndpoint: createProductMcpInvalidationEndpoint(),
    })
    const client = new Client({ name: "signed-external-fixture", version: "1" })
    try {
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: ["--import", "tsx", ...config.args],
          env: { PATH: process.env.PATH ?? "", ...config.env, FLAPSTACK_MCP_TOOL_EXPOSURE: "lazy" },
          stderr: "pipe",
        }),
      )
      expect((await fetch(desktop.endpoint)).status).toBe(401)
      expect((await client.listTools()).tools.map(({ name }) => name)).not.toContain(
        "list_pending_approvals",
      )
      expect(
        (
          await client.callTool({
            name: "tool_search",
            arguments: { query: "list_pending_approvals" },
          })
        ).structuredContent,
      ).toMatchObject({ ok: true, data: { tools: [{ name: "list_pending_approvals" }] } })
      expect((await client.listTools()).tools.map(({ name }) => name)).toContain(
        "list_pending_approvals",
      )
      expect(
        (await client.callTool({ name: "list_pending_approvals", arguments: {} }))
          .structuredContent,
      ).toMatchObject({ ok: true, data: { items: [] } })
      unlinkSync(issued.grantPath)
      expect(
        (await client.callTool({ name: "list_pending_approvals", arguments: {} }))
          .structuredContent,
      ).toMatchObject({ ok: false })
    } finally {
      await client.close()
      withdraw()
      await desktop.stop()
      rmSync(credentials, { recursive: true, force: true })
    }
  }, 30_000)

  it("queues a follow-up behind a running turn and retries a failed prompt once per operation key", async () => {
    const queued = await invokeDesktopRunTool("steer_run", child, {
      runId: "turn",
      delivery: "queue",
      message: "second",
      idempotencyKey: "followup-1",
    })
    expect(queued).toMatchObject({
      ok: true,
      data: { delivery: "queued", status: "pending", created: true },
    })
    sqlite.prepare("UPDATE agent_runs SET status='failure' WHERE id='turn'").run()
    const args = { runId: "turn", idempotencyKey: "retry-1" }
    expect(await invokeDesktopRunTool("retry_run", child, args)).toMatchObject({
      ok: true,
      data: { created: true, retryOf: "turn" },
    })
    expect(await invokeDesktopRunTool("retry_run", child, args)).toMatchObject({
      ok: true,
      data: { created: false, retryOf: "turn" },
    })
    expect(
      sqlite
        .prepare("SELECT initial_prompt FROM agent_runs WHERE status='pending' ORDER BY rowid")
        .all(),
    ).toEqual([{ initial_prompt: "second" }, { initial_prompt: "original turn" }])
  })

  it("refuses to stop a higher-permission run or the caller's own run", async () => {
    const restricted = { ...child, permissionMode: "ask-before-edits" as const }
    for (const status of ["pending", "running"]) {
      sqlite.prepare("UPDATE agent_runs SET status=? WHERE id='turn'").run(status)
      expect(await invokeDesktopRunTool("stop_run", restricted, { runId: "turn" })).toMatchObject({
        ok: false,
        error: { code: "permission-denied" },
      })
      expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id='turn'").pluck().get()).toBe(
        status,
      )
    }
    expect(await invokeDesktopRunTool("stop_run", child, { runId: child.runId })).toMatchObject({
      ok: false,
      error: { code: "forbidden-loop" },
    })
    expect(runtime.cancel).not.toHaveBeenCalled()
    expect(runtime.compatibilityCancel).not.toHaveBeenCalled()
  })

  it("answers questions once and keeps permission resolution with the external owner", async () => {
    const pending = (kind: "permission" | "question") =>
      agentInputLifecycle.create({
        kind,
        requestId: kind,
        runId: "turn",
        chatId: "target-sub",
        origin: { harness: "codex" },
        capability: { mode: "native", sameRun: true },
        status: "pending",
        createdAt: Date.now(),
        questions: [
          {
            id: kind,
            question: "Continue?",
            options: [
              { id: "allow", label: "Allow once" },
              { id: "deny", label: "Deny" },
            ],
            multiSelect: false,
            allowCustom: false,
          },
        ],
      })
    const question = pending("question")
    expect(
      await invokeDesktopRunTool("list_pending_approvals", child, { runId: "turn" }),
    ).toMatchObject({ ok: true, data: { items: [{ requestId: "question", runId: "turn" }] } })
    expect(
      await invokeDesktopRunTool("answer_agent_question", child, {
        requestId: "question",
        answers: { question: ["Deny"] },
      }),
    ).toMatchObject({ ok: true })
    expect((await question).status).toBe("answered")
    expect(
      await invokeDesktopRunTool("answer_agent_question", child, {
        requestId: "question",
        answers: { question: ["Deny"] },
      }),
    ).toMatchObject({ ok: false })
    const permission = pending("permission")
    const args = { kind: "permission", requestId: "permission", decision: "approve" }
    expect(
      await invokeDesktopRunTool("answer_agent_question", child, {
        requestId: "permission",
        answers: { permission: ["Allow once"] },
      }),
    ).toMatchObject({ ok: false })
    expect(await invokeDesktopRunTool("respond_to_approval", child, args)).toMatchObject({
      ok: false,
      error: { code: "permission-denied" },
    })
    expect(await invokeDesktopRunTool("respond_to_approval", owner, args)).toMatchObject({
      ok: true,
    })
    expect(await permission).toMatchObject({
      status: "answered",
      response: { answers: { permission: ["Allow once"] } },
    })
  })
})
