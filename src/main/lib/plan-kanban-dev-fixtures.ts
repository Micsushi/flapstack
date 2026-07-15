import { createHash, randomUUID } from "node:crypto"
import { constants, realpathSync } from "node:fs"
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rmdir,
  unlink,
  type FileHandle,
} from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import type Database from "better-sqlite3"
import type { ProjectPlanSourceConfig } from "./plan-sources"
import { readProjectPlanSources } from "./plan-sources"
import { openAppDatabase } from "./db/access"
import { TaskProposalService } from "./task-proposals"

export const DEV_PLAN_MARKDOWN_PATH = ".flapstack/dev-fixtures/plan-kanban/plan.md"
export const DEV_PLAN_OPENSPEC_ROOT = "openspec/changes/flapstack-dev-plan-kanban-fixture"

const DEV_PLAN_OPENSPEC_TASKS_PATH = `${DEV_PLAN_OPENSPEC_ROOT}/tasks.md`
const DEV_PROPOSER_CHAT_NAME = "[Dev fixture] Plan and Kanban proposals"
const MARKDOWN_CANDIDATE_TITLE = "Review Markdown fixture candidate"
const OPENSPEC_CANDIDATE_TITLE = "Review OpenSpec fixture candidate"
const MARKDOWN_PROPOSAL_NAME = "[Dev] Review Markdown plan candidate"
const MARKDOWN_PROPOSAL_DESCRIPTION =
  "Review this inert proposal, then approve or deny it from the Tasks board."
const OPENSPEC_PROPOSAL_NAME = "[Dev] Review OpenSpec plan candidate"
const OPENSPEC_PROPOSAL_DESCRIPTION =
  "Approve only after checking the exact task and idle-chat preview."
const FIXTURE_SOURCE_PATHS = [DEV_PLAN_MARKDOWN_PATH, DEV_PLAN_OPENSPEC_TASKS_PATH] as const

type FixtureRevision = 1 | 2
type Row = Record<string, unknown>

export type PlanKanbanDevFixtureStatus = {
  state: "absent" | "ready" | "advanced" | "collision"
  revision: FixtureRevision | null
  message: string
  markdownRegistered: boolean
  proposalCount: number
  taskCount: number
}

export type PlanKanbanDevFixtureCreateHooks = {
  afterRegistration?: () => void
  readPlanSources?: typeof readProjectPlanSources
  afterFirstProposal?: () => void
}

type FilesystemInspection = {
  state: "absent" | "ready" | "advanced" | "collision"
  revision: FixtureRevision | null
  message: string
  presentPaths: string[]
}

export async function getPlanKanbanDevFixtureStatus(
  databasePath: string,
  config: ProjectPlanSourceConfig,
): Promise<PlanKanbanDevFixtureStatus> {
  const filesystem = await inspectFixtureFilesystem(config, false)
  const database = inspectFixtureDatabase(databasePath, config.projectId)
  const hasDatabaseState =
    database.markdownRegistered ||
    database.proposalCount > 0 ||
    database.taskCount > 0 ||
    database.hasChat
  const collision = filesystem.state === "collision" || database.collision
  if (collision) {
    return {
      state: "collision",
      revision: filesystem.revision,
      message: filesystem.state === "collision" ? filesystem.message : database.message,
      markdownRegistered: database.markdownRegistered,
      proposalCount: database.proposalCount,
      taskCount: database.taskCount,
    }
  }
  if ((filesystem.state === "absent") !== !hasDatabaseState) {
    return {
      state: "collision",
      revision: filesystem.revision,
      message: "Dev fixture filesystem and database state disagree. Reset before recreating it.",
      markdownRegistered: database.markdownRegistered,
      proposalCount: database.proposalCount,
      taskCount: database.taskCount,
    }
  }
  if (
    filesystem.state !== "absent" &&
    (!database.markdownRegistered || !database.hasChat || database.proposalCount !== 2)
  ) {
    return {
      state: "collision",
      revision: filesystem.revision,
      message: "Dev fixture database state is incomplete. Reset before recreating it.",
      markdownRegistered: database.markdownRegistered,
      proposalCount: database.proposalCount,
      taskCount: database.taskCount,
    }
  }
  return {
    state: filesystem.state,
    revision: filesystem.revision,
    message:
      filesystem.state === "absent"
        ? "No Dev Plan dataset is installed for this project."
        : filesystem.state === "advanced"
          ? "Fixture sources are on revision 2. Linked revision 1 work should show divergence."
          : "Fixture sources and inert proposals are ready for review.",
    markdownRegistered: database.markdownRegistered,
    proposalCount: database.proposalCount,
    taskCount: database.taskCount,
  }
}

