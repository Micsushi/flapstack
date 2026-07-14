import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import { listPlanSourceLinks } from "../src/main/lib/plan-kanban-consistency"
import { promotePlanCandidate } from "../src/main/lib/plan-task-promotion"
import { moveTaskKanbanCard } from "../src/main/lib/task-kanban"
import { TaskProposalError, TaskProposalService } from "../src/main/lib/task-proposals"
import type { ProjectPlanSnapshot } from "../src/shared/plan-sources"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function testDatabase(name: string) {
  const directory = mkdtempSync(join(tmpdir(), `flapstack-plan-consistency-${name}-`))
  directories.push(directory)
  const path = join(directory, "test.db")
  const sqlite = new Database(path)
  sqlite.pragma("foreign_keys = ON")
  const database = drizzle(sqlite, { schema })
  migrateDatabase(database, sqlite, resolve(process.cwd(), "drizzle"))
  sqlite
    .prepare(
      `INSERT INTO projects (id, name, path, default_permission_mode)
       VALUES ('project-1', 'Flapstack', '/projects/flapstack', 'ask-before-edits')`,
    )
    .run()
  return { database, path, sqlite }
}

function snapshot(
  sourceFingerprint = "source-v1",
  candidate: ProjectPlanSnapshot["sources"][number]["candidates"][number] | null = {
    id: "candidate-1",
    fingerprint: "candidate-v1",
    kind: "task",
    title: "Original plan title",
    body: "Original plan acceptance.",
    path: "openspec/changes/add-board/tasks.md",
    line: 10,
    depth: 1,
    parentId: null,
    completed: false,
  },
): ProjectPlanSnapshot {
  return {
    projectId: "project-1",
    rootPath: "/projects/flapstack",
    fingerprint: `project-${sourceFingerprint}`,
    limitations: [],
    sources: [
      {
        id: "source-1",
        type: "openspec",
        path: "openspec/changes/add-board",
        fingerprint: sourceFingerprint,
        status: "current",
        stale: false,
        candidates: candidate ? [candidate] : [],
        limitations: [],
        errors: [],
      },
    ],
  }
}

