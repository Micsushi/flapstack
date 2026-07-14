import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import {
  AutomationControlError,
  AutomationControlService,
  classifyAutomationImpact,
} from "../src/main/lib/automation/control-service"
import { createMcpAutomationService } from "../src/main/lib/mcp-control/automation-service"
import { McpApprovalLifecycle } from "../src/main/lib/mcp-control/approval-lifecycle"
import {
  appendMcpAuditRecord,
  listMcpDispatchRecoveryClaims,
  recoverMcpDispatchClaims,
} from "../src/main/lib/mcp-control/audit-storage"
import { getMcpControlTool, invokeMcpControlTool } from "../src/main/lib/mcp-control/registry"
import { automationsRouter } from "../src/main/lib/trpc/routers/automations"
import type { AutomationDraft } from "../src/shared/automation"

let directory = ""
let databasePath = ""
let sqlite: Database.Database
let database: ReturnType<typeof drizzle<typeof schema>>
let service: AutomationControlService

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-automation-control-"))
  databasePath = join(directory, "agents.db")
  sqlite = new Database(databasePath)
  sqlite.pragma("foreign_keys = ON")
  database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'One', '/tmp/one')")
    .run()
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES ('project-2', 'Two', '/tmp/two')")
    .run()
  sqlite
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES ('task-1', 'project-1', 'Task')")
    .run()
  sqlite
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES ('task-2', 'project-2', 'Other')")
    .run()
  sqlite
    .prepare(
      `INSERT INTO chats (id, name, scope, project_id, task_id, permission_mode)
       VALUES ('caller', 'Caller', 'task', 'project-1', 'task-1', 'full-access')`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO chats (id, name, scope, project_id, task_id, permission_mode)
       VALUES ('target', 'Target', 'task', 'project-1', 'task-1', 'full-access')`,
    )
    .run()
  service = new AutomationControlService(databasePath)
  process.env.FLAPSTACK_DB_PATH = databasePath
})

afterEach(() => {
  vi.useRealTimers()
  sqlite.close()
  delete process.env.FLAPSTACK_DB_PATH
  rmSync(directory, { recursive: true, force: true })
})

describe("automation CRUD control", () => {
  it("exposes the scoped CRUD, impact, review, and lifecycle service through local tRPC", async () => {
    const api = automationsRouter.createCaller({ getWindow: () => null })
    const created = await api.createDraft({ draft: taskDraft(), idempotencyKey: "local-create" })
    await expect(api.get({ automationId: created.record.id })).resolves.toMatchObject({
      id: created.record.id,
      enabled: false,
    })
    await expect(api.list({ limit: 20, includeArchived: false })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: created.record.id })],
    })
    await expect(
      api.classifyImpact({
        automationId: created.record.id,
        draft: taskDraft({ permissionMode: "full-access" }),
      }),
    ).resolves.toMatchObject({ authorityExpansion: true, requiresApproval: true })
    await expect(
      api.reviewDraft({
        automationId: created.record.id,
        expectedVersion: 1,
        decision: "deny",
        enable: false,
      }),
    ).resolves.toMatchObject({
      changed: true,
      record: { enabled: false, approval: { state: "denied" } },
    })
  })

  it("creates inert drafts and applies review, enable, disable, and archive with exact versions", () => {
    const created = service.createDraft(user, { draft: taskDraft() })
    expect(created).toMatchObject({
      created: true,
      record: { version: 1, state: "draft", enabled: false, approval: { state: "pending" } },
    })
    expect(service.list(user).items).toHaveLength(1)
    expect(service.read(user, created.record.id).draft.run.prompt).toBe("Review the task.")

    const reviewed = service.reviewDraft(user, {
      automationId: created.record.id,
      expectedVersion: 1,
      decision: "approve",
      enable: true,
      approval: approval("review-1"),
    })
    expect(reviewed.record).toMatchObject({
      version: 2,
      state: "active",
      enabled: true,
      approval: { state: "approved", auditId: "review-1" },
    })
    expect(
      service.reviewDraft(user, {
        automationId: created.record.id,
        expectedVersion: 1,
        decision: "approve",
        enable: true,
        approval: approval("ignored-replay"),
      }),
    ).toMatchObject({ changed: false, record: { version: 2 } })

    expect(
      service.setEnabled(user, {
        automationId: created.record.id,
        expectedVersion: 2,
        enabled: false,
      }),
    ).toMatchObject({ changed: true, record: { version: 3, state: "paused", enabled: false } })
    expect(
      service.archive(user, {
        automationId: created.record.id,
        expectedVersion: 3,
        auditId: "archive-1",
      }),
    ).toMatchObject({ changed: true, record: { version: 4, state: "archived" } })
    expect(service.list(user).items).toHaveLength(0)
    expect(service.list(user, { includeArchived: true }).items).toHaveLength(1)
  })

  it("binds create idempotency to the exact caller and payload", () => {
    const actor = { type: "agent" as const, chatId: "caller", runId: "run-1" }
    const first = service.createDraft(actor, {
      idempotencyKey: "daily-review",
      draft: taskDraft(),
    })
    const replay = service.createDraft(actor, {
      idempotencyKey: "daily-review",
      draft: taskDraft(),
    })
    expect(replay).toMatchObject({ created: false, record: { id: first.record.id, version: 1 } })
    expect(() =>
      service.createDraft(actor, {
        idempotencyKey: "daily-review",
        draft: taskDraft({ prompt: "Different payload." }),
      }),
    ).toThrowError(expect.objectContaining({ code: "conflict" }))

    const otherRun = service.createDraft(
      { type: "agent", chatId: "caller", runId: "run-2" },
      { idempotencyKey: "daily-review", draft: taskDraft() },
    )
    expect(otherRun.record.id).not.toBe(first.record.id)
    expect(first.record).toMatchObject({
      creator: { type: "agent", chatId: "caller" },
      enabled: false,
    })
  })

  it("limits agent list, read, create, and update to durable caller scope", () => {
    const actor = { type: "agent" as const, chatId: "caller" }
    const own = service.createDraft(actor, {
      idempotencyKey: "own",
      draft: taskDraft(),
    }).record
    const outside = service.createDraft(user, {
      draft: projectDraft("project-2"),
    }).record
    expect(service.list(actor).items.map((record) => record.id)).toEqual([own.id])
    expect(() => service.read(actor, outside.id)).toThrowError(
      expect.objectContaining({ code: "out-of-scope" }),
    )
    expect(() =>
      service.createDraft(actor, {
        idempotencyKey: "escape",
        draft: projectDraft("project-2"),
      }),
    ).toThrowError(expect.objectContaining({ code: "out-of-scope" }))
  })

  it("classifies authority and budget expansion and disables unapproved expanded state", () => {
    const original = taskDraft({ maxTotalTokens: 100 })
    const expanded = taskDraft({ permissionMode: "full-access", maxTotalTokens: 200 })
    expect(classifyAutomationImpact(original, expanded)).toMatchObject({
      classification: "expansion",
      authorityExpansion: true,
      budgetExpansion: true,
      requiresApproval: true,
    })
    const created = service.createDraft(user, { draft: original }).record
    const active = service.reviewDraft(user, {
      automationId: created.id,
      expectedVersion: 1,
      decision: "approve",
      enable: true,
      approval: approval("initial"),
    }).record
    const pending = service.update(user, {
      automationId: active.id,
      expectedVersion: active.version,
      draft: expanded,
    })
    expect(pending).toMatchObject({
      changed: true,
      impact: { requiresApproval: true },
      record: { state: "draft", enabled: false, approval: { state: "pending" } },
    })
    expect(() =>
      service.setEnabled(user, {
        automationId: active.id,
        expectedVersion: pending.record.version,
        enabled: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "approval-required" }))
  })

  it("rejects stale conflicting updates but accepts an exact update replay", () => {
    const created = service.createDraft(user, { draft: taskDraft() }).record
    const next = taskDraft({ prompt: "Updated prompt." })
    const updated = service.update(user, {
      automationId: created.id,
      expectedVersion: 1,
      draft: next,
    })
    expect(updated.record.version).toBe(2)
    expect(
      service.update(user, {
        automationId: created.id,
        expectedVersion: 1,
        draft: next,
      }),
    ).toMatchObject({ changed: false, record: { version: 2 } })
    expect(() =>
      service.update(user, {
        automationId: created.id,
        expectedVersion: 1,
        draft: taskDraft({ prompt: "Conflicting stale prompt." }),
      }),
    ).toThrowError(expect.objectContaining({ code: "conflict" }))
  })

  it("does not overwrite trigger or budget children after losing the update CAS", () => {
    const created = service.createDraft(user, {
      draft: taskDraft({ maxTotalTokens: 100 }),
    }).record
    const racingService = new AutomationControlService(databasePath, {
      beforeUpdateCas: () => {
        sqlite.prepare("UPDATE automations SET version = version + 1 WHERE id = ?").run(created.id)
      },
    })
    const proposed: AutomationDraft = {
      ...taskDraft({ maxTotalTokens: 200 }),
      trigger: {
        type: "schedule",
        cron: "0 * * * *",
        timezone: "UTC",
        catchUp: "one",
      },
    }

    expect(() =>
      racingService.update(user, {
        automationId: created.id,
        expectedVersion: 1,
        draft: proposed,
      }),
    ).toThrowError(expect.objectContaining({ code: "conflict" }))
    expect(
      sqlite
        .prepare(
          `SELECT a.version, t.type trigger_type, b.max_total_tokens
           FROM automations a
           JOIN automation_triggers t ON t.automation_id = a.id
           JOIN automation_budgets b ON b.automation_id = a.id
           WHERE a.id = ?`,
        )
        .get(created.id),
    ).toEqual({ version: 2, trigger_type: "manual", max_total_tokens: 100 })
  })

  it("reports conflict instead of archive success after losing the archive CAS", () => {
    const created = service.createDraft(user, { draft: taskDraft() }).record
    const racingService = new AutomationControlService(databasePath, {
      beforeArchiveCas: () => {
        sqlite.prepare("UPDATE automations SET version = version + 1 WHERE id = ?").run(created.id)
      },
    })

    expect(() =>
      racingService.archive(user, {
        automationId: created.id,
        expectedVersion: 1,
        auditId: "lost-archive",
      }),
    ).toThrowError(expect.objectContaining({ code: "conflict" }))
    expect(
      sqlite
        .prepare(
          "SELECT version, state, enabled, approval_state, archived_at FROM automations WHERE id = ?",
        )
        .get(created.id),
    ).toEqual({
      version: 2,
      state: "draft",
      enabled: 0,
      approval_state: "pending",
      archived_at: null,
    })
  })
})

describe("automation MCP management", () => {
  const caller = { chatId: "caller", runId: "run-1", permissionMode: "full-access" as const }

  it("registers scoped reads, inert creation, and approval-gated update and enable tools", async () => {
    expect(getMcpControlTool("list_automations")).toMatchObject({ tier: 0, status: "implemented" })
    expect(getMcpControlTool("read_automation")).toMatchObject({ tier: 0, status: "implemented" })
    expect(getMcpControlTool("create_automation_draft")).toMatchObject({
      tier: 1,
      status: "implemented",
    })
    expect(getMcpControlTool("update_automation")).toMatchObject({ tier: 3 })
    expect(getMcpControlTool("enable_automation")).toMatchObject({ tier: 3 })

    const controls = createMcpAutomationService(databasePath)
    const created = await invokeMcpControlTool(
      "create_automation_draft",
      caller,
      { idempotencyKey: "mcp-create", draft: taskDraft() },
      undefined,
      { automationControls: controls, audit: auditWriter() },
    )
    expect(created).toMatchObject({
      ok: true,
      data: { created: true, record: { enabled: false, approval: { state: "pending" } } },
    })
    const automationId = responseRecordId(created)
    await expect(
      invokeMcpControlTool("read_automation", caller, { automationId }, undefined, {
        automationControls: controls,
        audit: auditWriter(),
      }),
    ).resolves.toMatchObject({ ok: true, data: { id: automationId, version: 1 } })
  })

  it("executes no update on deny or timeout, then revalidates and applies an approved exact version", async () => {
    const record = service.createDraft(
      { type: "agent", chatId: "caller", runId: "run-1" },
      { idempotencyKey: "approval-target", draft: taskDraft() },
    ).record
    const controls = createMcpAutomationService(databasePath)
    const approvals = new McpApprovalLifecycle()
    const denied = invokeMcpControlTool(
      "update_automation",
      caller,
      { automationId: record.id, expectedVersion: 1, draft: taskDraft({ prompt: "Denied." }) },
      undefined,
      {
        approvals,
        approvalId: () => "deny-update",
        invocationId: () => "deny-invocation",
        automationControls: controls,
        audit: auditWriter(),
      },
    )
    approvals.deny("deny-update")
    await expect(denied).resolves.toMatchObject({
      ok: false,
      error: { code: "approval-denied" },
    })
    expect(service.read(user, record.id).version).toBe(1)

    vi.useFakeTimers()
    const timedOut = invokeMcpControlTool(
      "update_automation",
      caller,
      { automationId: record.id, expectedVersion: 1, draft: taskDraft({ prompt: "Timeout." }) },
      undefined,
      {
        approvals,
        approvalId: () => "timeout-update",
        invocationId: () => "timeout-invocation",
        automationControls: controls,
        audit: auditWriter(),
      },
    )
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(timedOut).resolves.toMatchObject({
      ok: false,
      error: { code: "approval-timeout" },
    })
    expect(service.read(user, record.id).version).toBe(1)
    vi.useRealTimers()

    const approved = invokeMcpControlTool(
      "update_automation",
      caller,
      { automationId: record.id, expectedVersion: 1, draft: taskDraft({ prompt: "Approved." }) },
      undefined,
      {
        approvals,
        approvalId: () => "approve-update",
        invocationId: () => "approve-invocation",
        automationControls: controls,
        audit: auditWriter(),
      },
    )
    approvals.approve("approve-update")
    await expect(approved).resolves.toMatchObject({
      ok: true,
      data: { changed: true, record: { version: 2, enabled: false } },
    })

    const enabled = invokeMcpControlTool(
      "enable_automation",
      caller,
      { automationId: record.id, expectedVersion: 2, enabled: true },
      undefined,
      {
        approvals,
        approvalId: () => "approve-enable",
        invocationId: () => "enable-invocation",
        automationControls: controls,
        audit: auditWriter(),
      },
    )
    approvals.approve("approve-enable")
    await expect(enabled).resolves.toMatchObject({
      ok: true,
      data: { changed: true, record: { version: 3, state: "active", enabled: true } },
    })

    const disabled = invokeMcpControlTool(
      "enable_automation",
      caller,
      { automationId: record.id, expectedVersion: 3, enabled: false },
      undefined,
      {
        approvals,
        approvalId: () => "approve-disable",
        invocationId: () => "disable-invocation",
        automationControls: controls,
        audit: auditWriter(),
      },
    )
    approvals.approve("approve-disable")
    await expect(disabled).resolves.toMatchObject({
      ok: true,
      data: { changed: true, record: { version: 4, state: "paused", enabled: false } },
    })
    approvals.shutdown()
  })

  it("redacts prompt, names, paths, and idempotency material from every audit event", async () => {
    const secretPrompt = "TOP SECRET prompt body"
    const secretName = "TOP SECRET automation name"
    const secretKey = "TOP-SECRET-IDEMPOTENCY"
    const response = await invokeMcpControlTool(
      "create_automation_draft",
      caller,
      {
        idempotencyKey: secretKey,
        draft: taskDraft({ prompt: secretPrompt, name: secretName }),
      },
      undefined,
      {
        invocationId: () => "redaction-invocation",
        automationControls: createMcpAutomationService(databasePath),
        audit: auditWriter(),
      },
    )
    expect(response.ok).toBe(true)
    const rows = sqlite
      .prepare(
        "SELECT input_summary, result_summary FROM mcp_audit_records WHERE invocation_id = ?",
      )
      .all("redaction-invocation")
    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain(secretPrompt)
    expect(serialized).not.toContain(secretName)
    expect(serialized).not.toContain(secretKey)
    expect(serialized).toContain("sha256")
  })

  it("marks exact version and idempotency contracts safe for bounded audit recovery", () => {
    appendMcpAuditRecord(database, {
      invocationId: "create-recovery",
      status: "dispatch-started",
      caller,
      toolName: "create_automation_draft",
      tier: 1,
      input: { idempotencyKey: "safe-create", draft: taskDraft() },
      result: null,
    })
    appendMcpAuditRecord(database, {
      invocationId: "update-recovery",
      status: "dispatch-started",
      caller,
      toolName: "update_automation",
      tier: 3,
      input: { automationId: "automation-1", expectedVersion: 1, draft: taskDraft() },
      result: null,
    })

    expect(recoverMcpDispatchClaims(database, { staleAfterMs: 0 })).toBe(2)
    expect(listMcpDispatchRecoveryClaims(database)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ invocationId: "create-recovery", retrySafe: true }),
        expect.objectContaining({ invocationId: "update-recovery", retrySafe: true }),
      ]),
    )
  })
})

const user = { type: "user" as const, id: "local-user" }

function approval(auditId: string) {
  return { approvedBy: "local-user", auditId }
}

function taskDraft(
  options: {
    name?: string
    prompt?: string
    permissionMode?: "read-only" | "full-access"
    maxTotalTokens?: number | null
  } = {},
): AutomationDraft {
  return {
    name: options.name ?? "Task review",
    description: "Review safely.",
    scope: { type: "task", taskId: "task-1" },
    action: { type: "create-chat-run", chatName: "Review" },
    trigger: { type: "manual" },
    run: {
      prompt: options.prompt ?? "Review the task.",
      harness: "codex",
      permissionMode: options.permissionMode ?? "read-only",
      worktreeStrategy: "task-primary",
    },
    retry: {
      mode: "none",
      maxAttempts: 1,
      initialDelayMs: 0,
      maxDelayMs: 0,
      deadlineMs: 0,
    },
    budget: {
      maxDurationMs: 60_000,
      maxTotalTokens: options.maxTotalTokens ?? null,
      maxCostUsdMicros: null,
      maxConcurrentRuns: 1,
    },
  }
}

function projectDraft(projectId: string): AutomationDraft {
  return {
    ...taskDraft(),
    scope: { type: "project", projectId },
    action: { type: "create-task-run", taskName: "Automated task" },
    run: { ...taskDraft().run, worktreeStrategy: "inherit" },
  }
}

function auditWriter() {
  return {
    append: (record: Parameters<typeof appendMcpAuditRecord>[1]) =>
      appendMcpAuditRecord(database, record),
  }
}

function responseRecordId(response: Awaited<ReturnType<typeof invokeMcpControlTool>>): string {
  if (!response.ok) throw new AutomationControlError("not-found", "Expected record response.")
  return (response.data as { record: { id: string } }).record.id
}