export async function createPlanKanbanDevFixture(
  databasePath: string,
  config: ProjectPlanSourceConfig,
  hooks: PlanKanbanDevFixtureCreateHooks = {},
): Promise<PlanKanbanDevFixtureStatus> {
  const current = await getPlanKanbanDevFixtureStatus(databasePath, config)
  if (current.state === "ready" || current.state === "advanced") return current
  if (current.state === "collision") throw new Error(current.message)

  const files = fixtureFiles(config.projectId, 1)
  const createdFiles: string[] = []
  try {
    for (const relativePath of Object.keys(files)) {
      await ensureSafeDirectory(config.rootPath, dirname(relativePath))
      const absolutePath = join(config.rootPath, relativePath)
      await open(absolutePath, "wx").then(async (handle) => {
        try {
          await handle.writeFile(files[relativePath]!, "utf8")
          await handle.sync()
        } finally {
          await handle.close()
        }
      })
      createdFiles.push(relativePath)
    }
  } catch (error) {
    await cleanupCreatedFiles(config.rootPath, createdFiles)
    throw new Error(
      `Dev fixture creation stopped before overwriting a source collision: ${errorMessage(error)}`,
    )
  }

  const proposerChatId = devProposerChatId(config.projectId)
  try {
    const database = openAppDatabase(databasePath)
    try {
      database.pragma("foreign_keys = ON")
      const transaction = database.transaction(() => {
        const project = database
          .prepare(
            `SELECT id, path, default_permission_mode, default_custom_permissions
             FROM projects WHERE id = ? AND archived_at IS NULL`,
          )
          .get(config.projectId) as Row | undefined
        if (!project || resolve(realpathSync(String(project.path))) !== resolve(config.rootPath)) {
          throw new Error("Dev fixture project identity is missing or ambiguous.")
        }
        const existingRegistration = database
          .prepare(
            "SELECT id FROM plan_source_registrations WHERE project_id = ? AND relative_path = ?",
          )
          .get(config.projectId, DEV_PLAN_MARKDOWN_PATH)
        if (existingRegistration) throw new Error("Markdown fixture registration already exists.")
        database
          .prepare(
            `INSERT INTO plan_source_registrations
               (id, project_id, source_type, relative_path, created_at, updated_at)
             VALUES (?, ?, 'markdown', ?, ?, ?)`,
          )
          .run(
            stableId("dev-plan-registration", config.projectId),
            config.projectId,
            DEV_PLAN_MARKDOWN_PATH,
            Date.now(),
            Date.now(),
          )
        const existingChat = database
          .prepare("SELECT id FROM chats WHERE id = ?")
          .get(proposerChatId)
        if (existingChat) throw new Error("Dev proposal caller identity already exists.")
        database
          .prepare(
            `INSERT INTO chats (
               id, name, project_id, task_id, scope, permission_mode, custom_permissions,
               worktree_path, created_at, updated_at
             ) VALUES (?, ?, ?, NULL, 'project', ?, ?, ?, ?, ?)`,
          )
          .run(
            proposerChatId,
            DEV_PROPOSER_CHAT_NAME,
            config.projectId,
            String(project.default_permission_mode),
            project.default_custom_permissions ?? null,
            String(project.path),
            Date.now(),
            Date.now(),
          )
      })
      transaction.immediate()
    } finally {
      database.close()
    }
    hooks.afterRegistration?.()

    const snapshot = await (hooks.readPlanSources ?? readProjectPlanSources)({
      ...config,
      markdownPaths: [...new Set([...config.markdownPaths, DEV_PLAN_MARKDOWN_PATH])],
    })
    const markdownSource = snapshot.sources.find((source) => source.path === DEV_PLAN_MARKDOWN_PATH)
    const openSpecSource = snapshot.sources.find((source) => source.path === DEV_PLAN_OPENSPEC_ROOT)
    const markdownCandidate = markdownSource?.candidates.find(
      (candidate) => candidate.kind === "checklist" && candidate.title === MARKDOWN_CANDIDATE_TITLE,
    )
    const openSpecCandidate = openSpecSource?.candidates.find(
      (candidate) => candidate.kind === "task" && candidate.title === OPENSPEC_CANDIDATE_TITLE,
    )
    if (!markdownSource || !openSpecSource || !markdownCandidate || !openSpecCandidate) {
      throw new Error("Created Dev Plan sources did not parse into the expected candidates.")
    }

    const proposals = new TaskProposalService(databasePath)
    const actor = { type: "agent" as const, chatId: proposerChatId }
    proposals.propose(actor, {
      idempotencyKey: "markdown-candidate",
      proposal: {
        projectId: config.projectId,
        name: MARKDOWN_PROPOSAL_NAME,
        description: MARKDOWN_PROPOSAL_DESCRIPTION,
        targetStatus: "backlog",
        source: {
          sourceType: "markdown",
          sourcePath: markdownCandidate.path,
          sourceCandidateId: markdownCandidate.id,
          sourceFingerprint: markdownSource.fingerprint,
        },
      },
    })
    hooks.afterFirstProposal?.()
    proposals.propose(actor, {
      idempotencyKey: "openspec-candidate",
      proposal: {
        projectId: config.projectId,
        name: OPENSPEC_PROPOSAL_NAME,
        description: OPENSPEC_PROPOSAL_DESCRIPTION,
        targetStatus: "planned",
        source: {
          sourceType: "openspec",
          sourcePath: openSpecCandidate.path,
          sourceCandidateId: openSpecCandidate.id,
          sourceFingerprint: openSpecSource.fingerprint,
        },
      },
    })
  } catch (error) {
    await compensateFailedCreate(databasePath, config)
    throw error
  }

  return getPlanKanbanDevFixtureStatus(databasePath, config)
}

