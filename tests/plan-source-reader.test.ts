import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import {
  PlanSourcePathError,
  PlanSourceRefreshWatcher,
  readProjectPlanSources,
  validateMarkdownPlanSource,
  type PlanSourceWatchAdapter,
} from "../src/main/lib/plan-sources"

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/flapstack-plan-source-test", isPackaged: false },
}))

const directories: string[] = []

afterEach(async () => {
  const { closeDatabase } = await import("../src/main/lib/db")
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("plan source reader", () => {
  it("discovers OpenSpec proposal, requirements, scenarios, and tasks with stable identity", async () => {
    const root = projectRoot()
    writeOpenSpec(root, "add-reader", {
      proposal: `# Change: Add reader

## Why

Read local plans.
`,
      spec: `## ADDED Requirements

### Requirement: Safe plan reading

The app SHALL stay inside the project root.

#### Scenario: Relative source

- **WHEN** a source is selected
- **THEN** it is read safely
`,
      tasks: `# Tasks

### S4-F9-T2 — Implement reader

- [x] Completion: acceptance and verification passed
- Scope: Parse proposal and reject escapes.
`,
    })

    const first = await readProjectPlanSources({
      projectId: "project-1",
      rootPath: root,
      markdownPaths: [],
    })
    const second = await readProjectPlanSources({
      projectId: "project-1",
      rootPath: root,
      markdownPaths: [],
    })

    expect(first).toEqual(second)
    expect(first.sources).toHaveLength(1)
    const source = first.sources[0]!
    expect(source).toMatchObject({
      type: "openspec",
      path: "openspec/changes/add-reader",
      status: "current",
      stale: false,
      errors: [],
    })
    expect(source.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(source.candidates.map((candidate) => candidate.kind)).toEqual(
      expect.arrayContaining(["proposal", "requirement", "scenario", "task"]),
    )
    expect(source.candidates.find((candidate) => candidate.kind === "task")).toMatchObject({
      title: "S4-F9-T2 — Implement reader",
      body: "- Scope: Parse proposal and reject escapes.",
      completed: true,
    })
    expect(new Set(source.candidates.map((candidate) => candidate.id)).size).toBe(
      source.candidates.length,
    )
  })

  it("parses bounded Markdown headings and checklists while ignoring fenced examples", async () => {
    const root = projectRoot()
    const plan = "docs/plan.md"
    mkdirSync(join(root, "docs"))
    writeFileSync(
      join(root, plan),
      `# Release

## Build

- [ ] Compile app
- [x] Run headless checks

\`\`\`md
# Ignored sample
- [ ] Not a real task
\`\`\`
`,
    )

    const snapshot = await readProjectPlanSources({
      projectId: "project-1",
      rootPath: root,
      markdownPaths: [plan, plan],
    })
    const source = snapshot.sources[0]!

    expect(source.status).toBe("current")
    expect(source.limitations.join(" ")).toContain("ATX headings")
    expect(source.candidates.map((candidate) => candidate.title)).toEqual([
      "Release",
      "Build",
      "Compile app",
      "Run headless checks",
    ])
    expect(source.candidates[1]!.parentId).toBe(source.candidates[0]!.id)
    expect(source.candidates[2]!.parentId).toBe(source.candidates[1]!.id)
  })

  it("keeps structural IDs stable and marks a changed source stale", async () => {
    const root = projectRoot()
    mkdirSync(join(root, "docs"))
    const plan = join(root, "docs", "plan.md")
    writeFileSync(plan, "# Plan\n\n- [ ] Keep identity\n")

    const first = await readProjectPlanSources({
      projectId: "project-1",
      rootPath: root,
      markdownPaths: ["docs/plan.md"],
    })
    const prior = first.sources[0]!
    writeFileSync(plan, "# Plan\n\n- [x] Keep identity\n")
    const second = await readProjectPlanSources(
      { projectId: "project-1", rootPath: root, markdownPaths: ["docs/plan.md"] },
      { expectedFingerprints: { [prior.id]: prior.fingerprint } },
    )
    const changed = second.sources[0]!

    expect(changed).toMatchObject({ status: "stale", stale: true })
    expect(changed.fingerprint).not.toBe(prior.fingerprint)
    expect(changed.candidates.map((candidate) => candidate.id)).toEqual(
      prior.candidates.map((candidate) => candidate.id),
    )
    expect(changed.candidates[1]!.fingerprint).not.toBe(prior.candidates[1]!.fingerprint)
  })

  it("degrades malformed and missing sources into bounded parse errors", async () => {
    const root = projectRoot()
    writeOpenSpec(root, "malformed", {
      proposal: "No title\n",
      spec: "### Requirement: Missing scenario\n\nStill readable.\n",
      tasks: "# Tasks\n\nNo checklist.\n",
    })
    mkdirSync(join(root, "docs"))
    writeFileSync(join(root, "docs", "broken.md"), "# Broken\n\n```\nunclosed\n")

    const snapshot = await readProjectPlanSources({
      projectId: "project-1",
      rootPath: root,
      markdownPaths: ["docs/broken.md", "docs/missing.md"],
    })

    expect(snapshot.sources).toHaveLength(3)
    expect(snapshot.sources.every((source) => source.status === "malformed")).toBe(true)
    expect(snapshot.sources.flatMap((source) => source.errors).map((error) => error.code)).toEqual(
      expect.arrayContaining(["invalid-format", "missing"]),
    )
    expect(
      snapshot.sources
        .flatMap((source) => source.errors)
        .some((error) => error.message.includes("no scenario")),
    ).toBe(true)
  })

  it("rejects escaped and symlinked selected paths before reading", async () => {
    const root = projectRoot()
    const outside = projectRoot()
    writeFileSync(join(outside, "secret.md"), "secret")
    mkdirSync(join(root, "docs"))
    symlinkSync(join(outside, "secret.md"), join(root, "docs", "linked.md"))

    await expect(validateMarkdownPlanSource(root, "../secret.md")).rejects.toBeInstanceOf(
      PlanSourcePathError,
    )
    await expect(validateMarkdownPlanSource(root, join(outside, "secret.md"))).rejects.toThrow(
      "relative path",
    )
    await expect(validateMarkdownPlanSource(root, "docs/linked.md")).rejects.toThrow("real file")

    const snapshot = await readProjectPlanSources({
      projectId: "project-1",
      rootPath: root,
      markdownPaths: ["docs/linked.md"],
    })
    expect(snapshot.sources[0]).toMatchObject({ status: "malformed" })
    expect(snapshot.sources[0]!.errors[0]).toMatchObject({ code: "symlink" })
    expect(readFileSync(join(outside, "secret.md"), "utf8")).toBe("secret")
  })

  it("preserves candidate fingerprints across a selected Markdown rename", async () => {
    const root = projectRoot()
    mkdirSync(join(root, "docs"))
    writeFileSync(join(root, "docs", "old.md"), "# Plan\n\n- [ ] Same task\n")
    const before = await readProjectPlanSources({
      projectId: "project-1",
      rootPath: root,
      markdownPaths: ["docs/old.md"],
    })
    renameSync(join(root, "docs", "old.md"), join(root, "docs", "new.md"))
    const after = await readProjectPlanSources({
      projectId: "project-1",
      rootPath: root,
      markdownPaths: ["docs/new.md"],
    })

    expect(after.sources[0]!.fingerprint).toBe(before.sources[0]!.fingerprint)
    expect(after.sources[0]!.candidates.map((candidate) => candidate.fingerprint)).toEqual(
      before.sources[0]!.candidates.map((candidate) => candidate.fingerprint),
    )
    expect(after.sources[0]!.id).not.toBe(before.sources[0]!.id)
  })
})

describe("plan source registry and watcher contracts", () => {
  it("persists selected Markdown only after registered-root validation", async () => {
    const root = projectRoot()
    mkdirSync(join(root, "docs"))
    writeFileSync(join(root, "docs", "plan.md"), "# Durable plan\n")
    const databasePath = join(root, "agents.db")
    const sqlite = new Database(databasePath)
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
    sqlite
      .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
      .run("project-1", "Root", root)
    const info = await import("node:fs").then(({ lstatSync }) => lstatSync(root, { bigint: true }))
    sqlite
      .prepare(
        `INSERT INTO filesystem_root_registrations
           (path, canonical_path, device_id, inode_id, bound_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(root, realpathSync(root), info.dev.toString(), info.ino.toString(), Date.now())
    sqlite.close()
    process.env.FLAPSTACK_DB_PATH = databasePath

    const { planSourcesRouter } = await import("../src/main/lib/trpc/routers/plan-sources")
    const caller = planSourcesRouter.createCaller({ getWindow: () => null })
    await expect(
      caller.registerMarkdown({ projectId: "project-1", relativePath: "../escape.md" }),
    ).rejects.toThrow("escapes")
    await caller.registerMarkdown({ projectId: "project-1", relativePath: "docs/plan.md" })

    expect(await caller.listRegistrations({ projectId: "project-1" })).toMatchObject([
      { projectId: "project-1", sourceType: "markdown", relativePath: "docs/plan.md" },
    ])
    const snapshot = await caller.refresh({ projectId: "project-1" })
    expect(snapshot.sources[0]).toMatchObject({ path: "docs/plan.md", status: "current" })
  })

  it("emits one debounced stale refresh for change and rename events", async () => {
    const root = projectRoot()
    mkdirSync(join(root, "docs"))
    const oldPath = join(root, "docs", "old.md")
    const newPath = join(root, "docs", "new.md")
    writeFileSync(oldPath, "# Plan\n\n- [ ] Watch task\n")
    let markdownPaths = ["docs/old.md"]
    const adapter = new FakeWatchAdapter()
    const events: Array<
      Parameters<
        NonNullable<ConstructorParameters<typeof PlanSourceRefreshWatcher>[0]["onRefresh"]>
      >[0]
    > = []
    const errors: Error[] = []
    const loadConfig = vi.fn(() => ({
      projectId: "project-1",
      rootPath: root,
      markdownPaths,
    }))
    const watcher = new PlanSourceRefreshWatcher({
      loadConfig,
      onRefresh: (event) => events.push(event),
      onError: (error) => errors.push(error),
      debounceMs: 5,
      watchFactory: () => adapter,
    })
    await watcher.start()

    writeFileSync(oldPath, "# Plan\n\n- [x] Watch task\n")
    adapter.emitAll("change", oldPath)
    adapter.emitAll("change", oldPath)
    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(events[0]!.snapshot.sources[0]).toMatchObject({ stale: true, status: "stale" })
    expect(events[0]!.changedPaths).toEqual([oldPath])

    renameSync(oldPath, newPath)
    markdownPaths = ["docs/new.md"]
    adapter.emitAll("unlink", oldPath)
    adapter.emitAll("add", newPath)
    await vi.waitFor(() => expect(events).toHaveLength(2))
    expect(events[1]!.changedPaths).toEqual([newPath, oldPath].sort())
    expect(events[1]!.snapshot.sources[0]!.path).toBe("docs/new.md")
    expect(errors).toEqual([])
    expect(loadConfig).toHaveBeenCalledTimes(3)

    await watcher.close()
    expect(adapter.closed).toBe(true)
  })
})

class FakeWatchAdapter implements PlanSourceWatchAdapter {
  private allListener: ((eventName: string, path: string) => void) | null = null
  private errorListener: ((error: unknown) => void) | null = null
  closed = false

  on(
    event: "all" | "error",
    listener: ((eventName: string, path: string) => void) | ((error: unknown) => void),
  ): this {
    if (event === "all") {
      this.allListener = listener as (eventName: string, path: string) => void
    } else {
      this.errorListener = listener as (error: unknown) => void
    }
    return this
  }

  emitAll(eventName: string, path: string): void {
    this.allListener?.(eventName, path)
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "flapstack-plan-source-"))
  directories.push(root)
  return root
}

function writeOpenSpec(
  root: string,
  change: string,
  files: { proposal: string; spec: string; tasks: string },
): void {
  const changeRoot = join(root, "openspec", "changes", change)
  mkdirSync(join(changeRoot, "specs", "reader"), { recursive: true })
  writeFileSync(join(changeRoot, "proposal.md"), files.proposal)
  writeFileSync(join(changeRoot, "specs", "reader", "spec.md"), files.spec)
  writeFileSync(join(changeRoot, "tasks.md"), files.tasks)
}
