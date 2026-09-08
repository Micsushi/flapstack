import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { beforeEach, afterEach, it, expect } from "vitest"
import { getRunContextHealth } from "../src/main/lib/project-vaults/context-health"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"
let directory: string, path: string, db: Database.Database
const input = { chatId: "c", runId: "r" },
  hash = "a".repeat(64)
const budget = { maxBytes: 24000, maxEstimatedTokens: 6000, includedBytes: 10, estimatedTokens: 3 }
const source = {
  sectionId: "context",
  title: "Context",
  sourcePath: "context.md",
  version: 1,
  contentHash: hash,
  originalBytes: 20,
  includedBytes: 10,
  estimatedTokens: 3,
  truncated: true,
}
const manifest = () => ({
  schemaVersion: 1,
  status: "included",
  harness: "codex",
  projectId: "p",
  taskId: null,
  runId: "r",
  selectionSource: "run",
  selectedSectionIds: ["context"],
  budget,
  entries: [source],
  truncations: [
    { sectionId: "context", originalBytes: 20, includedBytes: 10, reason: "byte-budget" },
  ],
})
function save(value: unknown) {
  db.prepare("UPDATE agent_runs SET vault_context_manifest=? WHERE id='r'").run(
    typeof value === "string" ? value : JSON.stringify(value),
  )
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-context-health-"))
  path = join(directory, "test.db")
  db = new Database(path)
  migrate(drizzle(db), { migrationsFolder: resolve("drizzle") })
  db.exec(
    "INSERT INTO projects(id,name,path) VALUES('p','Project','/never-read'),('other','Other','/other'); INSERT INTO chats(id,project_id,name) VALUES('c','p','Chat'),('outside','other','Other')",
  )
  db.prepare(
    "INSERT INTO agent_runs(id,chat_id,harness,permission_mode,status,runtime_snapshot_version,runtime_preference,runtime_preference_source,resolved_runtime,runtime_adapter_version,runtime_protocol_version,runtime_capability_snapshot,runtime_control_snapshot) VALUES('r','c','codex','read-only','success',?,?,?,?,?,?,?,?)",
  ).run(...testRuntimeSnapshotSqlValues())
  db.prepare("INSERT INTO project_vaults(project_id,root_path) VALUES('p',?)").run(
    join(directory, "must-not-be-created"),
  )
  db.prepare(
    "INSERT INTO project_vault_sections(project_id,section_id,section_type,title,relative_path,version,content_hash,byte_length,updated_at) VALUES('p','context','context','Context','context.md',1,?,20,1700000000)",
  ).run(hash)
})
afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})
it("projects launch provenance and metadata comparison from read-only SQLite without touching source files", () => {
  save(manifest())
  db.close()
  db = new Database(path, { readonly: true, fileMustExist: true })
  const result = getRunContextHealth(db, input)
  expect(result).toMatchObject({
    status: "included",
    filesystemFreshness: "unverified",
    providerReceipt: "unverified",
    selectionSource: "run",
    budget,
  })
  expect(result.sources[0]).toMatchObject({
    title: source.title,
    sourcePath: source.sourcePath,
    contentHash: source.contentHash,
    version: source.version,
    originalBytes: source.originalBytes,
    includedBytes: source.includedBytes,
    truncated: true,
    id: "context",
    kind: "section",
    current: { status: "unchanged", version: 1, contentHash: hash, recordedAt: 1700000000000 },
  })
  expect(result.sources[0]).not.toHaveProperty("sectionId")
  expect(existsSync(join(directory, "must-not-be-created"))).toBe(false)
  expect(
    (db.prepare("SELECT vault_context_manifest value FROM agent_runs WHERE id='r'").get() as any)
      .value,
  ).toBe(JSON.stringify(manifest()))
})
it("reports changed, missing, and unknown recorded metadata without claiming current filesystem freshness", () => {
  save(manifest())
  db.exec("UPDATE project_vault_sections SET version=2")
  expect(getRunContextHealth(db, input).sources[0]!.current.status).toBe("changed")
  db.exec("UPDATE project_vault_sections SET content_hash='invalid'")
  expect(getRunContextHealth(db, input).sources[0]!.current.status).toBe("unknown")
  db.exec("DELETE FROM project_vault_sections")
  expect(getRunContextHealth(db, input).sources[0]!.current.status).toBe("missing")
})
it("distinguishes unavailable, explicit empty, and rejected manifests and refuses mismatched scopes", () => {
  expect(getRunContextHealth(db, input).status).toBe("unavailable")
  save({
    ...manifest(),
    status: "empty",
    projectId: null,
    runId: null,
    selectionSource: "fixed-default",
    selectedSectionIds: [],
    entries: [],
    truncations: [],
    budget: { ...budget, includedBytes: 0, estimatedTokens: 0 },
  })
  expect(getRunContextHealth(db, input).status).toBe("empty")
  save({
    ...manifest(),
    status: "rejected",
    entries: [],
    truncations: [],
    rejection: { sectionId: "context", reason: "content-changed" },
  })
  expect(getRunContextHealth(db, input)).toMatchObject({
    status: "rejected",
    reason: "Launch context was rejected: content-changed.",
  })
  for (const patch of [
    { projectId: "other" },
    { runId: "another" },
    { taskId: "another" },
    { harness: "claude-code" },
  ]) {
    save({ ...manifest(), ...patch })
    expect(getRunContextHealth(db, input).status).toBe("unavailable")
  }
  db.exec(
    "INSERT INTO tasks(id,project_id,name) VALUES('task','p','Task'); UPDATE chats SET task_id='task' WHERE id='c'",
  )
  save(manifest())
  expect(getRunContextHealth(db, input).status).toBe("unavailable")
  expect(() => getRunContextHealth(db, { chatId: "outside", runId: "r" })).toThrow(
    "not found in this chat",
  )
})
it("bounds and validates stored data without reflecting corrupt content or secret-like display metadata", () => {
  for (const value of [
    "not json",
    "x".repeat(131073),
    { ...manifest(), entries: [{ ...source, title: "sk-" + "x".repeat(24) }] },
    {
      ...manifest(),
      entries: [{ ...source, sourcePath: "Authorization: Bearer " + "z".repeat(24) }],
    },
    { ...manifest(), rawContent: "private" },
    { ...manifest(), entries: [{ ...source, includedBytes: 30 }] },
  ]) {
    save(value)
    const result = getRunContextHealth(db, input)
    expect(result.status).toBe("unavailable")
    expect(result.sources).toEqual([])
    expect(JSON.stringify(result)).not.toContain("private")
  }
})
it("represents graph launch sources with explicitly unknown current comparison", () => {
  const graph = {
    schemaVersion: 1,
    status: "included",
    projectId: "p",
    generationId: "generation",
    selectedNodeIds: ["node"],
    expansion: { depth: 0, direction: "outgoing", maxNodes: 1 },
    budget,
    entries: [
      {
        nodeId: "node",
        stableId: null,
        title: "Graph note",
        sourcePath: "notes/note.md",
        contentHash: hash,
        originalBytes: 10,
        includedBytes: 10,
        estimatedTokens: 3,
        truncated: false,
        reason: "selected",
        depth: 0,
      },
    ],
    traversedEdges: [],
    omissions: [],
  }
  save({
    ...manifest(),
    schemaVersion: 2,
    graphContext: graph,
    budget: { ...budget, includedBytes: 20, estimatedTokens: 6 },
  })
  const result = getRunContextHealth(db, input)
  expect(result.status).toBe("included")
  expect(result.graphGenerationId).toBe("generation")
  expect(result.sources[1]).toMatchObject({
    kind: "graph",
    id: "node",
    sourcePath: "notes/note.md",
    version: null,
    current: { status: "unknown" },
  })
  save({ ...manifest(), schemaVersion: 2, graphContext: { ...graph, projectId: "other" } })
  expect(getRunContextHealth(db, input).status).toBe("unavailable")
})