export async function advancePlanKanbanDevFixture(
  databasePath: string,
  config: ProjectPlanSourceConfig,
): Promise<PlanKanbanDevFixtureStatus> {
  const current = await getPlanKanbanDevFixtureStatus(databasePath, config)
  if (current.state === "advanced") return current
  if (current.state !== "ready") throw new Error(current.message)

  const before = fixtureFiles(config.projectId, 1)
  const after = fixtureFiles(config.projectId, 2)
  const handles: Array<{ relativePath: string; handle: FileHandle }> = []
  try {
    for (const relativePath of Object.keys(before)) {
      const handle = await open(
        join(config.rootPath, relativePath),
        constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
      )
      handles.push({ relativePath, handle })
    }
    for (const item of handles) {
      const content = await item.handle.readFile("utf8")
      if (content !== before[item.relativePath]) {
        throw new Error(`Fixture source changed before revision update: ${item.relativePath}`)
      }
    }
    for (const item of handles) {
      await item.handle.truncate(0)
      await item.handle.write(after[item.relativePath]!, 0, "utf8")
      await item.handle.sync()
    }
  } finally {
    await Promise.allSettled(handles.map(({ handle }) => handle.close()))
  }
  return getPlanKanbanDevFixtureStatus(databasePath, config)
}

export async function resetPlanKanbanDevFixture(
  databasePath: string,
  config: ProjectPlanSourceConfig,
): Promise<PlanKanbanDevFixtureStatus> {
  const filesystem = await inspectFixtureFilesystem(config, true)
  if (filesystem.state === "collision") throw new Error(filesystem.message)
  const databaseState = inspectFixtureDatabase(databasePath, config.projectId)
  if (databaseState.collision) throw new Error(databaseState.message)

  const database = openAppDatabase(databasePath)
  try {
    database.pragma("foreign_keys = ON")
    const transaction = database.transaction(() => {
      const latest = inspectFixtureDatabaseConnection(database, config.projectId)
      if (latest.collision) throw new Error(latest.message)
      const taskRows = database
        .prepare(
          `SELECT id FROM tasks
           WHERE project_id = ? AND source_path IN (?, ?)`,
        )
        .all(config.projectId, ...FIXTURE_SOURCE_PATHS) as Array<{ id: string }>
      for (const task of taskRows) database.prepare("DELETE FROM tasks WHERE id = ?").run(task.id)
      database
        .prepare("DELETE FROM task_proposals WHERE project_id = ? AND proposed_by_chat_id = ?")
        .run(config.projectId, devProposerChatId(config.projectId))
      database.prepare("DELETE FROM chats WHERE id = ?").run(devProposerChatId(config.projectId))
      database
        .prepare("DELETE FROM plan_source_registrations WHERE project_id = ? AND relative_path = ?")
        .run(config.projectId, DEV_PLAN_MARKDOWN_PATH)
    })
    transaction.immediate()
  } finally {
    database.close()
  }

  await quarantineAndDeleteFixtureFiles(config, filesystem.presentPaths)
  return getPlanKanbanDevFixtureStatus(databasePath, config)
}

