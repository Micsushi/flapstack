import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import {
  buildPlanTaskPromotionPreview,
  PlanTaskPromotionError,
  promotePlanCandidate,
} from "../src/main/lib/plan-task-promotion"
import { disabledCustomPermissions } from "../src/shared/permission-capabilities"
import type { ProjectPlanSnapshot } from "../src/shared/plan-sources"
import type {
  PlanCandidateReference,
  PlanTaskPromotionConfirmInput,
} from "../src/shared/plan-task-promotion"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function testDatabase(name: string) {
  const directory = mkdtempSync(join(tmpdir(), `flapstack-plan-promotion-${name}-`))
  temporaryDirectories.push(directory)
  const sqlite = new Database(join(directory, "test.db"))
  sqlite.pragma("foreign_keys = ON")
  const database = drizzle(sqlite, { schema })
  migrateDatabase(database, sqlite, resolve(process.cwd(), "drizzle"))
  sqlite
    .prepare(
      `INSERT INTO projects
         (id, name, path, default_permission_mode, default_custom_permissions,
          vault_context_sections)
       VALUES ('source-project', 'Source', '/projects/source', 'ask-before-edits', NULL, NULL),
              ('target-project', 'Target', '/projects/target', 'read-only', NULL,
               '["architecture"]')`,
    )
    .run()
  return { database, sqlite }
}

const reference: PlanCandidateReference = {
  sourceProjectId: "source-project",
  sourceId: "source-1",
  sourcePath: "openspec/changes/add-promotion",
  sourceFingerprint: "source-fingerprint",
  candidateId: "candidate-1",
  candidateFingerprint: "candidate-fingerprint",
}

function snapshot(overrides: Partial<ProjectPlanSnapshot["sources"][number]> = {}) {
  return {
    projectId: "source-project",
    rootPath: "/projects/source",
    fingerprint: "project-fingerprint",
    limitations: [],
    sources: [
      {
        id: "source-1",
        type: "openspec" as const,
        path: "openspec/changes/add-promotion",
        fingerprint: "source-fingerprint",
        status: "current" as const,
        stale: false,
        limitations: [],
        errors: [],
        candidates: [
          {
            id: "candidate-1",
            fingerprint: "candidate-fingerprint",
            kind: "task" as const,
            title: "S4-F9-T5 — Promote candidate",
            body: "Acceptance: create one task and one idle seeded chat.",
            path: "openspec/changes/add-promotion/tasks.md",
            line: 42,
            depth: 2,
            parentId: null,
            completed: false,
          },
        ],
        ...overrides,
      },
    ],
  } satisfies ProjectPlanSnapshot
}

function confirmInput(
  overrides: Partial<PlanTaskPromotionConfirmInput> = {},
): PlanTaskPromotionConfirmInput {
  return {
    reference,
    idempotencyKey: "promotion-request-1",
    targetProjectId: "target-project",
    taskName: "Promote candidate",
    taskDescription: "Create one pair.",
    status: "in-progress",
    permissionMode: "read-only",
    customPermissions: null,
    worktreeMode: "task-primary",
    seedText: "Candidate context\n\nAcceptance: exactly one idle chat and no run.",
    ...overrides,
  }
}

