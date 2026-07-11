import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq, sql } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Database from "better-sqlite3"

const electronState = vi.hoisted(() => ({ userDataPath: "/tmp/flapstack-ingestion-initial" }))

vi.mock("electron", () => ({
  app: {
    getPath: () => electronState.userDataPath,
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: vi.fn() },
}))

vi.mock("drizzle-orm/better-sqlite3/migrator", () => ({ migrate: vi.fn() }))

import { attachments, closeDatabase, flapshotOperations, getDatabase } from "../src/main/lib/db"
import {
  commitFlapshotAttachment,
  ensureFlapshotStoredCopy,
  flapshotAttachmentId,
} from "../src/main/lib/flapshot/service"

let userDataDir: string

function createSchema() {
  const db = getDatabase()
  db.run(sql.raw(`CREATE TABLE chats (id text PRIMARY KEY NOT NULL)`))
  db.run(
    sql.raw(`CREATE TABLE attachments (
      id text PRIMARY KEY NOT NULL, chat_id text NOT NULL, task_id text, kind text NOT NULL,
      name text NOT NULL, source_path text, stored_path text, content_text text, mime_type text,
      byte_length integer, sha256 text, source_artifact_id text, source_uri text,
      source_application text, grant_client_id text, grant_expires_at text, provenance_json text,
      integrity_status text, operation_id text, correlation_id text, audit_correlation_id text,
      created_at integer, FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE cascade
    )`),
  )
  db.run(
    sql.raw(`CREATE UNIQUE INDEX attachments_operation_id_unique ON attachments (operation_id)`),
  )
  db.run(
    sql.raw(`CREATE TABLE flapshot_operations (
      id text PRIMARY KEY NOT NULL, operation_id text NOT NULL UNIQUE, chat_id text NOT NULL,
      task_id text, connection_key text NOT NULL, kind text NOT NULL, state text NOT NULL,
      request_id text NOT NULL, correlation_id text NOT NULL, audit_correlation_id text NOT NULL,
      client_id text NOT NULL, session_id text NOT NULL, progress_completed integer NOT NULL DEFAULT 0,
      progress_total integer, progress_unit text, progress_message text, error_code text,
      error_reason text, error_message text, result_attachment_id text, created_at integer,
      updated_at integer, FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE cascade,
      FOREIGN KEY (result_attachment_id) REFERENCES attachments(id) ON DELETE set null
    )`),
  )
  db.run(sql.raw(`INSERT INTO chats (id) VALUES ('chat-1')`))
  db.insert(flapshotOperations)
    .values({
      id: "row-1",
      operationId: "operation-1",
      chatId: "chat-1",
      taskId: null,
      connectionKey: "global",
      kind: "screenshot",
      state: "succeeded",
      requestId: "request-1",
      correlationId: "correlation-1",
      auditCorrelationId: "audit-1",
      clientId: "client-1",
      sessionId: "session-1",
    })
    .run()
}

function attachment() {
  return {
    id: flapshotAttachmentId("operation-1"),
    chatId: "chat-1",
    taskId: null,
    kind: "image",
    name: "capture.png",
    sourcePath: "/source/capture.png",
    storedPath: "/stored/capture.png",
    mimeType: "image/png",
    byteLength: 68,
    sha256: "a".repeat(64),
    sourceApplication: "Flapshot",
    integrityStatus: "verified",
    operationId: "operation-1",
  }
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), "flapstack-ingestion-"))
  electronState.userDataPath = userDataDir
  createSchema()
})

afterEach(() => {
  closeDatabase()
  rmSync(userDataDir, { recursive: true, force: true })
})