function inspectFixtureDatabase(databasePath: string, projectId: string) {
  const database = openAppDatabase(databasePath)
  try {
    database.pragma("foreign_keys = ON")
    return inspectFixtureDatabaseConnection(database, projectId)
  } finally {
    database.close()
  }
}

function inspectFixtureDatabaseConnection(database: Database.Database, projectId: string) {
  const proposerChatId = devProposerChatId(projectId)
  const project = database
    .prepare(
      `SELECT path, default_permission_mode, default_custom_permissions
       FROM projects WHERE id = ? AND archived_at IS NULL`,
    )
    .get(projectId) as Row | undefined
  const chat = database.prepare("SELECT * FROM chats WHERE id = ?").get(proposerChatId) as
    Row | undefined
  if (
    chat &&
    (!project ||
      chat.project_id !== projectId ||
      chat.task_id !== null ||
      chat.scope !== "project" ||
      chat.name !== DEV_PROPOSER_CHAT_NAME ||
      chat.permission_mode !== project.default_permission_mode ||
      (chat.custom_permissions ?? null) !== (project.default_custom_permissions ?? null) ||
      chat.worktree_path !== project.path ||
      chat.archived_at !== null)
  ) {
    return collisionDatabase("Dev proposal caller identity collides with unrelated chat state.")
  }
  if (chat) {
    const children = Number(
      (
        database
          .prepare("SELECT count(*) count FROM sub_chats WHERE chat_id = ?")
          .get(proposerChatId) as { count: number }
      ).count,
    )
    const runs = Number(
      (
        database
          .prepare("SELECT count(*) count FROM agent_runs WHERE chat_id = ?")
          .get(proposerChatId) as { count: number }
      ).count,
    )
    if (children > 0 || runs > 0) {
      return collisionDatabase("Dev proposal caller has user-created chat or run state.")
    }
    const references = unexpectedForeignReferences(database, "chats", proposerChatId, [])
    if (references.length > 0) {
      return collisionDatabase(`Dev proposal caller has linked ${references.join(", ")} state.`)
    }
  }

  const proposals = database
    .prepare("SELECT * FROM task_proposals WHERE project_id = ? AND proposed_by_chat_id = ?")
    .all(projectId, proposerChatId) as Row[]
  if (
    proposals.some(
      (proposal) =>
        !FIXTURE_SOURCE_PATHS.includes(
          String(proposal.source_path) as (typeof FIXTURE_SOURCE_PATHS)[number],
        ),
    )
  ) {
    return collisionDatabase("Dev proposal caller owns non-fixture proposals.")
  }
  const foreignProposals = database
    .prepare(
      `SELECT id FROM task_proposals
         WHERE project_id = ? AND source_path IN (?, ?) AND proposed_by_chat_id <> ? LIMIT 1`,
    )
    .get(projectId, ...FIXTURE_SOURCE_PATHS, proposerChatId)
  if (foreignProposals) {
    return collisionDatabase("A non-fixture caller proposed work from the Dev fixture source.")
  }

  const taskRows = database
    .prepare(
      `SELECT id FROM tasks
         WHERE project_id = ? AND source_path IN (?, ?)`,
    )
    .all(projectId, ...FIXTURE_SOURCE_PATHS) as Array<{ id: string }>
  for (const task of taskRows) {
    if (!task.id.startsWith("plan-task-") && !task.id.startsWith("proposal-task-")) {
      return collisionDatabase("A non-fixture task uses the Dev fixture source identity.")
    }
    const chats = database.prepare("SELECT id FROM chats WHERE task_id = ?").all(task.id) as Array<{
      id: string
    }>
    if (
      chats.length !== 1 ||
      (!chats[0]!.id.startsWith("plan-chat-") && !chats[0]!.id.startsWith("proposal-chat-"))
    ) {
      return collisionDatabase("A fixture task has ambiguous or user-created chat state.")
    }
    const chatId = chats[0]!.id
    const subChats = database
      .prepare("SELECT id FROM sub_chats WHERE chat_id = ?")
      .all(chatId) as Array<{ id: string }>
    const runs = Number(
      (
        database.prepare("SELECT count(*) count FROM agent_runs WHERE chat_id = ?").get(chatId) as {
          count: number
        }
      ).count,
    )
    if (
      subChats.length !== 1 ||
      (!subChats[0]!.id.startsWith("plan-subchat-") &&
        !subChats[0]!.id.startsWith("proposal-subchat-")) ||
      runs > 0
    ) {
      return collisionDatabase("A fixture task has extra chat state or a started run.")
    }
    const taskReferences = unexpectedForeignReferences(database, "tasks", task.id, ["chats"])
    const chatReferences = unexpectedForeignReferences(database, "chats", chatId, ["sub_chats"])
    const subChatReferences = unexpectedForeignReferences(
      database,
      "sub_chats",
      subChats[0]!.id,
      [],
    )
    const references = [...taskReferences, ...chatReferences, ...subChatReferences]
    if (references.length > 0) {
      return collisionDatabase(
        `A fixture task has linked ${[...new Set(references)].join(", ")} state.`,
      )
    }
  }

  const markdownRegistered = Boolean(
    database
      .prepare("SELECT 1 FROM plan_source_registrations WHERE project_id = ? AND relative_path = ?")
      .get(projectId, DEV_PLAN_MARKDOWN_PATH),
  )
  return {
    collision: false,
    message: "",
    markdownRegistered,
    proposalCount: proposals.length,
    taskCount: taskRows.length,
    hasChat: Boolean(chat),
  }
}

