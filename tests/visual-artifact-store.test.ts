import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { VisualArtifactStore } from "../src/main/lib/visual-capture/artifact-store"
import { createVisualCaptureDerivative } from "../src/main/lib/visual-capture/derivative"
import { removeFileInsideRoot } from "../src/main/lib/path-safety"

let container = ""
let artifactRoot = ""
let database: Database.Database
let now = 1_000

beforeEach(() => {
  container = mkdtempSync(join(tmpdir(), "flapstack-visual-artifacts-"))
  artifactRoot = join(container, "visual-artifacts")
  mkdirSync(artifactRoot)
  database = new Database(join(container, "agents.db"))
  database.pragma("foreign_keys = ON")
  migrate(drizzle(database, { schema }), {
    migrationsFolder: resolve(process.cwd(), "drizzle"),
  })
  database
    .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
    .run("project-a", "Project A", join(container, "project-a"))
  database
    .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
    .run("project-b", "Project B", join(container, "project-b"))
  database.prepare("INSERT INTO chats (id, project_id) VALUES (?, ?)").run("chat-a", "project-a")
  database.prepare("INSERT INTO chats (id, project_id) VALUES (?, ?)").run("chat-b", "project-b")
  database
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES (?, ?, ?)")
    .run("task-a", "project-a", "Task A")
  database
    .prepare(
      `INSERT INTO agent_runs
         (id, chat_id, harness, permission_mode, status)
       VALUES (?, ?, 'claude-code', 'ask-before-edits', 'completed')`,
    )
    .run("run-a", "chat-a")
  database
    .prepare("INSERT INTO project_vaults (project_id, root_path) VALUES (?, ?)")
    .run("project-a", join(container, "vault-a"))
  database
    .prepare(
      `INSERT INTO project_vault_graph_generations
         (id, project_id, state, source_fingerprint, note_count, edge_count, created_at, committed_at)
       VALUES ('generation-a', 'project-a', 'committed', ?, 1, 0, 1, 1)`,
    )
    .run("a".repeat(64))
  database
    .prepare(
      `INSERT INTO project_vault_graph_state
         (project_id, current_generation_id, updated_at)
       VALUES ('project-a', 'generation-a', 1)`,
    )
    .run()
  database
    .prepare(
      `INSERT INTO project_vault_graph_nodes
         (generation_id, node_id, project_id, stable_id, relative_path, normalized_path,
          title, content_hash, byte_length, aliases_json, tags_json, diagnostics_json)
       VALUES ('generation-a', 'note-a', 'project-a', 'custom:note-a', 'note.md', 'note.md',
               'Note', ?, 1, '[]', '[]', '[]')`,
    )
    .run("b".repeat(64))
})

afterEach(() => {
  database.close()
  rmSync(container, { recursive: true, force: true })
})

async function derivative(color = "#336699") {
  const bytes = await sharp({
    create: { width: 8, height: 6, channels: 4, background: color },
  })
    .png()
    .toBuffer()
  return createVisualCaptureDerivative(bytes, {
    crop: null,
    redactions: [],
    annotations: [],
  })
}

async function confirm(store: VisualArtifactStore, color?: string) {
  return store.confirm({
    requestId: "request-a",
    sourceClass: "screen",
    actor: { kind: "user", id: "owner" },
    scope: { projectId: "project-a", chatId: "chat-a" },
    approvalId: null,
    capturedAt: 900,
    scaleFactor: 1.25,
    derivative: await derivative(color),
  })
}

