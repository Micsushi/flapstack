import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { and, eq } from "drizzle-orm"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { agentRuns, chats, projects, tasks } from "../src/main/lib/db/schema"
import {
  buildProjectVaultRunContext,
  persistProjectVaultContextManifest,
  ProjectVaultContextRejectedError,
  updateProjectVaultContextSelection,
  type ProjectVaultContextHarness,
} from "../src/main/lib/project-vaults/run-context"
import {
  scaffoldProjectVault,
  writeProjectVaultSection,
} from "../src/main/lib/project-vaults/storage"

type AppDatabase = ReturnType<typeof drizzle<typeof schema>>

describe("project vault run context", () => {
  let directory: string
  let appDataRoot: string
  let projectRoot: string
  let sqlite: Database.Database
  let database: AppDatabase

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "flapstack-vault-run-context-"))
    appDataRoot = join(directory, "app-data")
    projectRoot = join(directory, "project")
    mkdirSync(appDataRoot)
    mkdirSync(projectRoot)
    sqlite = new Database(join(directory, "agents.db"))
    sqlite.pragma("foreign_keys = ON")
    database = drizzle(sqlite, { schema })
    migrate(database, { migrationsFolder: resolve(process.cwd(), "drizzle") })
    database.insert(projects).values({ id: "project-1", name: "Project", path: projectRoot }).run()
    database.insert(tasks).values({ id: "task-1", projectId: "project-1", name: "Task" }).run()
    database
      .insert(chats)
      .values([
        { id: "project-chat", name: "Project chat", scope: "project", projectId: "project-1" },
        {
          id: "task-chat",
          name: "Task chat",
          scope: "task",
          projectId: "project-1",
          taskId: "task-1",
        },
      ])
      .run()
    await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["index", "handoff", "decisions", "context"],
    })
    await setSection("index", "PROJECT INDEX")
    await setSection("handoff", "TASK HANDOFF")
    await setSection("decisions", "HIDDEN MEMORY MUST NOT LOAD")
    await setSection("context", "RUN CONTEXT")
  })

  afterEach(() => {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it("uses fixed opt-in-none defaults and exact run > task > project precedence", async () => {
    const initial = await buildProjectVaultRunContext(database, {
      chatId: "project-chat",
      harness: "codex",
    })
    expect(initial).toMatchObject({
      context: "",
      manifest: {
        status: "empty",
        selectionSource: "fixed-default",
        selectedSectionIds: [],
      },
    })

    updateProjectVaultContextSelection(database, {
      projectId: "project-1",
      sectionIds: ["index"],
    })
    const project = await buildProjectVaultRunContext(database, {
      chatId: "project-chat",
      harness: "codex",
    })
    expect(project.manifest).toMatchObject({
      selectionSource: "project",
      selectedSectionIds: ["index"],
    })
    expect(project.context).toContain("PROJECT INDEX")
    expect(project.context).not.toContain("HIDDEN MEMORY")

    updateProjectVaultContextSelection(database, {
      projectId: "project-1",
      taskId: "task-1",
      sectionIds: ["handoff"],
    })
    const task = await buildProjectVaultRunContext(database, {
      chatId: "task-chat",
      harness: "claude-code",
    })
    expect(task.manifest).toMatchObject({
      selectionSource: "task",
      selectedSectionIds: ["handoff"],
    })
    expect(task.context).toContain("TASK HANDOFF")
    expect(task.context).not.toContain("PROJECT INDEX")

    insertRun("run-1", "task-chat", "codex", ["context"])
    const run = await buildProjectVaultRunContext(database, {
      chatId: "task-chat",
      runId: "run-1",
      harness: "codex",
    })
    expect(run.manifest).toMatchObject({
      selectionSource: "run",
      selectedSectionIds: ["context"],
    })
    expect(run.context).toContain("RUN CONTEXT")
    expect(run.context).not.toContain("TASK HANDOFF")
  })

  it("lets a task explicitly inherit the project selection", () => {
    updateProjectVaultContextSelection(database, {
      projectId: "project-1",
      sectionIds: ["index"],
    })
    updateProjectVaultContextSelection(database, {
      projectId: "project-1",
      taskId: "task-1",
      sectionIds: ["handoff"],
    })
    expect(
      updateProjectVaultContextSelection(database, {
        projectId: "project-1",
        taskId: "task-1",
        sectionIds: null,
      }),
    ).toMatchObject({
      taskSectionIds: null,
      effectiveSectionIds: ["index"],
      source: "project",
    })
  })

  it("truncates deterministically against byte and estimated-token budgets", async () => {
    await setSection("index", "😀".repeat(20) + "abcdefghij")
    const input = {
      chatId: "project-chat",
      harness: "codex" as const,
      runSectionIds: ["index"] as const,
      budget: { maxBytes: 20, maxEstimatedTokens: 3 },
    }
    const first = await buildProjectVaultRunContext(database, input)
    const second = await buildProjectVaultRunContext(database, input)

    expect(second).toEqual(first)
    expect(first.manifest.budget.includedBytes).toBeLessThanOrEqual(20)
    expect(first.manifest.budget.estimatedTokens).toBeLessThanOrEqual(3)
    expect(first.manifest.entries).toEqual([
      expect.objectContaining({ sectionId: "index", truncated: true }),
    ])
    expect(first.manifest.truncations).toEqual([
      expect.objectContaining({ sectionId: "index", reason: "byte-and-token-budget" }),
    ])
    expect(first.context).toContain("truncated by Flapstack vault context budget")
  })

  it("persists content provenance without storing selected content", async () => {
    insertRun("run-2", "project-chat", "claude-code")
    const bundle = await buildProjectVaultRunContext(database, {
      chatId: "project-chat",
      runId: "run-2",
      harness: "claude-code",
      runSectionIds: ["index"],
    })
    persistProjectVaultContextManifest(database, {
      runId: "run-2",
      manifest: bundle.manifest,
      runSectionIds: ["index"],
    })

    const stored = database
      .select({
        selection: agentRuns.vaultContextSections,
        manifest: agentRuns.vaultContextManifest,
      })
      .from(agentRuns)
      .where(eq(agentRuns.id, "run-2"))
      .get()
    expect(stored?.selection).toBe('["index"]')
    expect(JSON.parse(stored?.manifest ?? "{}")).toMatchObject({
      harness: "claude-code",
      selectionSource: "run",
      entries: [
        {
          sectionId: "index",
          sourcePath: "index.md",
          version: 2,
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          originalBytes: 13,
          includedBytes: 13,
          truncated: false,
        },
      ],
    })
    expect(stored?.manifest).not.toContain("PROJECT INDEX")
  })

  it("rejects secret-like selected content without exposing it in the report", async () => {
    const secret = "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456"
    await setSection("context", secret)

    const failure = await buildProjectVaultRunContext(database, {
      chatId: "project-chat",
      harness: "codex",
      runSectionIds: ["context"],
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ProjectVaultContextRejectedError)
    expect(failure.manifest).toMatchObject({
      status: "rejected",
      rejection: { sectionId: "context", reason: "secret-detected" },
      entries: [],
    })
    expect(JSON.stringify(failure.manifest)).not.toContain(secret)
  })

  it("rejects externally changed content instead of injecting stale provenance", async () => {
    const vault = database.select().from(schema.projectVaults).get()
    writeFileSync(join(vault!.rootPath, "index.md"), "outside edit")

    await expect(
      buildProjectVaultRunContext(database, {
        chatId: "project-chat",
        harness: "codex",
        runSectionIds: ["index"],
      }),
    ).rejects.toMatchObject({
      manifest: {
        status: "rejected",
        rejection: { sectionId: "index", reason: "content-changed" },
      },
    })
  })

  it.each<ProjectVaultContextHarness>(["codex", "claude-code"])(
    "builds the supported %s harness envelope with the same explicit selection",
    async (harness) => {
      const result = await buildProjectVaultRunContext(database, {
        chatId: "project-chat",
        harness,
        runSectionIds: ["index"],
      })
      expect(result.manifest.harness).toBe(harness)
      expect(result.manifest.selectedSectionIds).toEqual(["index"])
      expect(result.context).toContain("FLAPSTACK SELECTED PROJECT VAULT CONTEXT")
      expect(result.context).toContain("PROJECT INDEX")
    },
  )

  async function setSection(
    sectionId: "index" | "handoff" | "decisions" | "context",
    content: string,
  ) {
    const current = database
      .select()
      .from(schema.projectVaultSections)
      .where(
        and(
          eq(schema.projectVaultSections.projectId, "project-1"),
          eq(schema.projectVaultSections.sectionId, sectionId),
        ),
      )
      .get()
    await writeProjectVaultSection(database, {
      projectId: "project-1",
      sectionId,
      expectedVersion: current!.version,
      content,
    })
  }

  function insertRun(
    id: string,
    chatId: string,
    harness: ProjectVaultContextHarness,
    sectionIds?: string[],
  ) {
    database
      .insert(agentRuns)
      .values({
        id,
        chatId,
        harness,
        permissionMode: "read-only",
        vaultContextSections: sectionIds === undefined ? null : JSON.stringify(sectionIds),
      })
      .run()
  }
})
