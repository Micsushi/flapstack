import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { createMcpMutationService } from "../src/main/lib/mcp-control/mutation-service"
import { VisualArtifactStore } from "../src/main/lib/visual-capture/artifact-store"
import { createVisualCaptureDerivative } from "../src/main/lib/visual-capture/derivative"
import {
  bindVisualCaptureImagesToRun,
  visualCaptureAttachmentFilename,
} from "../src/main/lib/visual-capture/run-provenance"

let container = ""
let artifactRoot = ""
let database: Database.Database

beforeEach(() => {
  container = mkdtempSync(join(tmpdir(), "flapstack-visual-run-"))
  artifactRoot = join(container, "visual-artifacts")
  mkdirSync(artifactRoot)
  database = new Database(join(container, "agents.db"))
  database.pragma("foreign_keys = ON")
  migrate(drizzle(database, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  database
    .prepare("INSERT INTO projects (id, name, path) VALUES ('project-a', 'A', ?)")
    .run(join(container, "project-a"))
  database
    .prepare("INSERT INTO projects (id, name, path) VALUES ('project-b', 'B', ?)")
    .run(join(container, "project-b"))
  database
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES ('task-a', 'project-a', 'Task A')")
    .run()
  database
    .prepare(
      "INSERT INTO chats (id, project_id, task_id, scope) VALUES ('chat-a', 'project-a', 'task-a', 'task')",
    )
    .run()
  database.prepare("INSERT INTO chats (id, project_id) VALUES ('chat-b', 'project-b')").run()
  database
    .prepare(
      `INSERT INTO agent_runs (id, chat_id, harness, permission_mode, status)
       VALUES ('run-a', 'chat-a', 'codex', 'ask-before-edits', 'completed')`,
    )
    .run()
})

afterEach(() => {
  database.close()
  rmSync(container, { recursive: true, force: true })
})

async function confirmed() {
  const source = await sharp({
    create: { width: 4, height: 4, channels: 4, background: "#123456" },
  })
    .png()
    .toBuffer()
  const derivative = await createVisualCaptureDerivative(source, {
    crop: null,
    redactions: [],
    annotations: [],
  })
  const store = new VisualArtifactStore(database, artifactRoot, () => 100)
  const record = await store.confirm({
    requestId: "request-a",
    sourceClass: "screen",
    actor: { kind: "user", id: "owner" },
    scope: { projectId: "project-a", chatId: "chat-a" },
    approvalId: null,
    capturedAt: 90,
    scaleFactor: 1,
    derivative,
    initialLinks: [{ consumerKind: "chat", consumerId: "chat-a" }],
  })
  return { store, record, derivative }
}

describe("visual capture immutable run provenance", () => {
  it("rejects byte/hash drift, cross-chat selection, and forged marker filenames", async () => {
    const { record, derivative } = await confirmed()
    const exact = {
      filename: visualCaptureAttachmentFilename(record),
      mediaType: "image/png",
      base64Data: derivative.bytes.toString("base64"),
    }
    await expect(
      bindVisualCaptureImagesToRun({
        database,
        artifactRoot,
        chatId: "chat-a",
        runId: "run-a",
        images: [{ ...exact, base64Data: Buffer.from("forged").toString("base64") }],
      }),
    ).rejects.toThrow(/hash|bytes/i)

    database
      .prepare("DELETE FROM visual_artifact_links WHERE artifact_id = ? AND consumer_kind = 'chat'")
      .run(record.id)
    await expect(
      bindVisualCaptureImagesToRun({
        database,
        artifactRoot,
        chatId: "chat-a",
        runId: "run-a",
        images: [exact],
      }),
    ).rejects.toThrow(/selected.*chat/i)

    await expect(
      bindVisualCaptureImagesToRun({
        database,
        artifactRoot,
        chatId: "chat-a",
        runId: "run-a",
        images: [{ ...exact, filename: `flapstack-visual-${record.id}-${"0".repeat(64)}.png` }],
      }),
    ).rejects.toThrow(/hash|marker/i)
  })

  it("exposes only approved exact-scope request/read operations through the MCP mutation boundary", async () => {
    const { record, derivative } = await confirmed()
    const service = createMcpMutationService(join(container, "agents.db"))
    const caller = {
      chatId: "chat-a",
      runId: "run-a",
      permissionMode: "ask-before-edits" as const,
    }
    await expect(
      service.invoke(
        "request_visual_capture",
        caller,
        { projectId: "project-a", chatId: "chat-a", runId: "run-a" },
        { invocationId: "11111111-1111-4111-8111-111111111111", approved: false },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "approval-required" },
    })
    await expect(
      service.invoke(
        "request_visual_capture",
        caller,
        { projectId: "project-a", chatId: "chat-a", runId: "run-a" },
        { invocationId: "11111111-1111-4111-8111-111111111111", approved: true },
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: "awaiting-visible-user-selection",
        captureRequestId: "11111111-1111-4111-8111-111111111111",
      },
    })
    const read = await service.invoke("read_visual_context", caller, {
      artifactId: record.id,
    })
    expect(read).toEqual({
      ok: true,
      data: {
        artifactId: record.id,
        mediaType: "image/png",
        sha256: derivative.derivativeSha256,
        base64Data: derivative.bytes.toString("base64"),
      },
    })

    await expect(
      service.invoke(
        "request_visual_capture",
        caller,
        { projectId: "project-b", chatId: "chat-a", runId: "run-a" },
        { invocationId: "22222222-2222-4222-8222-222222222222", approved: true },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "out-of-scope" },
    })
  })
})
