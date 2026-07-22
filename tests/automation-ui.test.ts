import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AutomationControlRecord } from "../src/main/lib/automation/control-service"
import { AutomationUiService } from "../src/main/lib/automation/ui-service"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"
import {
  AUTOMATION_A11Y,
  automationUiReducer,
  createDefaultAutomationDraft,
  filterAutomationRecords,
  initialAutomationUiState,
  previewLifecycle,
  previewUpdate,
} from "../src/renderer/features/automations/automation-ui-model"
import {
  collectNewAutomationInboxNotifications,
  moveAutomationInboxFocus,
} from "../src/renderer/features/automations/inbox-state"

const directories: string[] = []
const databases: Database.Database[] = []

afterEach(() => {
  for (const database of databases.splice(0)) if (database.open) database.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("automation UI reducer and selectors", () => {
  it("keeps exact mutation preview, saving, success, and error states honest", () => {
    const preview = previewLifecycle({ action: "enable", record: record() })
    const pending = automationUiReducer(initialAutomationUiState, { type: "preview", preview })
    expect(pending.pendingMutation).toEqual(preview)
    expect(pending.pendingMutation?.rows).toContainEqual({
      field: "Enabled",
      before: "false",
      after: "true",
    })
    expect(automationUiReducer(pending, { type: "submit" })).toMatchObject({
      status: "saving",
      pendingMutation: preview,
    })
    expect(automationUiReducer(pending, { type: "error", message: "stale version" })).toEqual({
      status: "error",
      message: "stale version",
      pendingMutation: null,
    })
    expect(automationUiReducer(pending, { type: "success", message: "paused" })).toEqual({
      status: "success",
      message: "paused",
      pendingMutation: null,
    })
  })

  it("filters local records by visible content and honest state", () => {
    const active = record({ id: "active", name: "Nightly review", state: "active", enabled: true })
    const denied = record({ id: "denied", name: "Unsafe sweep", approval: "denied" })
    expect(
      filterAutomationRecords([active, denied], { query: "codex", state: "all" }),
    ).toHaveLength(2)
    expect(
      filterAutomationRecords([active, denied], { query: "nightly", state: "active" }),
    ).toEqual([active])
    expect(filterAutomationRecords([active, denied], { state: "error" })).toEqual([denied])
  })

  it("previews every changed authority and budget value before update", () => {
    const current = record()
    const next = {
      ...current.draft,
      run: { ...current.draft.run, permissionMode: "full-access" as const },
      budget: { ...current.draft.budget, maxTotalTokens: 20_000 },
    }
    const preview = previewUpdate(current, next, {
      classification: "expansion",
      authorityExpansion: true,
      authorityReduction: false,
      budgetExpansion: true,
      budgetReduction: false,
      requiresApproval: true,
      changedFields: ["run.permissionMode", "budget.maxTotalTokens"],
    })
    expect(preview.requiresApproval).toBe(true)
    expect(preview.consequence).toContain("disabled approval state")
    expect(preview.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "run.permissionMode (classified impact)",
          before: "read-only",
          after: "full-access",
        }),
        expect.objectContaining({
          field: "budget.maxTotalTokens (classified impact)",
          before: "unlimited",
          after: "20000 tokens",
        }),
      ]),
    )
  })
})

describe("automation accessibility contract", () => {
  it("names list, editor, preview, history, inbox, search, and unread controls", () => {
    expect(Object.values(AUTOMATION_A11Y)).toEqual([
      "Local automations",
      "Search local automations",
      "Local automation list",
      "Automation editor",
      "Exact mutation preview",
      "Automation execution history",
      "Automation inbox",
      "Show unread automation inbox items only",
    ])
    expect(new Set(Object.values(AUTOMATION_A11Y)).size).toBe(Object.keys(AUTOMATION_A11Y).length)
  })

  it("moves DOM focus with arrow-key inbox selection", () => {
    const firstFocus = vi.fn()
    const secondFocus = vi.fn()
    const elements = new Map([
      ["first", { focus: firstFocus }],
      ["second", { focus: secondFocus }],
    ])

    expect(
      moveAutomationInboxFocus({
        direction: "next",
        currentIndex: 0,
        itemIds: ["first", "second"],
        elements,
      }),
    ).toBe(1)
    expect(secondFocus).toHaveBeenCalledOnce()
    expect(firstFocus).not.toHaveBeenCalled()
  })
})

describe("automation inbox notifications", () => {
  const item = (id: string, unread = true) => ({
    id,
    unread,
    title: id,
    body: null,
    automationName: "Review",
    kind: "completed",
    chatId: "chat-1",
  })

  it("seeds existing inbox items, then emits only new unread results", () => {
    const initial = collectNewAutomationInboxNotifications([item("existing")], null)
    expect(initial.notifications).toEqual([])

    const update = collectNewAutomationInboxNotifications(
      [item("new"), item("read", false), item("existing")],
      initial.currentIds,
    )
    expect(update.notifications.map((entry) => entry.id)).toEqual(["new"])
  })
})

