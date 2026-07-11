import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { eq, sql } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  agentRuns,
  attachments,
  chats,
  checkpoints,
  closeDatabase,
  fileChangeManifests,
  getDatabase,
  projects,
  subChats,
  tasks,
} from "../src/main/lib/db"
import { captureCheckpoint, captureRunManifest } from "../src/main/lib/checkpoints"
import { chatsRouter } from "../src/main/lib/trpc/routers/chats"
import { permissionsRouter } from "../src/main/lib/trpc/routers/permissions"
import { searchRouter } from "../src/main/lib/trpc/routers/search"
import { tasksRouter } from "../src/main/lib/trpc/routers/tasks"
import { listWorktreeOptions, resolveDefaultWorktree } from "../src/main/lib/worktree-resolver"
import { createWorktree } from "../src/main/lib/git/worktree"

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
  createTestSchema()
})

afterEach(() => {
  closeDatabase()
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
      pinned_at integer,
      archived_at integer
    )`,
    `CREATE TABLE tasks (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL REFERENCES projects(id) ON DELETE cascade,
      name text NOT NULL,
      description text,
      status text DEFAULT 'active' NOT NULL,
      default_permission_mode text DEFAULT 'ask-before-edits' NOT NULL,
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
      harness text,
      model text,
      created_at integer,
      updated_at integer,
      archived_at integer,
      pinned_at integer,
      worktree_path text,
      branch text,
      base_branch text,
      pr_url text,
      pr_number integer
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
    `CREATE TABLE agent_runs (
      id text PRIMARY KEY NOT NULL,
      chat_id text NOT NULL REFERENCES chats(id) ON DELETE cascade,
      sub_chat_id text REFERENCES sub_chats(id) ON DELETE set null,
      harness text NOT NULL,
      model text,
      permission_mode text NOT NULL,
      worktree_path text,
      prompt_message_id text,
      status text DEFAULT 'running' NOT NULL,
      started_at integer,
      completed_at integer,
      before_checkpoint_id text,
      after_checkpoint_id text
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
      stored_path text,
      content_text text,
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

describe("Stage 1 E1 scope lifecycle", () => {
  it("creates, lists, validates, and moves project/task/global chats", async () => {
    const db = getDatabase()
    const project = insertProject("alpha", { defaultPermissionMode: "read-only" })
    const otherProject = insertProject("beta")
    const taskCaller = tasksRouter.createCaller(ctx)
    const chatCaller = chatsRouter.createCaller(ctx)

    const task = await taskCaller.create({
      projectId: project.id,
      name: "Build parser",
      description: "scope lifecycle task",
    })
    expect(task.defaultPermissionMode).toBe("read-only")

    db.update(projects)
      .set({ defaultPermissionMode: "full-access" })
      .where(eq(projects.id, project.id))
      .run()
    const laterTask = await taskCaller.create({ projectId: project.id, name: "New default task" })
    expect(laterTask.defaultPermissionMode).toBe("full-access")
    expect(db.select().from(tasks).where(eq(tasks.id, task.id)).get()?.defaultPermissionMode).toBe(
      "read-only",
    )

    const globalChat = await chatCaller.create({
      scope: "global",
      name: "Global notes",
      useWorktree: false,
    })
    expect(globalChat).toMatchObject({ scope: "global", projectId: null, taskId: null })

    const projectChat = await chatCaller.create({
      scope: "project",
      projectId: project.id,
      name: "Project notes",
      useWorktree: false,
    })
    expect(projectChat).toMatchObject({
      scope: "project",
      projectId: project.id,
      taskId: null,
      permissionMode: "full-access",
      worktreePath: project.path,
    })

    const taskChat = await chatCaller.create({
      scope: "task",
      taskId: task.id,
      name: "Task notes",
      useWorktree: false,
    })
    expect(taskChat).toMatchObject({
      scope: "task",
      projectId: project.id,
      taskId: task.id,
      permissionMode: "read-only",
      worktreePath: project.path,
    })

    await expect(
      chatCaller.create({
        scope: "global",
        projectId: project.id,
        name: "Invalid global",
        useWorktree: false,
      }),
    ).rejects.toThrow("Global chats cannot have projectId or taskId")
    await expect(
      chatCaller.create({ scope: "project", name: "Invalid project", useWorktree: false }),
    ).rejects.toThrow("Project chats require projectId and cannot have taskId")
    await expect(
      chatCaller.create({
        scope: "task",
        projectId: otherProject.id,
        taskId: task.id,
        name: "Invalid task project",
        useWorktree: false,
      }),
    ).rejects.toThrow("Task does not belong to project")

    expect((await chatCaller.list({ scope: "global" })).map((chat) => chat.id)).toEqual([
      globalChat.id,
    ])
    expect(
      (await chatCaller.list({ projectId: project.id })).map((chat) => chat.id).sort(),
    ).toEqual([projectChat.id, taskChat.id].sort())
    expect((await taskCaller.listChats({ taskId: task.id })).map((chat) => chat.id)).toEqual([
      taskChat.id,
    ])

    const movedToTask = await chatCaller.move({
      id: projectChat.id,
      scope: "task",
      taskId: task.id,
    })
    expect(movedToTask).toMatchObject({
      scope: "task",
      projectId: project.id,
      taskId: task.id,
      worktreePath: project.path,
    })

    const movedToProject = await chatCaller.move({
      id: projectChat.id,
      scope: "project",
      projectId: project.id,
    })
    expect(movedToProject).toMatchObject({
      scope: "project",
      projectId: project.id,
      taskId: null,
      worktreePath: project.path,
    })

    const movedAcrossProjects = await chatCaller.move({
      id: projectChat.id,
      scope: "project",
      projectId: otherProject.id,
    })
    expect(movedAcrossProjects).toMatchObject({
      scope: "project",
      projectId: otherProject.id,
      taskId: null,
      worktreePath: otherProject.path,
      branch: null,
    })

    await chatCaller.move({
      id: projectChat.id,
      scope: "project",
      projectId: project.id,
    })

    const movedDefaultToGlobal = await chatCaller.move({
      id: projectChat.id,
      scope: "global",
    })
    expect(movedDefaultToGlobal).toMatchObject({
      scope: "global",
      projectId: null,
      taskId: null,
      worktreePath: null,
      branch: null,
    })

    const customWorktreePath = join(homeDir, "explicit-custom-worktree")
    const customChat = insertChat({
      scope: "project",
      projectId: project.id,
      name: "Custom checkout",
      worktreePath: customWorktreePath,
      branch: "custom/test",
    })
    const movedCustomToGlobal = await chatCaller.move({ id: customChat.id, scope: "global" })
    expect(movedCustomToGlobal).toMatchObject({
      scope: "global",
      projectId: null,
      taskId: null,
      worktreePath: customWorktreePath,
      branch: "custom/test",
    })

    const movedCustomToProject = await chatCaller.move({
      id: customChat.id,
      scope: "project",
      projectId: otherProject.id,
    })
    expect(movedCustomToProject).toMatchObject({
      scope: "project",
      projectId: otherProject.id,
      taskId: null,
      worktreePath: customWorktreePath,
      branch: "custom/test",
    })

    const generatedChat = insertChat({
      scope: "project",
      projectId: project.id,
      name: "Generated checkout",
      worktreePath: join(homedir(), ".flapstack", "worktrees", "project", "generated-chat"),
      branch: "flapstack/generated-chat",
      baseBranch: "main",
    })
    const movedGenerated = await chatCaller.move({
      id: generatedChat.id,
      scope: "project",
      projectId: otherProject.id,
    })
    expect(movedGenerated).toMatchObject({
      projectId: otherProject.id,
      worktreePath: otherProject.path,
      branch: null,
      baseBranch: null,
    })
  })

  it("persists chat permission selector changes and resolves them for launches", async () => {
    const project = insertProject("permissions", { defaultPermissionMode: "read-only" })
    const chat = insertChat({
      scope: "project",
      projectId: project.id,
      name: "Permission chat",
      permissionMode: "read-only",
    })
    const caller = permissionsRouter.createCaller(ctx)

    expect(await caller.resolveForChat({ chatId: chat.id })).toMatchObject({
      mode: "read-only",
      source: "chat",
    })

    await caller.setChatMode({ chatId: chat.id, mode: "auto-edit-project-only" })

    expect(getDatabase().select().from(chats).where(eq(chats.id, chat.id)).get()).toMatchObject({
      permissionMode: "auto-edit-project-only",
    })
    expect(await caller.resolveForChat({ chatId: chat.id })).toMatchObject({
      mode: "auto-edit-project-only",
      source: "chat",
    })
  })
})

describe("Stage 1 E1 worktree resolution", () => {
  it("resolves global, project, task primary, and selected worktree options", () => {
    const project = insertProject("worktrees")
    const task = insertTask(project.id, "Primary task", {
      primaryWorktreePath: join(homeDir, "task-primary"),
      primaryBranch: "task/primary-task",
    })
    const globalChat = insertChat({ scope: "global", name: "Global" })
    const projectChat = insertChat({
      scope: "project",
      projectId: project.id,
      name: "Project",
      worktreePath: join(homeDir, "custom-project-worktree"),
    })
    const taskChat = insertChat({
      scope: "task",
      projectId: project.id,
      taskId: task.id,
      name: "Task",
    })

    expect(resolveDefaultWorktree(globalChat)).toBeNull()
    expect(listWorktreeOptions(globalChat.id)).toEqual([])

    expect(resolveDefaultWorktree(projectChat)).toBe(project.path)
    expect(listWorktreeOptions(projectChat.id)).toEqual([
      { path: project.path, label: "Project checkout", kind: "project", isDefault: true },
      {
        path: join(homeDir, "custom-project-worktree"),
        label: "Selected worktree",
        kind: "custom",
        isDefault: false,
      },
    ])

    expect(resolveDefaultWorktree(taskChat)).toBe(task.primaryWorktreePath)
    expect(listWorktreeOptions(taskChat.id)).toEqual([
      { path: project.path, label: "Project checkout", kind: "project", isDefault: false },
      {
        path: task.primaryWorktreePath,
        label: "Task worktree",
        kind: "task",
        isDefault: true,
      },
    ])
  })

  it("uses task ids in primary worktree branch and path slugs to avoid name collisions", async () => {
    const project = insertProject("collision-worktrees")
    const firstTask = insertTask(project.id, "Same task")
    const secondTask = insertTask(project.id, "Same task")
    const caller = tasksRouter.createCaller(ctx)

    const first = await caller.ensurePrimaryWorktree({ id: firstTask.id })
    const second = await caller.ensurePrimaryWorktree({ id: secondTask.id })

    expect(first.primaryBranch).not.toBe(second.primaryBranch)
    expect(first.primaryWorktreePath).not.toBe(second.primaryWorktreePath)
    expect(first.primaryBranch).toContain(firstTask.id.slice(-8))
    expect(second.primaryBranch).toContain(secondTask.id.slice(-8))
    expect(vi.mocked(createWorktree)).toHaveBeenCalledTimes(2)
  })
})

describe("Stage 1 E1 search archive and scope filters", () => {
  it("searches scoped projects, tasks, chats, messages, and attachments with archived handling", async () => {
    const db = getDatabase()
    const activeProject = insertProject("needle active project")
    const otherProject = insertProject("needle other project")
    const archivedProject = insertProject("needle archived project", { archivedAt: new Date() })
    const activeTask = insertTask(activeProject.id, "needle active task", {
      description: "needle task description",
    })
    const archivedTask = insertTask(activeProject.id, "needle archived task", {
      archivedAt: new Date(),
    })
    const childOfArchivedProject = insertTask(archivedProject.id, "needle hidden parent task")
    const projectChat = insertChat({
      scope: "project",
      projectId: activeProject.id,
      name: "needle project chat",
    })
    const taskChat = insertChat({
      scope: "task",
      projectId: activeProject.id,
      taskId: activeTask.id,
      name: "needle task chat",
    })
    const otherProjectChat = insertChat({
      scope: "project",
      projectId: otherProject.id,
      name: "needle other project chat",
    })
    const archivedChat = insertChat({
      scope: "project",
      projectId: activeProject.id,
      name: "needle archived chat",
      archivedAt: new Date(),
    })
    const childOfArchivedTaskChat = insertChat({
      scope: "task",
      projectId: activeProject.id,
      taskId: archivedTask.id,
      name: "needle hidden task-parent chat",
    })
    const childOfArchivedProjectChat = insertChat({
      scope: "task",
      projectId: archivedProject.id,
      taskId: childOfArchivedProject.id,
      name: "needle hidden project-parent chat",
    })

    const messageSubChat = db
      .insert(subChats)
      .values({ chatId: taskChat.id, messages: "needle message body" })
      .returning()
      .get()
    db.insert(subChats)
      .values({ chatId: archivedChat.id, messages: "needle archived chat message" })
      .run()
    db.insert(subChats)
      .values({ chatId: childOfArchivedTaskChat.id, messages: "needle archived task message" })
      .run()
    db.insert(subChats)
      .values({
        chatId: childOfArchivedProjectChat.id,
        messages: "needle archived project message",
      })
      .run()
    db.insert(attachments)
      .values({
        chatId: taskChat.id,
        taskId: activeTask.id,
        kind: "text",
        name: "needle active attachment",
        contentText: "needle attachment text",
      })
      .run()
    db.insert(attachments)
      .values({
        chatId: archivedChat.id,
        kind: "text",
        name: "needle archived chat attachment",
      })
      .run()
    db.insert(attachments)
      .values({
        chatId: childOfArchivedTaskChat.id,
        taskId: archivedTask.id,
        kind: "text",
        name: "needle archived task attachment",
      })
      .run()

    const caller = searchRouter.createCaller(ctx)
    const allActive = await caller.query({ query: "needle" })
    const allActiveKeys = allActive.map((result) => `${result.type}:${result.title}`).sort()

    expect(allActiveKeys).toEqual([
      "attachment:needle active attachment",
      "chat:needle other project chat",
      "chat:needle project chat",
      "chat:needle task chat",
      "message:needle task chat",
      "project:needle active project",
      "project:needle other project",
      "task:needle active task",
    ])
    expect(allActive).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "needle archived chat" }),
        expect.objectContaining({ title: "needle hidden task-parent chat" }),
        expect.objectContaining({ title: "needle hidden project-parent chat" }),
      ]),
    )

    const projectScoped = await caller.query({
      query: "needle",
      scope: "project",
      scopeId: activeProject.id,
    })
    expect(projectScoped.map((result) => `${result.type}:${result.title}`).sort()).toEqual([
      "attachment:needle active attachment",
      "chat:needle project chat",
      "chat:needle task chat",
      "message:needle task chat",
      "task:needle active task",
    ])
    expect(projectScoped).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ projectId: otherProject.id })]),
    )

    const taskScoped = await caller.query({
      query: "needle",
      scope: "task",
      scopeId: activeTask.id,
    })
    expect(taskScoped.map((result) => `${result.type}:${result.title}`).sort()).toEqual([
      "attachment:needle active attachment",
      "chat:needle task chat",
      "message:needle task chat",
    ])

    const chatScoped = await caller.query({
      query: "needle",
      scope: "chat",
      scopeId: taskChat.id,
    })
    expect(chatScoped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "chat", chatId: taskChat.id }),
        expect.objectContaining({
          type: "message",
          chatId: taskChat.id,
          subChatId: messageSubChat.id,
        }),
        expect.objectContaining({ type: "attachment", chatId: taskChat.id }),
      ]),
    )

    const withArchived = await caller.query({ query: "needle", includeArchived: true })
    expect(withArchived).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "project", title: "needle archived project" }),
        expect.objectContaining({ type: "task", title: "needle archived task" }),
        expect.objectContaining({ type: "task", title: "needle hidden parent task" }),
        expect.objectContaining({ type: "chat", title: "needle archived chat" }),
        expect.objectContaining({ type: "chat", title: "needle hidden task-parent chat" }),
        expect.objectContaining({ type: "chat", title: "needle hidden project-parent chat" }),
      ]),
    )

    const archivedProjectScope = await caller.query({
      query: "needle",
      scope: "project",
      scopeId: archivedProject.id,
      includeArchived: true,
    })
    expect(archivedProjectScope.map((result) => `${result.type}:${result.title}`).sort()).toEqual([
      "chat:needle hidden project-parent chat",
      "message:needle hidden project-parent chat",
      "task:needle hidden parent task",
    ])
  })

  it("post-filters message JSON candidates to text parts and returns clean snippets", async () => {
    const db = getDatabase()
    const project = insertProject("json-search-project")
    const chat = insertChat({
      scope: "project",
      projectId: project.id,
      name: "JSON search chat",
    })
    const falsePositive = db
      .insert(subChats)
      .values({
        chatId: chat.id,
        messages: JSON.stringify([
          {
            role: "assistant",
            metadata: { model: "jsonneedle-model" },
            parts: [{ type: "text", text: "metadata only" }],
          },
        ]),
      })
      .returning()
      .get()
    const nonArrayPayload = db
      .insert(subChats)
      .values({
        chatId: chat.id,
        messages: JSON.stringify({ metadata: { hidden: "jsonneedle" } }),
      })
      .returning()
      .get()
    const malformedPayload = db
      .insert(subChats)
      .values({ chatId: chat.id, messages: '{"metadata":"jsonneedle"' })
      .returning()
      .get()
    const trueMatch = db
      .insert(subChats)
      .values({
        chatId: chat.id,
        messages: JSON.stringify([
          {
            id: "message-jsonneedle",
            role: "assistant",
            metadata: { model: "other-model" },
            parts: [{ type: "text", text: "actual jsonneedle message body" }],
          },
        ]),
      })
      .returning()
      .get()
    const legacyReasoningMatch = db
      .insert(subChats)
      .values({
        chatId: chat.id,
        messages: JSON.stringify([
          {
            id: "message-legacy-reasoning",
            role: "assistant",
            parts: [
              { type: "tool-ReasoningOutput", input: { text: "legacy jsonneedle reasoning" } },
              { type: "tool-Bash", input: { command: "hidden jsonneedle command" } },
            ],
          },
        ]),
      })
      .returning()
      .get()

    const results = await searchRouter.createCaller(ctx).query({ query: "jsonneedle" })

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "message",
          chatId: chat.id,
          subChatId: trueMatch.id,
          messageId: "message-jsonneedle",
          snippet: "actual jsonneedle message body",
        }),
        expect.objectContaining({
          type: "message",
          chatId: chat.id,
          subChatId: legacyReasoningMatch.id,
          messageId: "message-legacy-reasoning",
          snippet: "legacy jsonneedle reasoning",
        }),
      ]),
    )
    expect(results).toHaveLength(2)
    expect(results).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subChatId: falsePositive.id }),
        expect.objectContaining({ subChatId: nonArrayPayload.id }),
        expect.objectContaining({ subChatId: malformedPayload.id }),
        expect.objectContaining({
          type: "message",
          chatId: chat.id,
          subChatId: legacyReasoningMatch.id,
          snippet: expect.stringContaining("hidden jsonneedle command"),
        }),
      ]),
    )
  })
})

describe("Stage 1 E1 checkpoint capture", () => {
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
