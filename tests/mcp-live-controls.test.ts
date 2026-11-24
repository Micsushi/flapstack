import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { drainPendingMcpRuns } from "../src/main/lib/run-launch-service"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { agentInputLifecycle } from "../src/main/lib/agent-input/service"
import { invokeDesktopRunTool } from "../src/main/lib/mcp-control/desktop-run-actions"
import { childLiveKey, CHILD_LIVE_KEY } from "../src/main/lib/mcp-control/child-live-key"
import {
  advertiseProductMcpRuntime,
  readProductMcpRuntimePointer,
} from "../src/main/lib/mcp-control/live-discovery"
import {
  callDesktopMcpTool,
  startDesktopMcpTransport,
} from "../src/main/lib/mcp-control/live-transport"
import {
  createProductMcpInvalidationEndpoint,
  startProductMcpInvalidationBridge,
} from "../src/main/lib/mcp-control/invalidation-bridge"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"
import type { McpCallerIdentity } from "../src/main/lib/mcp-control/types"

const runtime = vi.hoisted(() => ({ cancel: vi.fn(), steer: vi.fn() }))
vi.mock("../src/main/lib/main-run-launcher", () => ({ getMainRuntimeLaunchService: () => runtime }))
vi.mock("../src/main/lib/trpc/routers/opencode", () => ({
  listPendingOpencodeApprovals: () => [],
  replyPendingOpencodeApproval: vi.fn(),
}))
vi.mock("../src/main/lib/db", async (original) => ({
  ...(await original<typeof import("../src/main/lib/db")>()),
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
  it("authenticates the launch-bound child over the profile socket and rejects a completed caller", async () => {
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
      expect(runtime.cancel).not.toHaveBeenCalled()
      vi.stubEnv(CHILD_LIVE_KEY, childLiveKey("controller", "child"))
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

  it("discovers the selected profile and wakes its pending run from a separate stdio process", async () => {
    sqlite.prepare("UPDATE agent_runs SET status='completed' WHERE id='turn'").run()
    const launch = vi.fn().mockResolvedValue(undefined)
    const receiver = await startProductMcpInvalidationBridge({
      onInvalidation: (event) => {
        if (event.domains.includes("runs")) void drainPendingMcpRuns(databasePath, launch)
      },
    })
    const withdraw = advertiseProductMcpRuntime(directory, {
      version: 1,
      databasePath,
      controlEndpoint: createProductMcpInvalidationEndpoint(),
      invalidationEndpoint: receiver.endpoint,
    })
    const client = new Client({ name: "external-refresh-fixture", version: "1" })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", resolve("src/main/mcp-control-stdio.ts")],
      env: {
        PATH: process.env.PATH ?? "",
        FLAPSTACK_CONFIG_DIR: directory,
        FLAPSTACK_DB_PATH: databasePath,
        FLAPSTACK_MCP_CHAT_ID: child.chatId,
        FLAPSTACK_MCP_RUN_ID: child.runId!,
      },
      stderr: "pipe",
    })
    try {
      await client.connect(transport)
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
    } finally {
      await client.close()
      withdraw()
      await receiver.stop()
    }
  }, 30_000)

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
