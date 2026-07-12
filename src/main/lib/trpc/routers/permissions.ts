import { z } from "zod"
import { desc, eq } from "drizzle-orm"
import { chats, getDatabase, projects, subChats, tasks } from "../../db"
import {
  getGlobalDefault,
  getPermissionPreferences,
  buildClaudePermissionApplication,
  buildCodexPermissionApplication,
  buildCursorPermissionApplication,
  mapClaudeSdkPermissionMode,
  parseCustomPermissionToggles,
  parsePermissionMode,
  permissionChangeBehaviors,
  permissionModes,
  replacePermissionPreferences,
  resolvePermission,
  setPermissionChangeBehavior,
  setGlobalDefault,
  type PermissionChangeBehavior,
  type PermissionMode,
  type CustomPermissionToggles,
} from "../../permissions"
import { buildOpencodePermissionApplication } from "../../harness/opencode-sidecar"
import { publicProcedure, router } from "../index"

const permissionModeSchema = z.enum(permissionModes)
const permissionChangeBehaviorSchema = z.enum(permissionChangeBehaviors)
const permissionChangeScopeSchema = z.enum(["all-chats", "current-chat"])
const customPermissionsSchema = z
  .object({
    fileWrite: z.boolean(),
    shell: z.boolean(),
    network: z.boolean(),
    git: z.boolean(),
    browser: z.boolean(),
    mcp: z.boolean(),
    secrets: z.boolean(),
  })
  .strict()

type Row = Record<string, unknown>
type RawSqlDatabase = {
  $client: {
    prepare(sql: string): {
      get(...params: unknown[]): Row | undefined
    }
  }
}

export const permissionsRouter = router({
  getPreferences: publicProcedure.query(() => {
    return getPermissionPreferences()
  }),

  getGlobalDefault: publicProcedure.query(() => {
    return { mode: getGlobalDefault() }
  }),

  setGlobalDefault: publicProcedure
    .input(z.object({ mode: permissionModeSchema }))
    .mutation(({ input }) => {
      return { mode: setGlobalDefault(input.mode) }
    }),

  setChangeBehavior: publicProcedure
    .input(z.object({ behavior: permissionChangeBehaviorSchema }))
    .mutation(({ input }) => {
      return { behavior: setPermissionChangeBehavior(input.behavior) }
    }),

  setChatMode: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        mode: permissionModeSchema,
        scope: permissionChangeScopeSchema.default("current-chat"),
        rememberBehavior: permissionChangeBehaviorSchema.optional(),
        customPermissions: customPermissionsSchema.optional(),
      }),
    )
    .mutation(({ input }) => {
      if (input.mode === "custom" && !input.customPermissions) {
        throw new Error("Custom permission mode requires explicit capability toggles.")
      }
      if (input.mode !== "custom" && input.customPermissions) {
        throw new Error("Custom capability toggles require custom permission mode.")
      }
      return applyScopedPermissionChange(input)
    }),

  listChatModes: publicProcedure.query(() => {
    const db = getDatabase()
    return db
      .select({
        id: chats.id,
        name: chats.name,
        scope: chats.scope,
        permissionMode: chats.permissionMode,
        projectId: chats.projectId,
        projectName: projects.name,
        taskId: chats.taskId,
        taskName: tasks.name,
        archivedAt: chats.archivedAt,
        updatedAt: chats.updatedAt,
      })
      .from(chats)
      .leftJoin(projects, eq(chats.projectId, projects.id))
      .leftJoin(tasks, eq(chats.taskId, tasks.id))
      .orderBy(desc(chats.updatedAt))
      .all()
      .map((chat) => ({
        ...chat,
        permissionMode: parsePermissionMode(chat.permissionMode) ?? getGlobalDefault(),
      }))
  }),

  resolveForChat: publicProcedure.input(z.object({ chatId: z.string() })).query(({ input }) => {
    const values = readPermissionValuesForChat(input.chatId)
    const globalMode = getGlobalDefault()

    return {
      ...resolvePermission({ ...values, globalMode }),
      values: {
        ...values,
        globalMode,
      },
      customPermissions: readCustomPermissionsForChat(input.chatId),
    }
  }),

  previewHarness: publicProcedure
    .input(
      z.object({
        harness: z.enum(["claude-code", "codex", "cursor-agent", "openrouter", "nanogpt"]),
        mode: permissionModeSchema,
        chatMode: z.enum(["plan", "agent"]).default("agent"),
        cwd: z.string().nullable().optional(),
      }),
    )
    .query(({ input }) => {
      if (input.harness === "codex") {
        return buildCodexPermissionApplication({ permissionMode: input.mode, cwd: input.cwd })
      }
      if (input.harness === "cursor-agent") {
        return buildCursorPermissionApplication({ permissionMode: input.mode, cwd: input.cwd })
      }
      if (input.harness === "openrouter" || input.harness === "nanogpt") {
        return buildOpencodePermissionApplication({
          permissionMode: input.mode,
          cwd: input.cwd,
        })
      }
      const sdk = mapClaudeSdkPermissionMode(input.mode, input.chatMode)
      return buildClaudePermissionApplication({
        permissionMode: input.mode,
        cwd: input.cwd,
        sdkPermissionMode: sdk.sdkPermissionMode,
        canUseToolReadOnlyGuard: input.mode === "read-only",
      })
    }),
})

