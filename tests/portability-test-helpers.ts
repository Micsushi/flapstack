import Database from "better-sqlite3"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach } from "vitest"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

export async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "flapstack-portability-"))
  roots.push(root)
  return root
}

export function createTestDatabase(path: string, projectName = "Source"): void {
  const database = new Database(path)
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE usage_samples (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT,
      provider TEXT NOT NULL,
      tokens INTEGER NOT NULL
    );
    CREATE TABLE extension_enablement_policies (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT,
      extension_id TEXT NOT NULL,
      enabled INTEGER NOT NULL
    );
    CREATE TABLE claude_code_credentials (
      id TEXT PRIMARY KEY NOT NULL,
      access_token TEXT NOT NULL
    );
    CREATE TABLE project_vaults (
      project_id TEXT PRIMARY KEY NOT NULL,
      root_path TEXT NOT NULL,
      schema_version INTEGER NOT NULL
    );
  `)
  database.prepare("INSERT INTO projects VALUES (?, ?, ?, ?)").run("p1", projectName, "/tmp/p1", 1)
  database.prepare("INSERT INTO usage_samples VALUES (?, ?, ?, ?)").run("u1", "p1", "codex", 42)
  database
    .prepare("INSERT INTO extension_enablement_policies VALUES (?, ?, ?, ?)")
    .run("e1", "p1", "skill:test", 1)
  database
    .prepare("INSERT INTO claude_code_credentials VALUES (?, ?)")
    .run("c1", "sk-live-never-export-this-value")
  database.close()
}

export function createRelationalTestDatabase(path: string, seed = true): void {
  const database = new Database(path)
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      source_path TEXT
    );
    CREATE TABLE project_vaults (
      project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id),
      root_path TEXT NOT NULL UNIQUE,
      schema_version INTEGER NOT NULL
    );
    CREATE TABLE chats (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT REFERENCES projects(id),
      title TEXT NOT NULL,
      worktree_path TEXT
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY NOT NULL,
      chat_id TEXT NOT NULL REFERENCES chats(id),
      name TEXT NOT NULL,
      source_path TEXT,
      stored_path TEXT
    );
    CREATE TABLE voice_artifacts (
      id TEXT PRIMARY KEY NOT NULL,
      chat_id TEXT REFERENCES chats(id),
      text TEXT NOT NULL,
      audio_path TEXT
    );
  `)
  if (seed) {
    const insertProject = database.prepare("INSERT INTO projects VALUES (?, ?, ?, ?)")
    const insertTask = database.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?)")
    const insertVault = database.prepare("INSERT INTO project_vaults VALUES (?, ?, ?)")
    const insertChat = database.prepare("INSERT INTO chats VALUES (?, ?, ?, ?)")
    const insertAttachment = database.prepare("INSERT INTO attachments VALUES (?, ?, ?, ?, ?)")
    const insertVoice = database.prepare("INSERT INTO voice_artifacts VALUES (?, ?, ?, ?)")
    for (const id of ["p1", "p2"]) {
      insertProject.run(id, `Project ${id}`, `/source/projects/${id}`, 1)
      insertTask.run(`task-${id}`, id, `Task ${id}`, `/source/plans/${id}.md`)
      insertVault.run(id, `/source/vaults/${id}`, 1)
      insertChat.run(`chat-${id}`, id, `Chat ${id}`, `/source/worktrees/${id}`)
      insertAttachment.run(
        `attachment-${id}`,
        `chat-${id}`,
        `${id}.txt`,
        `/source/input/${id}.txt`,
        `/source/attachments/${id}.txt`,
      )
      insertVoice.run(`voice-${id}`, `chat-${id}`, `Voice ${id}`, `/source/voice/${id}.wav`)
    }
  }
  database.close()
}

export async function createConfigRoot(root: string, value = "safe"): Promise<string> {
  const config = join(root, "config")
  await mkdir(config, { recursive: true })
  await writeFile(
    join(config, "usage-settings.json"),
    JSON.stringify({ label: value, apiKey: "sk-live-never-export-this-value" }),
  )
  return config
}