async function compensateFailedCreate(
  databasePath: string,
  config: ProjectPlanSourceConfig,
): Promise<void> {
  const filesystem = await inspectFixtureFilesystem(config, false)
  if (filesystem.state !== "ready" || filesystem.revision !== 1) {
    throw new Error(
      filesystem.state === "collision"
        ? filesystem.message
        : "Create compensation refused non-initial fixture files.",
    )
  }

  const database = openAppDatabase(databasePath)
  try {
    database.pragma("foreign_keys = ON")
    const transaction = database.transaction(() => {
      const state = inspectCompensatableCreateDatabase(database, config.projectId)
      if (state.collision) throw new Error(state.message)
      const proposerChatId = devProposerChatId(config.projectId)
      database
        .prepare(
          `DELETE FROM task_proposals
           WHERE proposed_by_chat_id = ? AND id IN (?, ?)`,
        )
        .run(proposerChatId, ...devProposalIds(config.projectId))
      database.prepare("DELETE FROM chats WHERE id = ?").run(proposerChatId)
      database
        .prepare(
          `DELETE FROM plan_source_registrations
           WHERE id = ? AND project_id = ? AND relative_path = ? AND source_type = 'markdown'`,
        )
        .run(
          stableId("dev-plan-registration", config.projectId),
          config.projectId,
          DEV_PLAN_MARKDOWN_PATH,
        )
    })
    transaction.immediate()
  } finally {
    database.close()
  }

  await quarantineAndDeleteFixtureFiles(config, filesystem.presentPaths)
  const status = await getPlanKanbanDevFixtureStatus(databasePath, config)
  if (status.state !== "absent") {
    throw new Error(`Create compensation did not restore absent state: ${status.message}`)
  }
}