function applyScopedPermissionChange(input: {
  chatId: string
  mode: PermissionMode
  scope: "all-chats" | "current-chat"
  rememberBehavior?: PermissionChangeBehavior
  customPermissions?: CustomPermissionToggles
}): {
  mode: PermissionMode
  scope: "all-chats" | "current-chat"
  changeBehavior: PermissionChangeBehavior
  updatedChats: number
  updatedSubChats: number
  customPermissions: CustomPermissionToggles | null
} {
  const db = getDatabase()
  const previousPreferences = getPermissionPreferences()
  const nextPreferences = {
    globalDefault: input.scope === "all-chats" ? input.mode : previousPreferences.globalDefault,
    changeBehavior: input.rememberBehavior ?? previousPreferences.changeBehavior,
  }
  const configChanged =
    nextPreferences.globalDefault !== previousPreferences.globalDefault ||
    nextPreferences.changeBehavior !== previousPreferences.changeBehavior

  if (configChanged) {
    replacePermissionPreferences(nextPreferences)
  }

  try {
    const result = db.transaction((tx) => {
      const existing = tx
        .select({ id: chats.id })
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!existing) {
        throw new Error(`Chat not found: ${input.chatId}`)
      }

      const updatedAt = new Date()
      const customPermissions = input.customPermissions
        ? JSON.stringify(input.customPermissions)
        : null

      if (input.scope === "all-chats") {
        tx.update(projects).set({ defaultPermissionMode: input.mode, updatedAt }).run()
        tx.update(tasks).set({ defaultPermissionMode: input.mode, updatedAt }).run()
        const updatedChats = tx
          .update(chats)
          .set({ permissionMode: input.mode, customPermissions, updatedAt })
          .run().changes
        const updatedSubChats = tx
          .update(subChats)
          .set({ permissionMode: input.mode, updatedAt })
          .run().changes

        return { updatedChats, updatedSubChats }
      }

      const updatedChats = tx
        .update(chats)
        .set({ permissionMode: input.mode, customPermissions, updatedAt })
        .where(eq(chats.id, input.chatId))
        .run().changes
      const updatedSubChats = tx
        .update(subChats)
        .set({ permissionMode: input.mode, updatedAt })
        .where(eq(subChats.chatId, input.chatId))
        .run().changes

      return { updatedChats, updatedSubChats }
    })

    return {
      mode: input.mode,
      scope: input.scope,
      changeBehavior: nextPreferences.changeBehavior,
      customPermissions: input.customPermissions ?? null,
      ...result,
    }
  } catch (error) {
    if (configChanged) {
      try {
        replacePermissionPreferences(previousPreferences)
      } catch (restoreError) {
        console.error("[Permissions] Failed to restore permission preferences:", restoreError)
      }
    }
    throw error
  }
}

function readCustomPermissionsForChat(chatId: string): CustomPermissionToggles | null {
  const db = getDatabase()
  const row = getOptional<Row>(
    db,
    "SELECT custom_permissions AS customPermissions FROM chats WHERE id = ?",
    [chatId],
  )
  if (!row || typeof row.customPermissions !== "string") return null
  try {
    return parseCustomPermissionToggles(JSON.parse(row.customPermissions))
  } catch {
    return null
  }
}

function readPermissionValuesForChat(chatId: string): {
  chatMode?: PermissionMode | null
  taskMode?: PermissionMode | null
  projectMode?: PermissionMode | null
} {
  const db = getDatabase()

  const chat = getOptional<Row>(
    db,
    `
      SELECT
        c.permission_mode AS chatMode,
        c.task_id AS taskId,
        c.project_id AS projectId,
        p.default_permission_mode AS projectMode
      FROM chats c
      LEFT JOIN projects p ON p.id = c.project_id
      WHERE c.id = ?
    `,
    [chatId],
  )

  if (!chat) {
    throw new Error(`Chat not found: ${chatId}`)
  }

  const taskId = typeof chat.taskId === "string" ? chat.taskId : null
  const task = taskId
    ? getOptional<Row>(
        db,
        `
          SELECT default_permission_mode AS taskMode
          FROM tasks
          WHERE id = ?
        `,
        [taskId],
      )
    : null

  return {
    chatMode: parsePermissionMode(chat.chatMode),
    taskMode: parsePermissionMode(task?.taskMode),
    projectMode: parsePermissionMode(chat.projectMode),
  }
}

function getOptional<T extends Row>(
  db: ReturnType<typeof getDatabase>,
  sql: string,
  params: unknown[],
): T | null {
  try {
    const row = (db as unknown as RawSqlDatabase).$client.prepare(sql).get(...params)
    return (row as T | undefined) ?? null
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return getOptionalFromExistingColumns<T>(db, sql, params)
    }

    throw error
  }
}

function getOptionalFromExistingColumns<T extends Row>(
  db: ReturnType<typeof getDatabase>,
  sql: string,
  params: unknown[],
): T | null {
  if (!sql.includes("FROM chats")) {
    return null
  }

  const rawDb = db as unknown as RawSqlDatabase
  const chat = rawDb.$client.prepare("SELECT * FROM chats WHERE id = ?").get(...params) ?? null
  if (!chat) {
    return null
  }

  let project: Row | null = null
  const projectId = typeof chat.project_id === "string" ? chat.project_id : chat.projectId

  if (typeof projectId === "string") {
    project = rawDb.$client.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) ?? null
  }

  return {
    chatMode: chat.permission_mode ?? chat.permissionMode,
    taskId: chat.task_id ?? chat.taskId,
    projectId,
    projectMode: project?.default_permission_mode ?? project?.defaultPermissionMode,
  } as unknown as T
}

function isMissingSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes("no such column") ||
    message.includes("no such table") ||
    message.includes("SQLITE_ERROR")
  )
}