describe("Flapshot result ingestion", () => {
  it("migrates legacy duplicates and repairs missing operation links", () => {
    closeDatabase()
    const sqlite = new Database(":memory:")
    sqlite.exec(`
      CREATE TABLE attachments (id text PRIMARY KEY, operation_id text);
      CREATE TABLE flapshot_operations (operation_id text PRIMARY KEY, result_attachment_id text);
      INSERT INTO attachments VALUES ('keep-linked', 'operation-a');
      INSERT INTO attachments VALUES ('drop-a', 'operation-a');
      INSERT INTO attachments VALUES ('a-keep-min', 'operation-b');
      INSERT INTO attachments VALUES ('z-drop-b', 'operation-b');
      INSERT INTO flapshot_operations VALUES ('operation-a', 'keep-linked');
      INSERT INTO flapshot_operations VALUES ('operation-b', NULL);
    `)
    const migration = readFileSync(
      join(process.cwd(), "drizzle", "0018_common_phalanx.sql"),
      "utf8",
    ).replaceAll("--> statement-breakpoint", "")
    sqlite.exec(migration)

    expect(sqlite.prepare("SELECT id FROM attachments ORDER BY id").all()).toEqual([
      { id: "a-keep-min" },
      { id: "keep-linked" },
    ])
    expect(
      sqlite
        .prepare(
          "SELECT operation_id, result_attachment_id FROM flapshot_operations ORDER BY operation_id",
        )
        .all(),
    ).toEqual([
      { operation_id: "operation-a", result_attachment_id: "keep-linked" },
      { operation_id: "operation-b", result_attachment_id: "a-keep-min" },
    ])
    expect(() =>
      sqlite.prepare("INSERT INTO attachments VALUES ('duplicate', 'operation-a')").run(),
    ).toThrow()
    sqlite.close()
  })

  it("rolls back the attachment when linking crashes, then retries without an orphan", () => {
    const db = getDatabase()
    db.run(
      sql.raw(`CREATE TRIGGER fail_flapshot_link BEFORE UPDATE OF result_attachment_id
        ON flapshot_operations BEGIN SELECT RAISE(ABORT, 'simulated crash'); END`),
    )
    expect(() =>
      commitFlapshotAttachment({ operationId: "operation-1", attachment: attachment() }),
    ).toThrow("simulated crash")
    expect(db.select().from(attachments).all()).toHaveLength(0)

    db.run(sql.raw(`DROP TRIGGER fail_flapshot_link`))
    const id = commitFlapshotAttachment({ operationId: "operation-1", attachment: attachment() })
    expect(db.select().from(attachments).all()).toHaveLength(1)
    expect(
      db
        .select()
        .from(flapshotOperations)
        .where(eq(flapshotOperations.operationId, "operation-1"))
        .get()?.resultAttachmentId,
    ).toBe(id)
  })

  it("repairs an insert-before-link retry and concurrent refreshes stay idempotent", async () => {
    const db = getDatabase()
    db.insert(attachments).values(attachment()).run()

    const ids = await Promise.all(
      Array.from({ length: 8 }, async () =>
        commitFlapshotAttachment({ operationId: "operation-1", attachment: attachment() }),
      ),
    )
    expect(new Set(ids)).toEqual(new Set([attachment().id]))
    expect(db.select().from(attachments).all()).toHaveLength(1)
    expect(
      db
        .select()
        .from(flapshotOperations)
        .where(eq(flapshotOperations.operationId, "operation-1"))
        .get()?.resultAttachmentId,
    ).toBe(attachment().id)
  })

  it("reuses a copied result after a crash and cleans abandoned staging", async () => {
    const source = join(userDataDir, "source.png")
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    )
    writeFileSync(source, png)
    const sha256 = createHash("sha256").update(png).digest("hex")
    const input = {
      storageRoot: join(userDataDir, "attachments"),
      attachmentId: attachment().id,
      name: "capture.png",
      sourcePath: source,
      sizeBytes: png.byteLength,
      sha256,
      mimeType: "image/png",
    }
    const storedPath = await ensureFlapshotStoredCopy(input)
    const abandoned = join(input.storageRoot, input.attachmentId, ".flapstack-crashed.tmp")
    writeFileSync(abandoned, "partial")

    const retriedPath = await ensureFlapshotStoredCopy(input)
    expect(retriedPath).toBe(storedPath)
    expect(readFileSync(retriedPath)).toEqual(png)
    expect(existsSync(abandoned)).toBe(false)
  })
})
