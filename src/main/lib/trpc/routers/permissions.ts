import { z } from "zod"
import { eq } from "drizzle-orm"
import { chats, getDatabase } from "../../db"
import {
  getGlobalDefault,
  parsePermissionMode,
  permissionModes,
  resolvePermission,
  setGlobalDefault,
  type PermissionMode,
} from "../../permissions"
import { publicProcedure, router } from "../index"

const permissionModeSchema = z.enum(permissionModes)

type Row = Record<string, unknown>
type RawSqlDatabase = {
  $client: {
    prepare(sql: string): {
      get(...params: unknown[]): Row | undefined
    }
  }
}

export const permissionsRouter = router({
  getGlobalDefault: publicProcedure.query(() => {
    return { mode: getGlobalDefault() }
  }),

  setGlobalDefault: publicProcedure
    .input(z.object({ mode: permissionModeSchema }))
    .mutation(({ input }) => {
      return { mode: setGlobalDefault(input.mode) }
    }),

  setChatMode: publicProcedure
    .input(z.object({ chatId: z.string(), mode: permissionModeSchema }))
    .mutation(({ input }) => {
      const db = getDatabase()
      const chat = db
        .update(chats)
        .set({ permissionMode: input.mode, updatedAt: new Date() })
        .where(eq(chats.id, input.chatId))
        .returning()
        .get()

      if (!chat) {
        throw new Error(`Chat not found: ${input.chatId}`)
      }

      return { mode: input.mode }
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
    }
  }),
})

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