describe("plan task promotion", () => {
  it("returns a complete preview with copied project, permission, and deferred worktree defaults", () => {
    const { database, sqlite } = testDatabase("preview")
    try {
      const preview = buildPlanTaskPromotionPreview(database, snapshot(), {
        reference,
        targetProjectId: "target-project",
      })

      expect(preview).toMatchObject({
        project: { id: "target-project", name: "Target", path: "/projects/target" },
        task: { name: "S4-F9-T5 — Promote candidate", status: "in-progress" },
        permission: { mode: "read-only", customPermissions: null },
        worktree: { mode: "task-primary", path: null },
        source: {
          candidatePath: "openspec/changes/add-promotion/tasks.md",
          candidateLine: 42,
        },
      })
      expect(preview.chat.seedText).toContain("Plan context and acceptance")
      expect(preview.chat.seedText).toContain("create one task and one idle seeded chat")
    } finally {
      sqlite.close()
    }
  })

  it("deduplicates repeated confirms into one task, one chat, and one seeded sub-chat", () => {
    const { database, sqlite } = testDatabase("duplicate")
    try {
      const first = promotePlanCandidate(database, snapshot(), confirmInput())
      const duplicate = promotePlanCandidate(
        database,
        snapshot(),
        confirmInput({ idempotencyKey: "promotion-request-retry" }),
      )

      expect(first.created).toBe(true)
      expect(duplicate.created).toBe(false)
      expect(duplicate.task.id).toBe(first.task.id)
      expect(duplicate.chat.id).toBe(first.chat.id)
      expect(sqlite.prepare("SELECT count(*) AS count FROM tasks").get()).toEqual({ count: 1 })
      expect(sqlite.prepare("SELECT count(*) AS count FROM chats").get()).toEqual({ count: 1 })
      expect(sqlite.prepare("SELECT count(*) AS count FROM sub_chats").get()).toEqual({ count: 1 })
    } finally {
      sqlite.close()
    }
  })

  it("rejects stale source and candidate fingerprints before writing", () => {
    const { database, sqlite } = testDatabase("stale")
    try {
      expect(() =>
        promotePlanCandidate(
          database,
          snapshot({ fingerprint: "changed-source", status: "stale", stale: true }),
          confirmInput(),
        ),
      ).toThrowError(PlanTaskPromotionError)
      expect(() =>
        promotePlanCandidate(
          database,
          snapshot({
            candidates: [
              {
                ...snapshot().sources[0]!.candidates[0]!,
                fingerprint: "changed-candidate",
              },
            ],
          }),
          confirmInput(),
        ),
      ).toThrow("candidate changed")
      expect(sqlite.prepare("SELECT count(*) AS count FROM tasks").get()).toEqual({ count: 0 })
      expect(sqlite.prepare("SELECT count(*) AS count FROM chats").get()).toEqual({ count: 0 })
    } finally {
      sqlite.close()
    }
  })

  it("copies explicit permission and worktree choices while leaving the chat idle with no run", () => {
    const { database, sqlite } = testDatabase("defaults")
    try {
      const customPermissions = { ...disabledCustomPermissions, projectWrite: true }
      const result = promotePlanCandidate(
        database,
        snapshot(),
        confirmInput({
          permissionMode: "custom",
          customPermissions,
          worktreeMode: "project-checkout",
        }),
      )

      expect(result.task).toMatchObject({
        defaultPermissionMode: "custom",
        primaryWorktreePath: null,
        vaultContextSections: '["architecture"]',
      })
      expect(JSON.parse(result.task.defaultCustomPermissions!)).toEqual(customPermissions)
      expect(result.chat).toMatchObject({
        scope: "task",
        permissionMode: "custom",
        worktreePath: "/projects/target",
      })
      expect(result.subChat.runStatus).toBeNull()
      expect(JSON.parse(result.subChat.messages)).toEqual([
        expect.objectContaining({
          role: "user",
          parts: [{ type: "text", text: expect.stringContaining("Acceptance") }],
        }),
      ])
      expect(sqlite.prepare("SELECT count(*) AS count FROM agent_runs").get()).toEqual({ count: 0 })
    } finally {
      sqlite.close()
    }
  })

  it("rolls back task, chat, and seed state when the database faults", () => {
    const { database, sqlite } = testDatabase("rollback")
    try {
      sqlite
        .prepare(
          `CREATE TRIGGER reject_promoted_chat
             BEFORE INSERT ON chats
             WHEN NEW.id LIKE 'plan-chat-%'
             BEGIN SELECT RAISE(ABORT, 'injected chat insert fault'); END`,
        )
        .run()

      expect(() => promotePlanCandidate(database, snapshot(), confirmInput())).toThrow(
        "injected chat insert fault",
      )
      expect(sqlite.prepare("SELECT count(*) AS count FROM tasks").get()).toEqual({ count: 0 })
      expect(sqlite.prepare("SELECT count(*) AS count FROM chats").get()).toEqual({ count: 0 })
      expect(sqlite.prepare("SELECT count(*) AS count FROM sub_chats").get()).toEqual({ count: 0 })
      expect(sqlite.prepare("SELECT count(*) AS count FROM agent_runs").get()).toEqual({ count: 0 })
    } finally {
      sqlite.close()
    }
  })
})
