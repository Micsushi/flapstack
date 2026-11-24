import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { execFileSync } from "node:child_process"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq, sql } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  agentRuns,
  chats,
  checkpoints,
  closeDatabase,
  fileChangeManifests,
  getDatabase,
  projects,
  subChats,
  tasks,
} from "../src/main/lib/db"
import {
  captureCheckpoint,
  captureRunManifest,
  restoreCheckpoint,
  resolveCleanHead,
} from "../src/main/lib/checkpoints"
import { chatsRouter } from "../src/main/lib/trpc/routers/chats"
import { sweepAbandonedCheckpointPreparations } from "../src/main/lib/checkpoint-preparation"
import {
  leaseCheckpointFiles,
  reclaimCheckpointFiles,
} from "../src/main/lib/checkpoint-file-retention"
import * as dbSchema from "../src/main/lib/db/schema"
import { getRunChangeReview, undoRunChangeSet } from "../src/main/lib/run-change-undo"
import { removeWorktree } from "../src/main/lib/git"
// @ts-expect-error JavaScript test helper intentionally has no declaration file.
import { createIsolatedTestGitEnvironment } from "../scripts/lib/test-git-environment.mjs"

const electronState = vi.hoisted(() => ({
  userDataPath: "/tmp/flapstack-vitest-initial",
  homePath: "/tmp",
}))

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) =>
      name === "home" ? electronState.homePath : electronState.userDataPath,
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
  BrowserWindow: {
    fromId: () => null,
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
}))

vi.mock("drizzle-orm/better-sqlite3/migrator", () => ({
  migrate: vi.fn(),
}))

vi.mock("../src/main/index", () => ({
  getAuthManager: () => null,
}))

vi.mock("../src/main/lib/analytics", () => ({
  trackPRCreated: vi.fn(),
  trackWorkspaceArchived: vi.fn(),
  trackWorkspaceCreated: vi.fn(),
  trackWorkspaceDeleted: vi.fn(),
  trackProjectOpened: vi.fn(),
}))