describe("visual artifact durable boundary", () => {
  it("stores only the exact confirmed derivative and provenance without source titles", async () => {
    const store = new VisualArtifactStore(database, artifactRoot, () => now)
    const record = await confirm(store)
    const bytes = await import("node:fs/promises").then((fs) =>
      fs.readFile(join(artifactRoot, record.storedPath)),
    )

    expect(createHash("sha256").update(bytes).digest("hex")).toBe(record.derivativeSha256)
    expect(record.previewSha256).toBe(record.derivativeSha256)
    expect(record).toMatchObject({
      projectId: "project-a",
      chatId: "chat-a",
      sourceClass: "screen",
      actorKind: "user",
      actorId: "owner",
      scaleFactor: 1.25,
    })
    const columns = database.prepare("PRAGMA table_info(visual_artifacts)").all() as {
      name: string
    }[]
    expect(columns.map((column) => column.name)).not.toContain("source_title")
    expect(database.prepare("SELECT COUNT(*) AS count FROM visual_capture_audit").get()).toEqual({
      count: 1,
    })
  })

  it("rejects cross-project scopes, agent artifacts without approval, and hash drift", async () => {
    const store = new VisualArtifactStore(database, artifactRoot, () => now)
    const exact = await derivative()
    await expect(
      store.confirm({
        requestId: "request-x",
        sourceClass: "window",
        actor: { kind: "user", id: "owner" },
        scope: { projectId: "project-a", chatId: "chat-b" },
        approvalId: null,
        capturedAt: 900,
        scaleFactor: 1,
        derivative: exact,
      }),
    ).rejects.toThrow(/chat.*project/i)
    await expect(
      store.confirm({
        requestId: "request-agent",
        sourceClass: "window",
        actor: { kind: "agent", id: "run-a" },
        scope: { projectId: "project-a", chatId: "chat-a" },
        approvalId: null,
        capturedAt: 900,
        scaleFactor: 1,
        derivative: exact,
      }),
    ).rejects.toThrow(/approval/i)
    await expect(
      store.confirm({
        requestId: "request-hash",
        sourceClass: "window",
        actor: { kind: "user", id: "owner" },
        scope: { projectId: "project-a", chatId: "chat-a" },
        approvalId: null,
        capturedAt: 900,
        scaleFactor: 1,
        derivative: { ...exact, derivativeSha256: "0".repeat(64) },
      }),
    ).rejects.toThrow(/hash/i)
    expect(database.prepare("SELECT COUNT(*) AS count FROM visual_artifacts").get()).toEqual({
      count: 0,
    })
  })

  it("validates run scope and atomically creates every initial scope link at confirmation", async () => {
    const store = new VisualArtifactStore(database, artifactRoot, () => now)
    const exact = await derivative()
    const record = await store.confirm({
      requestId: "request-run",
      sourceClass: "screen",
      actor: { kind: "user", id: "owner" },
      scope: {
        projectId: "project-a",
        chatId: "chat-a",
        taskId: "task-a",
        runId: "run-a",
      },
      approvalId: null,
      capturedAt: 900,
      scaleFactor: 1,
      derivative: exact,
      initialLinks: [
        { consumerKind: "chat", consumerId: "chat-a" },
        { consumerKind: "task", consumerId: "task-a" },
        { consumerKind: "run", consumerId: "run-a" },
      ],
    })
    expect(store.selectedContext("run", "run-a")).toEqual([
      expect.objectContaining({ id: record.id, contextSha256: exact.derivativeSha256 }),
    ])

    await expect(
      store.confirm({
        requestId: "request-wrong-run",
        sourceClass: "screen",
        actor: { kind: "user", id: "owner" },
        scope: { projectId: "project-b", runId: "run-a" },
        approvalId: null,
        capturedAt: 900,
        scaleFactor: 1,
        derivative: exact,
      }),
    ).rejects.toThrow(/run.*project/i)
  })

  it("never exposes unselected artifacts and snapshots the exact selected context hash", async () => {
    const store = new VisualArtifactStore(database, artifactRoot, () => now)
    const record = await confirm(store)
    expect(store.selectedContext("chat", "chat-a")).toEqual([])
    store.link({ artifactId: record.id, consumerKind: "chat", consumerId: "chat-a" })
    expect(store.selectedContext("chat", "chat-a")).toEqual([
      {
        id: record.id,
        storedPath: record.storedPath,
        sha256: record.derivativeSha256,
        contextSha256: record.derivativeSha256,
      },
    ])
    expect(() =>
      store.link({ artifactId: record.id, consumerKind: "chat", consumerId: "chat-b" }),
    ).toThrow(/scope mismatch/i)
    expect(() =>
      store.link({ artifactId: record.id, consumerKind: "knowledge", consumerId: "missing-note" }),
    ).toThrow(/knowledge scope mismatch/i)
    expect(() =>
      store.link({ artifactId: record.id, consumerKind: "knowledge", consumerId: "note-a" }),
    ).not.toThrow()
  })

  it("reports missing and tampered bytes instead of silently reusing them", async () => {
    const store = new VisualArtifactStore(database, artifactRoot, () => now)
    const tampered = await confirm(store)
    writeFileSync(join(artifactRoot, tampered.storedPath), "tampered")
    await expect(store.inspect(tampered.id)).resolves.toMatchObject({ state: "tampered" })

    const missing = await confirm(store, "#ffffff")
    rmSync(join(artifactRoot, missing.storedPath))
    await expect(store.inspect(missing.id)).resolves.toMatchObject({ state: "missing" })
  })

  it("exports only explicit selected derivatives after scanning and protects references", async () => {
    const store = new VisualArtifactStore(database, artifactRoot, () => now)
    const selected = await confirm(store)
    const notSelected = await confirm(store, "#000000")
    const exportRoot = join(container, "export")
    const scanned: string[] = []
    const exported = await store.exportSelected({
      artifactIds: [selected.id],
      destinationRoot: exportRoot,
      scan: async (bytes) => {
        scanned.push(createHash("sha256").update(bytes).digest("hex"))
      },
    })
    expect(exported).toEqual([`${selected.id}.png`])
    expect(scanned).toEqual([selected.derivativeSha256])
    expect(existsSync(join(exportRoot, `${selected.id}.png`))).toBe(true)
    expect(existsSync(join(exportRoot, `${notSelected.id}.png`))).toBe(false)

    store.link({ artifactId: selected.id, consumerKind: "chat", consumerId: "chat-a" })
    await expect(
      store.deleteIfUnreferenced(selected.id, { retentionOverride: true }),
    ).rejects.toThrow(/referenced/i)
    await store.deleteIfUnreferenced(notSelected.id, { retentionOverride: true })
    expect(() => store.get(notSelected.id)).toThrow(/not found/i)
  })

  it("locks deletion before filesystem work so a late link cannot race cleanup", async () => {
    const store = new VisualArtifactStore(database, artifactRoot, () => now)
    const record = await confirm(store)
    const deleting = store.deleteIfUnreferenced(record.id, { retentionOverride: true })
    expect(() =>
      store.link({ artifactId: record.id, consumerKind: "chat", consumerId: "chat-a" }),
    ).toThrow(/deletion/i)
    await deleting
  })

  it("preserves a deletion tombstone and retries when physical removal fails", async () => {
    let failRemoval = true
    const store = new VisualArtifactStore(database, artifactRoot, () => now, {
      removeFile: async (...args) => {
        if (failRemoval) {
          failRemoval = false
          throw new Error("injected physical deletion failure")
        }
        return removeFileInsideRoot(...args)
      },
    })
    const record = await confirm(store)
    const quarantinePath = join(artifactRoot, record.id, `.flapstack-delete-${record.id}.png`)

    await expect(
      store.deleteIfUnreferenced(record.id, { retentionOverride: true }),
    ).rejects.toThrow(/injected physical deletion failure/i)

    expect(store.get(record.id)).toMatchObject({ archivedAt: -1 })
    expect(existsSync(quarantinePath)).toBe(true)
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM visual_capture_audit WHERE artifact_id = ? AND action = 'delete'",
        )
        .get(record.id),
    ).toEqual({ count: 0 })

    await expect(store.reconcilePendingDeletions()).resolves.toEqual({
      deleted: [record.id],
      failed: [],
    })
    expect(() => store.get(record.id)).toThrow(/not found/i)
    expect(existsSync(quarantinePath)).toBe(false)
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM visual_capture_audit WHERE action = 'delete'")
        .get(),
    ).toEqual({ count: 1 })
  })

  it("supports scoped search, archive, move, retention cleanup, import, and audit history", async () => {
    const store = new VisualArtifactStore(database, artifactRoot, () => now)
    const first = await confirm(store)
    const second = await confirm(store, "#ffffff")

    store.archive(first.id, true)
    expect(store.search({ projectId: "project-a", archived: true })).toEqual([
      expect.objectContaining({ id: first.id, archivedAt: now }),
    ])
    store.move(first.id, { chatId: null, taskId: "task-a" })
    expect(store.get(first.id)).toMatchObject({ chatId: null, taskId: "task-a" })
    store.setRetention(first.id, 5_000)
    expect(store.get(first.id)).toMatchObject({ retainedUntil: 5_000 })
    store.setRetention(first.id, null)
    expect(store.get(first.id)).toMatchObject({ retainedUntil: null })

    now = 2_000
    database
      .prepare("UPDATE visual_artifacts SET retained_until = ? WHERE id = ?")
      .run(1_500, second.id)
    await expect(store.cleanupExpired()).resolves.toEqual({
      deleted: [second.id],
      skippedReferenced: [],
    })

    const importedBytes = (await derivative("#123456")).bytes
    const imported = await store.importDerivative({
      projectId: "project-a",
      chatId: "chat-a",
      bytes: importedBytes,
      actorId: "owner",
    })
    expect(imported).toMatchObject({
      projectId: "project-a",
      chatId: "chat-a",
      sourceClass: "region",
    })
    expect(store.auditHistory({ projectId: "project-a" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "delete", operation: "archive" }),
        expect.objectContaining({ action: "link", operation: "move" }),
        expect.objectContaining({ action: "link", operation: "retention" }),
        expect.objectContaining({ action: "confirm", operation: "import" }),
      ]),
    )
  })
})