describe("automation renderer service", () => {
  it("returns durable run evidence and manages unread state without deleting evidence", () => {
    const fixture = database()
    seed(fixture.sqlite)
    const service = new AutomationUiService(fixture.path, () => 9_000)

    expect(service.listHistory("automation-1")).toEqual([
      expect.objectContaining({
        executionId: "execution-1",
        occurrenceId: "occurrence-1",
        automationId: "automation-1",
        state: "succeeded",
        triggerType: "manual",
        runId: "run-1",
        chatId: "chat-1",
        taskId: "task-1",
        projectId: "project-1",
        authoritySnapshot: { permissionMode: "read-only" },
        budgetSnapshot: expect.objectContaining({ maxConcurrentRuns: 1 }),
      }),
    ])

    expect(service.listInbox()).toMatchObject({
      unreadCount: 1,
      items: [
        expect.objectContaining({
          id: "inbox-1",
          unread: true,
          runId: "run-1",
          chatId: "chat-1",
          taskId: "task-1",
          projectId: "project-1",
        }),
      ],
    })
    expect(service.markInboxRead(["inbox-1", "inbox-1"], false)).toEqual({ changed: 1 })
    expect(service.listInbox()).toMatchObject({
      unreadCount: 0,
      items: [expect.objectContaining({ unread: false, readAt: 9_000 })],
    })
    expect(service.listHistory("automation-1")).toHaveLength(1)
    expect(service.manualTriggerId("automation-1")).toBe("trigger-1")
    expect(() => service.assertOccurrenceOwner("other", "occurrence-1")).toThrow("not found")
  })
})

function record(
  input: {
    id?: string
    name?: string
    state?: AutomationControlRecord["state"]
    enabled?: boolean
    approval?: AutomationControlRecord["approval"]["state"]
  } = {},
): AutomationControlRecord {
  const draft = createDefaultAutomationDraft()
  draft.name = input.name ?? "Review"
  draft.run.prompt = "Review this target"
  draft.run.permissionMode = "read-only"
  return {
    id: input.id ?? "automation-1",
    draft,
    state: input.state ?? "paused",
    enabled: input.enabled ?? false,
    approval: {
      state: input.approval ?? "approved",
      approvedBy: "local-user",
      approvedAt: 1,
      auditId: "audit-1",
    },
    creator: { type: "user", chatId: null },
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
  }
}

function database(): { path: string; sqlite: Database.Database } {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-automation-ui-"))
  directories.push(directory)
  const path = join(directory, "agents.db")
  const sqlite = new Database(path)
  databases.push(sqlite)
  migrateDatabase(drizzle(sqlite, { schema }), sqlite, resolve(process.cwd(), "drizzle"))
  return { path, sqlite }
}

function seed(sqlite: Database.Database): void {
  sqlite
    .prepare(
      "INSERT INTO projects (id, name, path) VALUES ('project-1', 'Project', '/tmp/project')",
    )
    .run()
  sqlite
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES ('task-1', 'project-1', 'Task')")
    .run()
  sqlite
    .prepare(
      "INSERT INTO chats (id, name, scope, project_id, task_id, permission_mode) VALUES ('chat-1', 'Chat', 'task', 'project-1', 'task-1', 'read-only')",
    )
    .run()
  sqlite
    .prepare(
      "INSERT INTO agent_runs (id, chat_id, harness, permission_mode, status, started_at, completed_at) VALUES ('run-1', 'chat-1', 'codex', 'read-only', 'success', 1000, 2000)",
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO automations (id, name, scope_type, task_id, action_type, action_config, prompt, harness, permission_mode, state, enabled, approval_state, approved_by, approved_at, approval_audit_id, created_at, updated_at) VALUES ('automation-1', 'Review', 'task', 'task-1', 'create-chat-run', '{"type":"create-chat-run"}', 'Review', 'codex', 'read-only', 'active', 1, 'approved', 'local-user', 1, 'audit-1', 1, 1)`,
    )
    .run()
  sqlite
    .prepare(
      "INSERT INTO automation_triggers (id, automation_id, type, created_at, updated_at) VALUES ('trigger-1', 'automation-1', 'manual', 1, 1)",
    )
    .run()
  sqlite
    .prepare("INSERT INTO automation_retry_policies (automation_id) VALUES ('automation-1')")
    .run()
  sqlite
    .prepare(
      "INSERT INTO automation_budgets (automation_id, max_duration_ms, max_concurrent_runs) VALUES ('automation-1', 60000, 1)",
    )
    .run()
  sqlite
    .prepare(
      "INSERT INTO automation_occurrences (id, automation_id, trigger_id, dedupe_key, state, scheduled_for, payload, created_at, terminal_at) VALUES ('occurrence-1', 'automation-1', 'trigger-1', 'manual:1', 'completed', 1000, '{}', 1000, 2000)",
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO automation_executions (id, occurrence_id, attempt, state, run_id, authority_snapshot, budget_snapshot, result_summary, created_at, started_at, completed_at) VALUES ('execution-1', 'occurrence-1', 1, 'succeeded', 'run-1', '{"permissionMode":"read-only"}', '{"maxDurationMs":60000,"maxTotalTokens":null,"maxCostUsdMicros":null,"maxConcurrentRuns":1}', '{"outcome":"succeeded"}', 1000, 1000, 2000)`,
    )
    .run()
  sqlite
    .prepare(
      "INSERT INTO automation_inbox_items (id, automation_id, occurrence_id, execution_id, kind, title, body, unread, created_at) VALUES ('inbox-1', 'automation-1', 'occurrence-1', 'execution-1', 'completed', 'Done', 'Review finished', 1, 2000)",
    )
    .run()
}