function insertProvenanceTask(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT INTO tasks (
         id, project_id, name, description, status, board_order, version,
         source_type, source_path, source_candidate_id, source_fingerprint
       ) VALUES (
         'task-1', 'project-1', 'Durable task title', 'Durable task acceptance.',
         'in-progress', 'a00000001', 3, 'openspec',
         'openspec/changes/add-board/tasks.md', 'candidate-1', 'source-v1'
       )`,
    )
    .run()
}

describe("plan and Kanban consistency", () => {
  it("reports source divergence without reverse-syncing durable task content", () => {
    const { database, sqlite } = testDatabase("divergence")
    try {
      insertProvenanceTask(sqlite)
      sqlite
        .prepare(
          `INSERT INTO task_proposals (
             id, project_id, proposed_by_chat_id, name, description, target_status, status,
             version, source_type, source_path, source_candidate_id, source_fingerprint
           ) VALUES (
             'proposal-1', 'project-1', 'caller-chat', 'Durable proposal title',
             'Durable proposal acceptance.', 'planned', 'pending', 2, 'openspec',
             'openspec/changes/add-board/tasks.md', 'candidate-1', 'source-v1'
           )`,
        )
        .run()
      const current = listPlanSourceLinks(database, snapshot())
      expect(current).toHaveLength(2)
      expect(current.find((link) => link.kind === "task")).toMatchObject({
        kind: "task",
        status: "current",
        diverged: false,
        entity: { id: "task-1", name: "Durable task title", version: 3 },
      })

      const changedCandidate = {
        ...snapshot().sources[0]!.candidates[0]!,
        fingerprint: "candidate-v2",
        title: "Later plan title",
        body: "Later plan acceptance.",
      }
      const changed = listPlanSourceLinks(database, snapshot("source-v2", changedCandidate))
      expect(changed.every((link) => link.status === "diverged")).toBe(true)
      const diverged = changed.find((link) => link.kind === "task")!
      expect(diverged).toMatchObject({
        status: "diverged",
        diverged: true,
        compare: {
          durableTitle: "Durable task title",
          currentSourceTitle: "Later plan title",
          contentDiffers: true,
        },
      })
      expect(
        sqlite.prepare("SELECT name, description, version FROM tasks WHERE id = 'task-1'").get(),
      ).toEqual({
        name: "Durable task title",
        description: "Durable task acceptance.",
        version: 3,
      })
      expect(listPlanSourceLinks(database, snapshot("source-v2", null))[0]?.status).toBe(
        "candidate-missing",
      )
    } finally {
      sqlite.close()
    }
  })

  it("rejects a stale second-window move after the first move rebalances the board", () => {
    const { database, sqlite } = testDatabase("move-race")
    try {
      for (const [id, status, order] of [
        ["moving", "backlog", "a0"],
        ["planned-a", "planned", "a00000001"],
        ["planned-b", "planned", "a00000002"],
      ]) {
        sqlite
          .prepare(
            `INSERT INTO tasks (id, project_id, name, status, board_order, version)
             VALUES (?, 'project-1', ?, ?, ?, 1)`,
          )
          .run(id, id, status, order)
      }

      moveTaskKanbanCard(database, {
        id: "moving",
        expectedVersion: 1,
        targetStatus: "planned",
        beforeTaskId: "planned-b",
      })
      expect(() =>
        moveTaskKanbanCard(database, {
          id: "planned-b",
          expectedVersion: 1,
          targetStatus: "review",
        }),
      ).toThrow("Board refreshed")
      expect(sqlite.prepare("SELECT id, status, version FROM tasks ORDER BY id").all()).toEqual([
        { id: "moving", status: "planned", version: 2 },
        { id: "planned-a", status: "planned", version: 2 },
        { id: "planned-b", status: "planned", version: 2 },
      ])
    } finally {
      sqlite.close()
    }
  })

  it("deduplicates a promotion race into one durable task and idle chat", () => {
    const { database, sqlite } = testDatabase("promotion-race")
    try {
      const reference = {
        sourceProjectId: "project-1",
        sourceId: "source-1",
        sourcePath: "openspec/changes/add-board",
        sourceFingerprint: "source-v1",
        candidateId: "candidate-1",
        candidateFingerprint: "candidate-v1",
      }
      const input = {
        reference,
        idempotencyKey: "window-a",
        targetProjectId: "project-1",
        taskName: "Durable promoted task",
        taskDescription: "One outcome.",
        status: "in-progress" as const,
        permissionMode: "ask-before-edits" as const,
        customPermissions: null,
        worktreeMode: "task-primary" as const,
        seedText: "Idle seed text.",
      }
      const first = promotePlanCandidate(database, snapshot(), input)
      const second = promotePlanCandidate(database, snapshot(), {
        ...input,
        idempotencyKey: "window-b",
      })
      expect([first.created, second.created].sort()).toEqual([false, true])
      expect(second.task.id).toBe(first.task.id)
      expect(sqlite.prepare("SELECT count(*) count FROM tasks").get()).toEqual({ count: 1 })
      expect(sqlite.prepare("SELECT count(*) count FROM chats").get()).toEqual({ count: 1 })
      expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })
    } finally {
      sqlite.close()
    }
  })

  it("lets one proposal decision win and rejects the stale competing decision", () => {
    const { path, sqlite } = testDatabase("proposal-race")
    try {
      sqlite
        .prepare(
          `INSERT INTO chats (id, name, project_id, scope, permission_mode)
           VALUES ('caller-chat', 'Caller', 'project-1', 'project', 'ask-before-edits')`,
        )
        .run()
      const service = new TaskProposalService(path, { now: () => 1000 })
      const created = service.propose(
        { type: "agent", chatId: "caller-chat" },
        {
          idempotencyKey: "proposal-race",
          proposal: {
            projectId: "project-1",
            name: "Proposal winner",
            description: "Only one decision persists.",
            targetStatus: "planned",
            source: {
              sourceType: "openspec",
              sourcePath: "openspec/changes/add-board/tasks.md",
              sourceCandidateId: "candidate-1",
              sourceFingerprint: "source-v1",
            },
          },
        },
      ).record
      const preview = service.preview({ type: "user", id: "local-user" }, created.id)
      service.approve(
        { type: "user", id: "local-user" },
        { proposalId: created.id, expectedVersion: 1, review: preview.review },
      )
      expect(() =>
        service.deny(
          { type: "user", id: "other-window" },
          { proposalId: created.id, expectedVersion: 1 },
        ),
      ).toThrowError(TaskProposalError)
      expect(service.read({ type: "user", id: "local-user" }, created.id)).toMatchObject({
        status: "approved",
        version: 2,
      })
      expect(sqlite.prepare("SELECT count(*) count FROM tasks").get()).toEqual({ count: 1 })
      expect(
        sqlite.prepare("SELECT count(*) count FROM chats WHERE task_id IS NOT NULL").get(),
      ).toEqual({ count: 1 })
    } finally {
      sqlite.close()
    }
  })
})
