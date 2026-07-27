import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { appendMcpAuditRecord } from "../src/main/lib/mcp-control/audit-storage"
import { createMcpTaskProposalService } from "../src/main/lib/mcp-control/task-proposal-service"
import { getMcpControlTool, invokeMcpControlTool } from "../src/main/lib/mcp-control/registry"
import { TaskProposalError, TaskProposalService } from "../src/main/lib/task-proposals"
import { taskProposalsRouter } from "../src/main/lib/trpc/routers/task-proposals"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"
import {
  AI_TASK_PROPOSAL_BATCH_CAP,
  AI_TASK_PROPOSAL_PENDING_CAP,
  AI_TASK_PROPOSAL_RATE_CAP,
  type TaskProposalContent,
} from "../src/shared/task-proposals"

let directory = ""
let databasePath = ""
let sqlite: Database.Database
let database: ReturnType<typeof drizzle<typeof schema>>
let service: TaskProposalService
let now = 1_800_000_000_000

const agent = { type: "agent" as const, chatId: "caller", runId: "caller-run" }
const user = { type: "user" as const, id: "local-user" }
const mcpCaller = {
  chatId: "caller",
  runId: "caller-run",
  permissionMode: "full-access" as const,
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-ai-task-proposals-"))
  databasePath = join(directory, "agents.db")
  sqlite = new Database(databasePath)
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare(
      `INSERT INTO projects
         (id, name, path, default_permission_mode)
       VALUES ('project-1', 'One', '/tmp/one', 'ask-before-edits'),
              ('project-2', 'Two', '/tmp/two', 'read-only')`,
    )
    .run()
  sqlite
    .prepare(
      "INSERT INTO tasks (id, project_id, name) VALUES ('caller-task', 'project-1', 'Caller')",
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO chats
         (id, name, scope, project_id, task_id, permission_mode, mcp_exposure_enabled)
       VALUES ('caller', 'Caller', 'task', 'project-1', 'caller-task', 'full-access', 1),
              ('other-caller', 'Other', 'project', 'project-2', NULL, 'full-access', 1)`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO agent_runs
         (id, chat_id, harness, permission_mode, status,
          runtime_snapshot_version, runtime_preference, runtime_preference_source,
          resolved_runtime, runtime_adapter_version, runtime_protocol_version,
          runtime_capability_snapshot, runtime_control_snapshot)
       VALUES ('caller-run', 'caller', 'codex', 'full-access', 'running',
         ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(...testRuntimeSnapshotSqlValues())
  service = new TaskProposalService(databasePath, { now: () => now })
  process.env.FLAPSTACK_DB_PATH = databasePath
})

afterEach(() => {
  sqlite.close()
  delete process.env.FLAPSTACK_DB_PATH
  rmSync(directory, { recursive: true, force: true })
})

describe("approval-gated AI task proposals", () => {
  it("registers scoped propose/list/read/update/cancel MCP tools and keeps proposals inert", async () => {
    expect(getMcpControlTool("propose_task")).toMatchObject({ tier: 1, status: "implemented" })
    expect(getMcpControlTool("list_task_proposals")).toMatchObject({ tier: 0 })
    expect(getMcpControlTool("read_task_proposal")).toMatchObject({ tier: 0 })
    expect(getMcpControlTool("update_task_proposal")).toMatchObject({ tier: 1 })
    expect(getMcpControlTool("cancel_task_proposal")).toMatchObject({ tier: 1 })

    const controls = createMcpTaskProposalService(databasePath)
    const created = await invokeMcpControlTool(
      "propose_task",
      mcpCaller,
      { idempotencyKey: "mcp-proposal", proposal: proposal() },
      undefined,
      { taskProposalControls: controls, audit: auditWriter() },
    )
    expect(created).toMatchObject({
      ok: true,
      data: { created: true, record: { status: "pending", projectId: "project-1" } },
    })
    expect(count("tasks")).toBe(1)
    expect(count("chats")).toBe(2)
    expect(count("agent_runs")).toBe(1)

    const list = await invokeMcpControlTool(
      "list_task_proposals",
      mcpCaller,
      { limit: 20, includeArchived: false },
      undefined,
      { taskProposalControls: controls, audit: auditWriter() },
    )
    expect(list).toMatchObject({ ok: true, data: { items: [{ name: "Review API" }] } })
    const proposalId = responseRecord(created).id
    await expect(
      invokeMcpControlTool("read_task_proposal", mcpCaller, { proposalId }, undefined, {
        taskProposalControls: controls,
        audit: auditWriter(),
      }),
    ).resolves.toMatchObject({ ok: true, data: { id: proposalId, version: 1 } })
    await expect(
      invokeMcpControlTool(
        "update_task_proposal",
        mcpCaller,
        {
          proposalId,
          expectedVersion: 1,
          proposal: proposal({ name: "Updated through MCP" }),
        },
        undefined,
        { taskProposalControls: controls, audit: auditWriter() },
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { changed: true, record: { name: "Updated through MCP", version: 2 } },
    })
    await expect(
      invokeMcpControlTool(
        "cancel_task_proposal",
        mcpCaller,
        { proposalId, expectedVersion: 2 },
        undefined,
        { taskProposalControls: controls, audit: auditWriter() },
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { changed: true, record: { status: "cancelled", version: 3 } },
    })
    expect(count("tasks")).toBe(1)
    expect(count("chats")).toBe(2)
  })

  it("binds idempotency to caller and exact payload", () => {
    const first = service.propose(agent, {
      idempotencyKey: "same-key",
      proposal: proposal(),
    })
    expect(
      service.propose(agent, { idempotencyKey: "same-key", proposal: proposal() }),
    ).toMatchObject({ created: false, record: { id: first.record.id, version: 1 } })
    expect(() =>
      service.propose(agent, {
        idempotencyKey: "same-key",
        proposal: proposal({ name: "Different" }),
      }),
    ).toThrowError(expect.objectContaining({ code: "conflict" }))

    const other = service.propose(
      { type: "agent", chatId: "other-caller" },
      { idempotencyKey: "same-key", proposal: proposal({ projectId: "project-2" }) },
    )
    expect(other.record.id).not.toBe(first.record.id)
  })

  it("enforces durable caller ownership and project scope", () => {
    const created = service.propose(agent, {
      idempotencyKey: "owned",
      proposal: proposal(),
    }).record
    expect(() =>
      service.propose(agent, {
        idempotencyKey: "escape",
        proposal: proposal({ projectId: "project-2" }),
      }),
    ).toThrowError(expect.objectContaining({ code: "out-of-scope" }))
    expect(() => service.read({ type: "agent", chatId: "other-caller" }, created.id)).toThrowError(
      expect.objectContaining({ code: "out-of-scope" }),
    )

    sqlite.prepare("UPDATE agent_runs SET status = 'success' WHERE id = 'caller-run'").run()
    expect(() => service.read(agent, created.id)).toThrowError(
      expect.objectContaining({ code: "stale-caller" }),
    )
  })

  it("updates exact pending versions and makes cancellation terminal and idempotent", () => {
    const record = service.propose(agent, {
      idempotencyKey: "lifecycle",
      proposal: proposal(),
    }).record
    const updated = service.update(agent, {
      proposalId: record.id,
      expectedVersion: 1,
      proposal: proposal({ name: "Reviewed API" }),
    })
    expect(updated).toMatchObject({ changed: true, record: { name: "Reviewed API", version: 2 } })
    expect(() =>
      service.update(agent, {
        proposalId: record.id,
        expectedVersion: 1,
        proposal: proposal({ name: "Stale" }),
      }),
    ).toThrowError(expect.objectContaining({ code: "conflict" }))

    const cancelled = service.cancel(agent, { proposalId: record.id, expectedVersion: 2 })
    expect(cancelled).toMatchObject({
      changed: true,
      record: { status: "cancelled", version: 3, archivedAt: now },
    })
    expect(service.cancel(agent, { proposalId: record.id, expectedVersion: 2 })).toMatchObject({
      changed: false,
      record: { status: "cancelled", version: 3 },
    })
    expect(() =>
      service.update(agent, {
        proposalId: record.id,
        expectedVersion: 3,
        proposal: proposal(),
      }),
    ).toThrowError(expect.objectContaining({ code: "conflict" }))
  })

  it("approves exact reviewed task/chat state once, archives evidence, audits, and launches no run", () => {
    const proposalRecord = service.propose(agent, {
      idempotencyKey: "approve",
      proposal: proposal({ targetStatus: "planned" }),
    }).record
    const preview = service.preview(user, proposalRecord.id)
    expect(preview).toMatchObject({
      proposal: { id: proposalRecord.id, status: "pending" },
      review: {
        taskName: "Review API",
        status: "planned",
        permissionMode: "ask-before-edits",
        worktreeMode: "task-primary",
      },
    })

    const approved = service.approve(user, {
      proposalId: proposalRecord.id,
      expectedVersion: 1,
      review: {
        ...preview.review,
        taskName: "Exact reviewed task",
        taskDescription: "Exact reviewed body",
        seedText: "Exact reviewed seed",
      },
    })
    expect(approved.item).toMatchObject({
      created: true,
      proposal: { status: "approved", version: 2, archivedAt: now },
      task: {
        name: "Exact reviewed task",
        description: "Exact reviewed body",
        status: "planned",
      },
      chat: {
        name: "Exact reviewed task",
        scope: "task",
        mcp_exposure_enabled: 1,
      },
    })
    expect(JSON.parse(String(approved.item.subChat.messages))[0].parts[0].text).toBe(
      "Exact reviewed seed",
    )
    expect(
      sqlite
        .prepare("SELECT count(*) count FROM agent_runs WHERE chat_id = ?")
        .get(approved.item.chat.id),
    ).toEqual({ count: 0 })

    sqlite
      .prepare("UPDATE chats SET mcp_exposure_enabled = 0 WHERE id = ?")
      .run(approved.item.chat.id)
    const replay = service.approve(user, {
      proposalId: proposalRecord.id,
      expectedVersion: 1,
      review: {
        ...preview.review,
        taskName: "Exact reviewed task",
        taskDescription: "Exact reviewed body",
        seedText: "Exact reviewed seed",
      },
    })
    expect(replay.item.created).toBe(false)
    expect(
      sqlite
        .prepare("SELECT mcp_exposure_enabled FROM chats WHERE id = ?")
        .get(approved.item.chat.id),
    ).toEqual({ mcp_exposure_enabled: 0 })
    expect(count("tasks")).toBe(2)
    expect(count("chats")).toBe(3)
    expect(
      sqlite
        .prepare(
          "SELECT count(*) count FROM mcp_audit_records WHERE tool_name = 'approve_task_proposal' AND status = 'completed'",
        )
        .get(),
    ).toEqual({ count: 2 })
  })

  it("denies and archives terminally with audit and no task/chat creation", () => {
    const record = service.propose(agent, {
      idempotencyKey: "deny",
      proposal: proposal(),
    }).record
    expect(service.deny(user, { proposalId: record.id, expectedVersion: 1 })).toMatchObject({
      changed: true,
      record: { status: "denied", version: 2, archivedAt: now },
    })
    expect(service.list(user).items).toEqual([])
    expect(service.list(user, { includeArchived: true }).items).toHaveLength(1)
    expect(() => service.preview(user, record.id)).toThrowError(
      expect.objectContaining({ code: "conflict" }),
    )
    expect(count("tasks")).toBe(1)
    expect(count("chats")).toBe(2)
    expect(
      sqlite
        .prepare(
          "SELECT status FROM mcp_audit_records WHERE tool_name = 'deny_task_proposal' ORDER BY created_at DESC LIMIT 1",
        )
        .get(),
    ).toEqual({ status: "denied" })
  })

  it("approves a bounded batch atomically and rejects overflow without partial state", () => {
    const records = ["batch-a", "batch-b"].map((key, index) => {
      now += 1
      return service.propose(agent, {
        idempotencyKey: key,
        proposal: proposal({ name: `Batch ${index}` }),
      }).record
    })
    const approvals = records.map((record) => {
      const preview = service.preview(user, record.id)
      return { proposalId: record.id, expectedVersion: record.version, review: preview.review }
    })
    expect(service.approveBatch(user, { approvals })).toMatchObject({
      createdCount: 2,
      items: [{ proposal: { status: "approved" } }, { proposal: { status: "approved" } }],
    })
    expect(count("tasks")).toBe(3)
    expect(count("chats")).toBe(4)

    expect(() =>
      service.approveBatch(user, {
        approvals: Array.from({ length: AI_TASK_PROPOSAL_BATCH_CAP + 1 }, (_, index) => ({
          ...approvals[0]!,
          proposalId: `overflow-${index}`,
        })),
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-input" }))
    expect(count("tasks")).toBe(3)
  })

  it("fails approval closed when caller, target, or proposal version goes stale", () => {
    const callerStale = service.propose(agent, {
      idempotencyKey: "caller-stale",
      proposal: proposal(),
    }).record
    const callerPreview = service.preview(user, callerStale.id)
    sqlite.prepare("UPDATE chats SET archived_at = ? WHERE id = 'caller'").run(now)
    expect(() =>
      service.approve(user, {
        proposalId: callerStale.id,
        expectedVersion: 1,
        review: callerPreview.review,
      }),
    ).toThrowError(expect.objectContaining({ code: "stale-caller" }))
    sqlite.prepare("UPDATE chats SET archived_at = NULL WHERE id = 'caller'").run()

    const targetStale = service.propose(agent, {
      idempotencyKey: "target-stale",
      proposal: proposal(),
    }).record
    const targetPreview = service.preview(user, targetStale.id)
    sqlite.prepare("UPDATE projects SET archived_at = ? WHERE id = 'project-1'").run(now)
    expect(() =>
      service.approve(user, {
        proposalId: targetStale.id,
        expectedVersion: 1,
        review: targetPreview.review,
      }),
    ).toThrowError(expect.objectContaining({ code: "stale-target" }))
    sqlite.prepare("UPDATE projects SET archived_at = NULL WHERE id = 'project-1'").run()

    service.update(agent, {
      proposalId: targetStale.id,
      expectedVersion: 1,
      proposal: proposal({ name: "Changed" }),
    })
    expect(() =>
      service.approve(user, {
        proposalId: targetStale.id,
        expectedVersion: 1,
        review: targetPreview.review,
      }),
    ).toThrowError(expect.objectContaining({ code: "conflict" }))
    expect(count("tasks")).toBe(1)
  })

  it("enforces proposal rate limits before any extra durable state appears", () => {
    for (let index = 0; index < AI_TASK_PROPOSAL_RATE_CAP; index += 1) {
      service.propose(agent, {
        idempotencyKey: `rate-${index}`,
        proposal: proposal({ name: `Rate ${index}` }),
      })
    }
    expect(() =>
      service.propose(agent, {
        idempotencyKey: "rate-overflow",
        proposal: proposal({ name: "Overflow" }),
      }),
    ).toThrowError(expect.objectContaining({ code: "conflict" }))
    expect(count("task_proposals")).toBe(AI_TASK_PROPOSAL_RATE_CAP)
    expect(count("tasks")).toBe(1)
    expect(count("chats")).toBe(2)
  })

  it("caps total pending proposals even when the rate window rolls forward", () => {
    for (let index = 0; index < AI_TASK_PROPOSAL_PENDING_CAP; index += 1) {
      now += 60_001
      service.propose(agent, {
        idempotencyKey: `pending-${index}`,
        proposal: proposal({ name: `Pending ${index}` }),
      })
    }
    now += 60_001
    expect(() =>
      service.propose(agent, {
        idempotencyKey: "pending-overflow",
        proposal: proposal({ name: "Pending overflow" }),
      }),
    ).toThrowError(expect.objectContaining({ code: "conflict" }))
    expect(count("task_proposals")).toBe(AI_TASK_PROPOSAL_PENDING_CAP)
  })

  it("exposes proposal tray data and exact review actions through local tRPC", async () => {
    const record = service.propose(agent, {
      idempotencyKey: "trpc",
      proposal: proposal(),
    }).record
    const api = taskProposalsRouter.createCaller({ getWindow: () => null })
    await expect(api.list({ limit: 20, includeArchived: false })).resolves.toMatchObject({
      items: [{ id: record.id, status: "pending" }],
    })
    const preview = await api.preview({ proposalId: record.id })
    await expect(
      api.approve({ proposalId: record.id, expectedVersion: 1, review: preview.review }),
    ).resolves.toMatchObject({ item: { created: true, proposal: { status: "approved" } } })
  })
})

function proposal(overrides: Partial<TaskProposalContent> = {}): TaskProposalContent {
  return {
    projectId: "project-1",
    name: "Review API",
    description: "Check exact approval behavior.",
    targetStatus: "backlog",
    source: null,
    ...overrides,
  }
}

function auditWriter() {
  return {
    append: (record: Parameters<typeof appendMcpAuditRecord>[1]) =>
      appendMcpAuditRecord(database, record),
  }
}

function responseRecord(response: Awaited<ReturnType<typeof invokeMcpControlTool>>) {
  if (!response.ok) throw new TaskProposalError("not-found", "Expected proposal response.")
  return (response.data as { record: { id: string } }).record
}

function count(table: "tasks" | "chats" | "agent_runs" | "task_proposals"): number {
  return Number(
    (sqlite.prepare(`SELECT count(*) count FROM ${table}`).get() as { count: number }).count,
  )
}