function inspectCompensatableCreateDatabase(database: Database.Database, projectId: string) {
  const state = inspectFixtureDatabaseConnection(database, projectId)
  if (state.collision) return state
  if (state.taskCount > 0) {
    return collisionDatabase("Create compensation preserved user-approved fixture task state.")
  }

  const registration = database
    .prepare(
      `SELECT id, source_type FROM plan_source_registrations
       WHERE project_id = ? AND relative_path = ?`,
    )
    .get(projectId, DEV_PLAN_MARKDOWN_PATH) as Row | undefined
  if (
    registration &&
    (registration.id !== stableId("dev-plan-registration", projectId) ||
      registration.source_type !== "markdown")
  ) {
    return collisionDatabase("Create compensation preserved a non-fixture source registration.")
  }

  const proposalIds = devProposalIds(projectId)
  const expected = new Map([
    [
      proposalIds[0],
      {
        name: MARKDOWN_PROPOSAL_NAME,
        description: MARKDOWN_PROPOSAL_DESCRIPTION,
        targetStatus: "backlog",
        sourceType: "markdown",
        sourcePath: DEV_PLAN_MARKDOWN_PATH,
      },
    ],
    [
      proposalIds[1],
      {
        name: OPENSPEC_PROPOSAL_NAME,
        description: OPENSPEC_PROPOSAL_DESCRIPTION,
        targetStatus: "planned",
        sourceType: "openspec",
        sourcePath: DEV_PLAN_OPENSPEC_TASKS_PATH,
      },
    ],
  ])
  const proposals = database
    .prepare("SELECT * FROM task_proposals WHERE proposed_by_chat_id = ?")
    .all(devProposerChatId(projectId)) as Row[]
  for (const proposal of proposals) {
    const item = expected.get(String(proposal.id))
    if (
      !item ||
      proposal.project_id !== projectId ||
      proposal.name !== item.name ||
      proposal.description !== item.description ||
      proposal.target_status !== item.targetStatus ||
      proposal.source_type !== item.sourceType ||
      proposal.source_path !== item.sourcePath ||
      proposal.status !== "pending" ||
      proposal.version !== 1 ||
      proposal.decided_at !== null ||
      proposal.archived_at !== null
    ) {
      return collisionDatabase("Create compensation preserved user-modified proposal state.")
    }
  }
  return state
}

function unexpectedForeignReferences(
  database: Database.Database,
  targetTable: string,
  targetId: string,
  allowedTables: string[],
): string[] {
  const allowed = new Set(allowedTables)
  const references = new Set<string>()
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>
  for (const { name } of tables) {
    if (!safeIdentifier(name)) continue
    const foreignKeys = database.prepare(`PRAGMA foreign_key_list("${name}")`).all() as Array<{
      table: string
      from: string
      to: string
    }>
    for (const foreignKey of foreignKeys) {
      if (
        foreignKey.table !== targetTable ||
        foreignKey.to !== "id" ||
        !safeIdentifier(foreignKey.from)
      ) {
        continue
      }
      const row = database
        .prepare(`SELECT 1 FROM "${name}" WHERE "${foreignKey.from}" = ? LIMIT 1`)
        .get(targetId)
      if (row && !allowed.has(name)) references.add(name)
    }
  }
  return [...references].sort()
}

function safeIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9_]+$/.test(value)
}

function collisionDatabase(message: string) {
  return {
    collision: true,
    message,
    markdownRegistered: false,
    proposalCount: 0,
    taskCount: 0,
    hasChat: false,
  }
}