vi.mock("../src/main/lib/git", () => ({
  createWorktreeForChat: vi.fn(),
  fetchGitHubPRStatus: vi.fn(),
  getGitRemoteInfo: vi.fn(async () => ({
    remoteUrl: null,
    provider: null,
    owner: null,
    repo: null,
  })),
  getWorktreeDiff: vi.fn(),
  removeWorktree: vi.fn(),
  sanitizeProjectName: (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
}))

vi.mock("../src/main/lib/git/worktree", () => ({
  createWorktree: vi.fn(),
  getCurrentBranch: vi.fn(),
  getDefaultBranch: vi.fn(async () => "main"),
}))

vi.mock("../src/main/lib/terminal/manager", () => ({
  terminalManager: {
    killByWorkspaceId: vi.fn(async () => ({ killed: 0 })),
  },
}))

const ctx = { getWindow: () => null }

let userDataDir: string
let homeDir: string

beforeEach(() => {
  vi.clearAllMocks()
  userDataDir = mkdtempSync(join(tmpdir(), "flapstack-e1-db-"))
  homeDir = mkdtempSync(join(tmpdir(), "flapstack-e1-home-"))
  electronState.userDataPath = userDataDir
  electronState.homePath = homeDir
  process.env.FLAPSTACK_DB_PATH = join(userDataDir, "agents.db")
  process.env.FLAPSTACK_CONFIG_DIR = userDataDir
  createTestSchema()
})

afterEach(() => {
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  delete process.env.FLAPSTACK_CONFIG_DIR
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(homeDir, { recursive: true, force: true })
})

function createTestSchema() {
  const db = getDatabase()
  const statements = [
    "PRAGMA foreign_keys=ON",
    `CREATE TABLE projects (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      path text NOT NULL UNIQUE,
      created_at integer,
      updated_at integer,
      git_remote_url text,
      git_provider text,
      git_owner text,
      git_repo text,
      icon_path text,
      default_permission_mode text DEFAULT 'ask-before-edits' NOT NULL,
      default_custom_permissions text,
      vault_context_sections text,
      pinned_at integer,
      archived_at integer
    )`,
    `CREATE TABLE filesystem_root_registrations (
      path text PRIMARY KEY NOT NULL,
      canonical_path text NOT NULL,
      device_id text,
      inode_id text,
      bound_at integer NOT NULL
    )`,
    `CREATE TABLE tasks (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL REFERENCES projects(id) ON DELETE cascade,
      name text NOT NULL,
      description text,
      status text DEFAULT 'backlog' NOT NULL,
      board_order text DEFAULT 'a0' NOT NULL,
      version integer DEFAULT 1 NOT NULL,
      source_type text,
      source_path text,
      source_candidate_id text,
      source_fingerprint text,
      default_permission_mode text DEFAULT 'ask-before-edits' NOT NULL,
      default_custom_permissions text,
      vault_context_sections text,
      primary_worktree_path text,
      primary_branch text,
      pinned_at integer,
      archived_at integer,
      created_at integer,
      updated_at integer
    )`,
    "CREATE INDEX tasks_project_id_idx ON tasks(project_id)",
    `CREATE TABLE chats (
      id text PRIMARY KEY NOT NULL,
      name text,
      project_id text REFERENCES projects(id) ON DELETE cascade,
      task_id text REFERENCES tasks(id) ON DELETE cascade,
      scope text DEFAULT 'project' NOT NULL,
      permission_mode text DEFAULT 'ask-before-edits' NOT NULL,
      custom_permissions text,
      harness text,
      model text,
      runtime_preference text,
      assigned_role text,
      lead_chat_id text,
      discussion_chat_id text,
      created_at integer,
      updated_at integer,
      archived_at integer,
      pinned_at integer,
      worktree_path text,
      branch text,
      base_branch text,
      pr_url text,
      pr_number integer,
      mcp_exposure_enabled integer DEFAULT false NOT NULL,
      parent_chat_id text,
      initiator_chat_id text,
      parent_run_id text,
      ancestor_chat_ids text
    )`,
    `CREATE TABLE agent_runtime_defaults (
      id text PRIMARY KEY NOT NULL,
      scope_type text NOT NULL,
      scope_id text,
      harness text NOT NULL,
      preference text NOT NULL,
      version integer DEFAULT 1 NOT NULL,
      created_at integer,
      updated_at integer
    )`,
    "CREATE INDEX chats_worktree_path_idx ON chats(worktree_path)",
    "CREATE INDEX chats_task_id_idx ON chats(task_id)",
    "CREATE INDEX chats_scope_idx ON chats(scope)",
    `CREATE TABLE sub_chats (
      id text PRIMARY KEY NOT NULL,
      name text,
      chat_id text NOT NULL REFERENCES chats(id) ON DELETE cascade,
      session_id text,
      stream_id text,
      mode text DEFAULT 'agent' NOT NULL,
      harness text,
      model text,
      permission_mode text,
      worktree_path text,
      run_status text,
      messages text DEFAULT '[]' NOT NULL,
      created_at integer,
      updated_at integer
    )`,
    "CREATE TABLE record_task_worktrees (chat_id TEXT)",
    "CREATE TABLE record_chat_links (chat_id TEXT)",
    `CREATE TABLE agent_runs (
      id text PRIMARY KEY NOT NULL,
      chat_id text NOT NULL REFERENCES chats(id) ON DELETE cascade,
      sub_chat_id text REFERENCES sub_chats(id) ON DELETE set null,
      harness text NOT NULL,
      model text,
      permission_mode text NOT NULL,
      custom_permissions text,
      worktree_path text,
      prompt_message_id text,
      initial_prompt text,
      vault_context_sections text,
      vault_context_manifest text,
      status text DEFAULT 'running' NOT NULL,
      started_at integer,
      completed_at integer,
      before_checkpoint_id text,
      after_checkpoint_id text,
      runtime_snapshot_version integer DEFAULT 0 NOT NULL,
      runtime_preference text DEFAULT 'flapstack-native' NOT NULL,
      runtime_preference_source text DEFAULT 'legacy' NOT NULL,
      resolved_runtime text DEFAULT 'flapstack-native' NOT NULL,
      runtime_adapter_version text DEFAULT 'legacy-stage3' NOT NULL,
      runtime_protocol_version text DEFAULT 'legacy-stage3' NOT NULL,
      runtime_capability_snapshot text DEFAULT '{}' NOT NULL,
      runtime_control_snapshot text DEFAULT '{}' NOT NULL,
      runtime_launch_identity text,
      provider_account_id text DEFAULT 'legacy-system-default' NOT NULL,
      provider_auth_mode text DEFAULT 'legacy' NOT NULL,
      provider_runtime_target text DEFAULT 'local' NOT NULL,
      provider_credential_revision text DEFAULT 'legacy' NOT NULL
    )`,
    "CREATE INDEX agent_runs_chat_id_idx ON agent_runs(chat_id)",
    `CREATE TABLE checkpoints (
      id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE cascade,
      kind text NOT NULL,
      worktree_path text,
      git_commit text,
      git_status_json text,
      created_at integer
    )`,
    "CREATE INDEX checkpoints_run_id_idx ON checkpoints(run_id)",
    `CREATE TABLE file_change_manifests (
      id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE cascade,
      file_path text NOT NULL,
      change_type text NOT NULL,
      additions integer DEFAULT 0 NOT NULL,
      deletions integer DEFAULT 0 NOT NULL,
      before_hash text,
      after_hash text
    )`,
    "CREATE INDEX file_change_manifests_run_id_idx ON file_change_manifests(run_id)",
    `CREATE TABLE attachments (
      id text PRIMARY KEY NOT NULL,
      chat_id text NOT NULL REFERENCES chats(id) ON DELETE cascade,
      task_id text REFERENCES tasks(id) ON DELETE set null,
      kind text NOT NULL,
      name text NOT NULL,
      source_path text,
      source_kind text,
      stored_path text,
      content_text text,
      byte_length integer,
      mime_type text,
      sha256 text,
      created_at integer
    )`,
    "CREATE INDEX attachments_chat_id_idx ON attachments(chat_id)",
    "CREATE INDEX attachments_task_id_idx ON attachments(task_id)",
    `CREATE TABLE voice_artifacts (
      id text PRIMARY KEY NOT NULL,
      chat_id text NOT NULL REFERENCES chats(id) ON DELETE cascade,
      sub_chat_id text REFERENCES sub_chats(id) ON DELETE set null,
      message_id text,
      kind text NOT NULL,
      text text NOT NULL,
      adapter_id text NOT NULL,
      synthesis_key text,
      voice_id text,
      rate_milli integer,
      audio_path text,
      mime_type text,
      byte_length integer DEFAULT 0 NOT NULL,
      created_at integer,
      last_played_at integer
    )`,
  ]

  for (const migration of [
    "0038_agent_profiles.sql",
    "0049_agent_profile_chat_bindings.sql",
    "0077_run_timings.sql",
    "0079_mcp_turn_settings.sql",
    "0081_codex_rewind_intent.sql",
  ]) {
    statements.push(
      ...readFileSync(join(process.cwd(), "drizzle", migration), "utf8").split(
        "--> statement-breakpoint",
      ),
    )
  }
  for (const statement of statements) {
    db.run(sql.raw(statement))
  }
}

function insertProject(name: string, values: Partial<typeof projects.$inferInsert> = {}) {
  return getDatabase()
    .insert(projects)
    .values({
      name,
      path: join(homeDir, name),
      ...values,
    })
    .returning()
    .get()
}

function insertTask(
  projectId: string,
  name: string,
  values: Partial<typeof tasks.$inferInsert> = {},
) {
  return getDatabase()
    .insert(tasks)
    .values({
      projectId,
      name,
      ...values,
    })
    .returning()
    .get()
}

function insertChat(values: Partial<typeof chats.$inferInsert>) {
  return getDatabase().insert(chats).values(values).returning().get()
}

describe("permanent chat deletion", () => {
  it("preserves metadata when worktree cleanup fails so deletion can be retried", async () => {
    const project = insertProject("delete-retry-project")
    const chat = insertChat({
      scope: "project",
      projectId: project.id,
      name: "Retry deletion",
      worktreePath: join(homeDir, "delete-retry-worktree"),
      branch: "flapstack/retry",
    })
    vi.mocked(removeWorktree).mockResolvedValue({ success: false, error: "worktree busy" })

    await expect(chatsRouter.createCaller(ctx).delete({ id: chat.id })).rejects.toThrow(
      /chat was not deleted/i,
    )
    expect(getDatabase().select().from(chats).where(eq(chats.id, chat.id)).get()).toBeDefined()
  })
})

describe("top-level chat forks", () => {
  it("keeps a pending Codex rewind from copying the native session into a fork", async () => {
    const db = getDatabase()
    const chat = insertChat({ scope: "global", harness: "codex" })
    const conversation = db
      .insert(subChats)
      .values({
        chatId: chat.id,
        harness: "codex",
        sessionId: "native-thread",
        messages: JSON.stringify([{ id: "selected", role: "user" }]),
        codexRewindIntent: JSON.stringify({
          messageId: "selected",
          threadId: "native-thread",
          targetId: "native-turn",
          headBefore: "native-turn",
          headAfter: null,
          transcriptHash: "fixture",
        }),
      })
      .returning()
      .get()

    await expect(
      chatsRouter.createCaller(ctx).forkSubChat({
        subChatId: conversation.id,
        messageId: "selected",
      }),
    ).rejects.toThrow(/pending Codex rewind/)
    expect(db.select().from(chats).all()).toHaveLength(1)
    expect(
      db.select().from(subChats).where(eq(subChats.sessionId, "native-thread")).all(),
    ).toHaveLength(1)
  })
})

it("rejects a delayed full transcript save that would erase a post-rewind turn", async () => {
  const db = getDatabase()
  const chat = insertChat({ scope: "global", harness: "codex" })
  const keep = { id: "kept", role: "user" }
  const conversation = db
    .insert(subChats)
    .values({
      chatId: chat.id,
      harness: "codex",
      messages: JSON.stringify([keep]),
      codexRewindDiscarded: JSON.stringify({
        messageIds: ["discarded"],
        runIds: ["discarded-run"],
      }),
    })
    .returning()
    .get()

  const caller = chatsRouter.createCaller(ctx)
  const continuation = JSON.stringify(
    [
      keep,
      { id: "next-user", role: "user" },
      { id: "next-assistant", role: "assistant", metadata: { runId: "next-run" } },
    ],
    null,
    2,
  )
  const saved = await caller.updateSubChatMessages({
    id: conversation.id,
    messages: continuation,
  })
  expect(saved?.messages).toBe(continuation)
  for (const stale of [
    { id: "discarded", role: "user" },
    { id: "alternate-assistant-id", role: "assistant", metadata: { runId: "discarded-run" } },
  ]) {
    await expect(
      caller.updateSubChatMessages({
        id: conversation.id,
        messages: JSON.stringify([keep, stale]),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
  }
  expect(db.select().from(subChats).where(eq(subChats.id, conversation.id)).get()?.messages).toBe(
    continuation,
  )
})

describe("Checkpoint capture and restore", () => {
  it("removes only marked abandoned private preparation files", async () => {
    const profile = join(homeDir, "warm-cleanup")
    mkdirSync(profile)
    function directory(suffix: string, marked: boolean, unrelated = false) {
      const name = "checkpoint-warm-2147483647-" + suffix,
        dir = join(profile, name)
      mkdirSync(dir)
      if (marked)
        writeFileSync(
          join(dir, ".flapstack-checkpoint-preparation"),
          "flapstack-checkpoint-preparation-v1\n" + name,
        )
      writeFileSync(join(dir, "a".repeat(64)), "private original")
      if (unrelated) writeFileSync(join(dir, "personal.txt"), "keep")
      return dir
    }
    const stale = directory("ABC123", true),
      unnamed = directory("DEF456", false),
      other = directory("GHI789", true, true)
    await sweepAbandonedCheckpointPreparations(profile)
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(unnamed)).toBe(true)
    expect(readFileSync(join(other, "personal.txt"), "utf8")).toBe("keep")
  })

  it("defers cleanup during capture in another connection or when a portability backup may own files", async () => {
    const db = getDatabase()
    leaseCheckpointFiles(db)()
    const store = join(userDataDir, "checkpoint-files")
    mkdirSync(store)
    const key = "a".repeat(64)
    writeFileSync(join(store, key), "not yet published")
    writeFileSync(join(store, "unrecognized"), "leave alone")
    const writer = new Database(join(userDataDir, "agents.db"))
    try {
      const release = leaseCheckpointFiles(drizzle(writer, { schema: dbSchema }))
      try {
        expect(await reclaimCheckpointFiles(db)).toBe(0)
      } finally {
        release()
      }
      expect(readFileSync(join(store, key), "utf8")).toBe("not yet published")
    } finally {
      writer.close()
    }
    const backup = join(userDataDir, "portability", "operations")
    mkdirSync(backup, { recursive: true })
    expect(await reclaimCheckpointFiles(db)).toBe(0)
    rmSync(backup, { recursive: true })
    expect(await reclaimCheckpointFiles(db)).toBe(1)
    expect(readFileSync(join(store, "unrecognized"), "utf8")).toBe("leave alone")
  })

  it("reclaims only original versions unreferenced after permanent chat deletion", async () => {
    const db = getDatabase()
    const work = join(homeDir, "retention-repo")
    mkdirSync(work)
    execFileSync("git", ["init", "-q"], { cwd: work })
    const project = insertProject("Retention", { path: work })
    const kept = insertChat({ projectId: project.id, name: "Kept" })
    const removed = insertChat({ projectId: project.id, name: "Removed" })
    const run = (chatId: string) =>
      db
        .insert(agentRuns)
        .values({ chatId, harness: "codex", permissionMode: "full-access", worktreePath: work })
        .returning()
        .get()
    const a = run(kept.id),
      b = run(removed.id)
    const original = join(work, "binary")
    const files = join(userDataDir, "checkpoint-files")
    const stored = () =>
      readdirSync(files)
        .map((name) => statSync(join(files, name)).size)
        .sort((a, b) => a - b)
    writeFileSync(original, Buffer.alloc(8192, 1))
    const retained = await captureCheckpoint(a.id, work, "before")
    await captureCheckpoint(a.id, work, "after")
    await captureCheckpoint(b.id, work, "before")
    expect(stored()).toEqual([8192])
    writeFileSync(original, Buffer.alloc(10240, 2))
    await captureCheckpoint(b.id, work, "after")
    expect(stored()).toEqual([8192, 10240])
    const rewritten = run(removed.id)
    writeFileSync(original, Buffer.alloc(10240, 2))
    await captureCheckpoint(rewritten.id, work, "before")
    expect(stored()).toEqual([8192, 10240, 10240])
    db.update(agentRuns).set({ completedAt: new Date(), status: "success" }).run()
    await chatsRouter.createCaller(ctx).delete({ id: removed.id })
    expect(db.select().from(checkpoints).where(eq(checkpoints.runId, b.id)).all()).toHaveLength(0)
    expect(stored()).toEqual([8192])
    await restoreCheckpoint(retained.id)
    expect(readFileSync(original)).toEqual(Buffer.alloc(8192, 1))
  })

  it("retains clean HEAD directly and keeps excluded files and repos outside capture and undo", async () => {
    const db = getDatabase()
    const root = join(homeDir, "fast-head-repo")
    const nested = join(root, "nested [fixture]")
    const excludedFile = "notes/Local [Write].txt"
    mkdirSync(nested, { recursive: true })
    const fixture = createIsolatedTestGitEnvironment()
    function git(cwd: string, ...args: string[]) {
      return execFileSync("git", args, { cwd, env: fixture.env, encoding: "utf8" }).trim()
    }
    try {
      git(root, "init", "-q")
      git(root, "config", "core.autocrlf", "false")
      git(root, "config", "core.ignorecase", "false")
      writeFileSync(join(root, "tracked.txt"), "base\n")
      git(root, "add", ".")
      git(root, "commit", "-qm", "Base")
      git(nested, "init", "-q")
      writeFileSync(join(nested, "local.txt"), "nested change\n")
      mkdirSync(join(root, "notes"))
      writeFileSync(join(root, excludedFile), "excluded file\n")
      const exclusions = [
        process.platform === "win32" ? excludedFile.toLowerCase() : excludedFile,
        "nested [fixture]",
      ]
      const { id: projectId } = insertProject("Clean HEAD", { path: root })
      const chat = insertChat({ projectId, name: "Fast capture" })
      const run = db
        .insert(agentRuns)
        .values({
          chatId: chat.id,
          harness: "codex",
          permissionMode: "full-access",
          worktreePath: root,
        })
        .returning()
        .get()
      const tree = git(root, "rev-parse", "HEAD^{tree}")
      const indexPath = git(root, "rev-parse", "--path-format=absolute", "--git-path", "index")
      const originalIndex = readFileSync(indexPath)
      expect(await resolveCleanHead(root)).toBeNull()
      expect(await resolveCleanHead(root, exclusions)).toMatchObject({ tree })
      const before = await captureCheckpoint(run.id, root, "before", db, indexPath, exclusions)
      expect(JSON.parse(before.gitStatusJson!)).toEqual({
        available: true,
        files: {},
        treeCommit: tree,
        indexTree: tree,
        crlfPaths: [],
        excludePaths: exclusions,
      })
      expect(readFileSync(indexPath)).toEqual(originalIndex)

      writeFileSync(join(root, "tracked.txt"), "changed\n")
      writeFileSync(join(nested, "local.txt"), "later nested change\n")
      writeFileSync(join(root, excludedFile), "later excluded file\n")
      await captureCheckpoint(run.id, root, "after", db, indexPath, exclusions)
      const manifest = await captureRunManifest(run.id, db)
      expect(manifest.map((entry) => entry.filePath)).toEqual(["tracked.txt"])
      const otherFiles = ["notes/local w.txt", "local [write].txt"]
      for (const file of otherFiles) writeFileSync(join(root, file), "undo this file\n")
      await expect(restoreCheckpoint(before.id)).resolves.toBe(true)
      expect(readFileSync(join(root, "tracked.txt"), "utf8")).toBe("base\n")
      expect(readFileSync(join(nested, "local.txt"), "utf8")).toBe("later nested change\n")
      expect(readFileSync(join(root, excludedFile), "utf8")).toBe("later excluded file\n")
      for (const file of otherFiles) expect(existsSync(join(root, file))).toBe(false)

      git(root, "update-index", "--assume-unchanged", "tracked.txt")
      writeFileSync(join(root, "tracked.txt"), "hidden\n")
      expect(await resolveCleanHead(root, exclusions)).toBeNull()
      await expect(
        captureCheckpoint(run.id, root, "before", db, indexPath, ["tracked.txt"]),
      ).rejects.toThrow("outside tracked paths")
    } finally {
      fixture.cleanup()
    }
  })

  it("restores the exact pre-run worktree and index", async () => {
    const db = getDatabase()
    const worktreePath = join(homeDir, "editable-repo")
    mkdirSync(worktreePath, { recursive: true })
    execFileSync("git", ["init"], { cwd: worktreePath })
    execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: worktreePath })
    writeFileSync(join(worktreePath, "tracked.txt"), "base\n")
    execFileSync("git", ["add", "tracked.txt"], { cwd: worktreePath })
    const isolatedGit = createIsolatedTestGitEnvironment()
    try {
      execFileSync("git", ["commit", "-m", "base"], {
        cwd: worktreePath,
        env: isolatedGit.env,
      })
    } finally {
      isolatedGit.cleanup()
    }

    writeFileSync(join(worktreePath, "tracked.txt"), "staged\n")
    execFileSync("git", ["add", "tracked.txt"], { cwd: worktreePath })
    writeFileSync(join(worktreePath, "tracked.txt"), "unstaged\n")
    writeFileSync(join(worktreePath, "preexisting-untracked.txt"), "keep\n")

    const project = insertProject("editable-project", { path: worktreePath })
    const chat = insertChat({
      scope: "project",
      projectId: project.id,
      name: "Editable chat",
      worktreePath,
    })
    const run = db
      .insert(agentRuns)
      .values({
        chatId: chat.id,
        harness: "codex",
        permissionMode: "ask-before-edits",
        worktreePath,
      })
      .returning()
      .get()
    const checkpoint = await captureCheckpoint(run.id, worktreePath, "before")

    writeFileSync(join(worktreePath, "tracked.txt"), "agent edit\n")
    writeFileSync(join(worktreePath, "agent-created.txt"), "remove\n")
    execFileSync("git", ["add", "-A"], { cwd: worktreePath })

    await restoreCheckpoint(checkpoint.id)

    expect(readFileSync(join(worktreePath, "tracked.txt"), "utf8")).toBe("unstaged\n")
    expect(readFileSync(join(worktreePath, "preexisting-untracked.txt"), "utf8")).toBe("keep\n")
    expect(existsSync(join(worktreePath, "agent-created.txt"))).toBe(false)
    expect(
      execFileSync("git", ["show", ":tracked.txt"], { cwd: worktreePath, encoding: "utf8" }),
    ).toBe("staged\n")

    const brokenCheckpoint = await captureCheckpoint(run.id, worktreePath, "after")
    execFileSync(
      "git",
      ["update-ref", "-d", `refs/flapstack/checkpoint-indexes/${brokenCheckpoint.id}`],
      { cwd: worktreePath },
    )
    writeFileSync(join(worktreePath, "tracked.txt"), "live state\n")
    execFileSync("git", ["add", "tracked.txt"], { cwd: worktreePath })
    writeFileSync(join(worktreePath, "live-untracked.txt"), "live\n")
    const statusBeforeFailedRestore = execFileSync("git", ["status", "--porcelain=v1"], {
      cwd: worktreePath,
      encoding: "utf8",
    })

    await expect(restoreCheckpoint(brokenCheckpoint.id)).rejects.toThrow()
    expect(
      execFileSync("git", ["status", "--porcelain=v1"], {
        cwd: worktreePath,
        encoding: "utf8",
      }),
    ).toBe(statusBeforeFailedRestore)
    expect(readFileSync(join(worktreePath, "tracked.txt"), "utf8")).toBe("live state\n")
    expect(readFileSync(join(worktreePath, "live-untracked.txt"), "utf8")).toBe("live\n")
  })

  it("does not reconstruct an interrupted postimage from the checkout on restart", async () => {
    const db = getDatabase()
    const chat = insertChat({ scope: "global", name: "Interrupted final image" })
    const run = db
      .insert(agentRuns)
      .values({ chatId: chat.id, harness: "codex", permissionMode: "full-access" })
      .returning()
      .get()
    db.update(agentRuns)
      .set({ status: "success", completedAt: new Date() })
      .where(eq(agentRuns.id, run.id))
      .run()
    db.run(
      sql`INSERT INTO agent_run_timing_marks(run_id,phase,at_ms) VALUES(${run.id},'undo-requested',1)`,
    )
    await expect(undoRunChangeSet(run.id)).rejects.toThrow("final state could not be verified")
    expect(db.select().from(checkpoints).where(eq(checkpoints.runId, run.id)).all()).toEqual([])
  })

  it("reviews and undoes physical CRLF, mixed endings and staged files without losing later edits", async () => {
    const root = join(homeDir, "newline-repo")
    mkdirSync(root)
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root })
    const write = (name: string, bytes: string) => writeFileSync(join(root, name), bytes)
    const read = (name: string) => readFileSync(join(root, name), "utf8")
    git("init")
    git("config", "core.autocrlf", "true")
    write(".gitattributes", "*.txt text\nencoded.dat working-tree-encoding=UTF-16LE text\n")
    const encoded = Buffer.from("encoded\r\n", "utf16le")
    writeFileSync(join(root, "encoded.dat"), encoded)
    write("clean.txt", "base\r\nkeep\r\n")
    write("eol.txt", "line\r\n")
    write("untouched.txt", "leave\r\n")
    write("mixed.txt", "left\r\nmiddle\nend\r\n")
    write("staged.txt", "index\r\n")
    git("add", "-A")
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "initial")
    write("staged.txt", "staged\r\n")
    git("add", "staged.txt")
    write("staged.txt", "unstaged\nsecond\r\n")
    const db = getDatabase(),
      project = insertProject("newline-project", { path: root })
    const chat = insertChat({
      scope: "project",
      projectId: project.id,
      name: "Newlines",
      worktreePath: root,
    })
    const run = db
      .insert(agentRuns)
      .values({
        chatId: chat.id,
        harness: "codex",
        permissionMode: "full-access",
        worktreePath: root,
      })
      .returning()
      .get()
    await captureCheckpoint(run.id, root, "before")
    const json = '{\r\n  "value": "from response"\r\n}\r\n'
    write("new.json", json)
    write("clean.txt", "changed\r\nkeep\r\n")
    write("mixed.txt", "changed\r\nmiddle\nend\r\n")
    writeFileSync(join(root, "encoded.dat"), Buffer.from("edited\r\n", "utf16le"))
    write("eol.txt", "line\n")
    write("staged.txt", "response\r\n")
    write("untouched.txt", "leave\r\n")
    await captureCheckpoint(run.id, root, "after")
    const files = await captureRunManifest(run.id)
    expect(files.map((f) => f.filePath).sort()).toEqual([
      "clean.txt",
      "encoded.dat",
      "eol.txt",
      "mixed.txt",
      "new.json",
      "staged.txt",
    ])
    const review = await getRunChangeReview(run.id)
    expect(review.diff).toContain("from response")
    write("new.json", json.replaceAll("\r\n", "\n"))
    expect(await undoRunChangeSet(run.id)).toMatchObject({
      success: false,
      conflicts: [{ filePath: "new.json" }],
    })
    expect(read("clean.txt")).toBe("changed\r\nkeep\r\n")
    write("new.json", json)
    const undone = await undoRunChangeSet(run.id)
    expect(undone.success).toBe(true)
    if (!undone.success || !("recoveryCommit" in undone))
      throw Error("Expected a new recovery commit")
    expect(git("show", undone.recoveryCommit + ":new.json").toString()).toBe(json)
    expect(existsSync(join(root, "new.json"))).toBe(false)
    expect(read("clean.txt")).toBe("base\r\nkeep\r\n")
    expect(read("mixed.txt")).toBe("left\r\nmiddle\nend\r\n")
    expect(read("eol.txt")).toBe("line\r\n")
    expect(readFileSync(join(root, "encoded.dat"))).toEqual(encoded)
    expect(read("staged.txt")).toBe("unstaged\nsecond\r\n")
    expect(git("show", ":staged.txt").toString()).toBe("staged\n")
    expect((await getRunChangeReview(run.id)).diff).toBe(review.diff)
  })

  it("stores unavailable non-git checkpoints and creates an explicit no-change manifest", async () => {
    const db = getDatabase()
    const worktreePath = join(homeDir, "not-a-git-repo")
    mkdirSync(worktreePath, { recursive: true })
    const project = insertProject("checkpoint-project")
    const chat = insertChat({ scope: "project", projectId: project.id, name: "Checkpoint chat" })
    const run = db
      .insert(agentRuns)
      .values({
        chatId: chat.id,
        harness: "codex",
        permissionMode: "ask-before-edits",
        worktreePath,
      })
      .returning()
      .get()

    const before = await captureCheckpoint(run.id, worktreePath, "before")
    const after = await captureCheckpoint(run.id, worktreePath, "after")
    const manifest = await captureRunManifest(run.id)

    expect(before).toMatchObject({ runId: run.id, kind: "before", worktreePath, gitCommit: null })
    expect(after).toMatchObject({ runId: run.id, kind: "after", worktreePath, gitCommit: null })
    expect(JSON.parse(before.gitStatusJson ?? "{}")).toMatchObject({
      available: false,
      error: "Worktree is not a git repository",
      files: {},
    })
    expect(manifest).toEqual([
      expect.objectContaining({
        runId: run.id,
        filePath: "",
        changeType: "none",
        additions: 0,
        deletions: 0,
        beforeHash: null,
        afterHash: null,
      }),
    ])
    expect(db.select().from(checkpoints).where(eq(checkpoints.runId, run.id)).all()).toHaveLength(2)
    expect(
      db.select().from(fileChangeManifests).where(eq(fileChangeManifests.runId, run.id)).all(),
    ).toHaveLength(1)
  })
})