async function inspectFixtureFilesystem(
  config: ProjectPlanSourceConfig,
  allowPartialKnownState: boolean,
): Promise<FilesystemInspection> {
  const revision1 = fixtureFiles(config.projectId, 1)
  const revision2 = fixtureFiles(config.projectId, 2)
  const expectedPaths = Object.keys(revision1).sort()
  const presentPaths: string[] = []
  for (const relativePath of expectedPaths) {
    try {
      const info = await lstat(join(config.rootPath, relativePath))
      if (info.isSymbolicLink() || !info.isFile()) {
        return collisionFilesystem(`Dev fixture path is not a regular file: ${relativePath}`)
      }
      presentPaths.push(relativePath)
    } catch (error) {
      if (!isMissing(error)) return collisionFilesystem(errorMessage(error))
    }
  }

  const unexpected = await findUnexpectedFixtureEntries(config.rootPath, expectedPaths)
  if (unexpected.length > 0) {
    return collisionFilesystem(
      `Dev fixture directories contain unknown entries: ${unexpected.join(", ")}`,
    )
  }
  if (presentPaths.length === 0) {
    return { state: "absent", revision: null, message: "No fixture files.", presentPaths: [] }
  }
  if (!allowPartialKnownState && presentPaths.length !== expectedPaths.length) {
    return collisionFilesystem("Dev fixture files are only partially present.", presentPaths)
  }

  let allRevision1 = presentPaths.length === expectedPaths.length
  let allRevision2 = presentPaths.length === expectedPaths.length
  for (const relativePath of presentPaths) {
    const content = await readFile(join(config.rootPath, relativePath), "utf8")
    const isRevision1 = content === revision1[relativePath]
    const isRevision2 = content === revision2[relativePath]
    if (!isRevision1 && !isRevision2) {
      return collisionFilesystem(
        `Dev fixture source was changed outside the fixture controls: ${relativePath}`,
      )
    }
    allRevision1 &&= isRevision1
    allRevision2 &&= isRevision2
  }
  if (allRevision1) {
    return { state: "ready", revision: 1, message: "Revision 1", presentPaths }
  }
  if (allRevision2) {
    return { state: "advanced", revision: 2, message: "Revision 2", presentPaths }
  }
  if (allowPartialKnownState) {
    return { state: "ready", revision: null, message: "Known partial fixture state", presentPaths }
  }
  return collisionFilesystem("Dev fixture files contain a mixed revision.", presentPaths)
}

async function findUnexpectedFixtureEntries(rootPath: string, expectedPaths: string[]) {
  const roots = [dirname(DEV_PLAN_MARKDOWN_PATH), DEV_PLAN_OPENSPEC_ROOT]
  const unexpected: string[] = []
  for (const fixtureRoot of roots) {
    const absoluteRoot = join(rootPath, fixtureRoot)
    try {
      const info = await lstat(absoluteRoot)
      if (info.isSymbolicLink() || !info.isDirectory()) {
        unexpected.push(fixtureRoot)
        continue
      }
    } catch (error) {
      if (isMissing(error)) continue
      unexpected.push(fixtureRoot)
      continue
    }
    await walk(absoluteRoot, async (absolutePath, isDirectory) => {
      const relativePath = relative(rootPath, absolutePath).split(sep).join("/")
      if (isDirectory) {
        const expectedDirectory = expectedPaths.some((path) => path.startsWith(`${relativePath}/`))
        if (!expectedDirectory) unexpected.push(relativePath)
      } else if (!expectedPaths.includes(relativePath)) {
        unexpected.push(relativePath)
      }
    })
  }
  return unexpected.sort()
}

async function walk(
  directory: string,
  visit: (absolutePath: string, isDirectory: boolean) => void | Promise<void>,
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      await visit(absolutePath, false)
    } else if (entry.isDirectory()) {
      await visit(absolutePath, true)
      await walk(absolutePath, visit)
    } else {
      await visit(absolutePath, false)
    }
  }
}

async function ensureSafeDirectory(rootPath: string, relativeDirectory: string): Promise<void> {
  const canonicalRoot = resolve(rootPath)
  let current = canonicalRoot
  for (const segment of relativeDirectory.split(/[\\/]+/).filter(Boolean)) {
    current = join(current, segment)
    if (!isInside(canonicalRoot, current))
      throw new Error("Fixture directory escaped project root.")
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error(`Fixture directory collides with a non-directory: ${segment}`)
      }
    } catch (error) {
      if (!isMissing(error)) throw error
      await mkdir(current)
      const created = await lstat(current)
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new Error(`Fixture directory was replaced during creation: ${segment}`)
      }
    }
  }
}

async function cleanupCreatedFiles(rootPath: string, relativePaths: string[]): Promise<void> {
  for (const relativePath of [...relativePaths].reverse()) {
    try {
      await unlink(join(rootPath, relativePath))
    } catch {
      // The reset route handles any known partial state left by a failed creation.
    }
  }
  await removeFixtureDirectories(rootPath)
}

async function quarantineAndDeleteFixtureFiles(
  config: ProjectPlanSourceConfig,
  relativePaths: string[],
): Promise<void> {
  const known1 = fixtureFiles(config.projectId, 1)
  const known2 = fixtureFiles(config.projectId, 2)
  for (const relativePath of relativePaths) {
    const absolutePath = join(config.rootPath, relativePath)
    const quarantinePath = `${absolutePath}.reset-${randomUUID()}`
    await rename(absolutePath, quarantinePath)
    const content = await readFile(quarantinePath, "utf8")
    if (content !== known1[relativePath] && content !== known2[relativePath]) {
      try {
        await rename(quarantinePath, absolutePath)
      } catch {
        // Quarantine preserves the unknown file if the original path was replaced again.
      }
      throw new Error(`Reset preserved a source that changed during cleanup: ${relativePath}`)
    }
    await unlink(quarantinePath)
  }
  await removeFixtureDirectories(config.rootPath)
}

async function removeFixtureDirectories(rootPath: string): Promise<void> {
  for (const relativeDirectory of [
    `${DEV_PLAN_OPENSPEC_ROOT}/specs/dev-fixture`,
    `${DEV_PLAN_OPENSPEC_ROOT}/specs`,
    DEV_PLAN_OPENSPEC_ROOT,
    dirname(DEV_PLAN_MARKDOWN_PATH),
    ".flapstack/dev-fixtures",
    ".flapstack",
  ]) {
    try {
      await rmdir(join(rootPath, relativeDirectory))
    } catch {
      // Non-empty or pre-existing parent directories are preserved.
    }
  }
}

function fixtureFiles(projectId: string, revision: FixtureRevision): Record<string, string> {
  const marker = `<!-- flapstack-dev-plan-kanban-fixture:${projectId}:r${revision} -->`
  const revisionText = revision === 1 ? "Initial review" : "Updated after source refresh"
  return {
    [DEV_PLAN_MARKDOWN_PATH]: `${marker}
# Dev Markdown Plan

## Candidate review

- [ ] ${MARKDOWN_CANDIDATE_TITLE}
  - Acceptance: ${revisionText}; create exactly one idle task chat.
- [x] Preserve completed Markdown work
`,
    [`${DEV_PLAN_OPENSPEC_ROOT}/proposal.md`]: `${marker}
# Change: Dev Plan and Kanban fixture

## Why

Provide deterministic local candidate data through normal Dev UI controls.

## What Changes

- Exercise OpenSpec discovery without editing user-owned plans.
`,
    [`${DEV_PLAN_OPENSPEC_ROOT}/specs/dev-fixture/spec.md`]: `${marker}
## ADDED Requirements

### Requirement: Dev fixture remains approval gated

The fixture SHALL create inert candidates and SHALL NOT launch a run.

#### Scenario: User reviews a candidate

- **WHEN** the user opens the exact preview
- **THEN** task and chat state remains absent until approval
`,
    [DEV_PLAN_OPENSPEC_TASKS_PATH]: `${marker}
# Dev fixture tasks

### ${OPENSPEC_CANDIDATE_TITLE}

- [ ] Completion: acceptance remains user reviewed
- Acceptance: ${revisionText}; render one durable task card after approval.
`,
  }
}

function devProposerChatId(projectId: string): string {
  return stableId("dev-plan-proposer", projectId)
}

function devProposalIds(projectId: string): [string, string] {
  const chatId = devProposerChatId(projectId)
  return [
    stableId("task-proposal", chatId, "", "markdown-candidate"),
    stableId("task-proposal", chatId, "", "openspec-candidate"),
  ]
}

function stableId(prefix: string, ...values: string[]): string {
  return `${prefix}-${createHash("sha256").update(values.join("\0")).digest("hex").slice(0, 32)}`
}

function collisionFilesystem(message: string, presentPaths: string[] = []): FilesystemInspection {
  return { state: "collision", revision: null, message, presentPaths }
}

function isInside(rootPath: string, candidatePath: string): boolean {
  const path = relative(rootPath, candidatePath)
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..")
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
