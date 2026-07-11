import { and, desc, eq } from "drizzle-orm"
import { app } from "electron"
import { constants } from "node:fs"
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { attachments, chats, getDatabase, projects, tasks, type Attachment } from "../../db"
import { copyVerifiedFlapshotFile, verifyStoredFlapshotFile } from "../../flapshot/integrity"
import { prepareSafeWritePath } from "../../path-safety"
import { publicProcedure, router } from "../index"

const attachmentKindSchema = z.enum(["file", "image", "pasted-text", "chat-history", "text"])

function attachmentRoot() {
  return join(app.getPath("userData"), "attachments")
}

function cleanName(name: string) {
  const cleaned = basename(name).trim()
  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.includes("\0")) {
    throw new Error("Invalid attachment name")
  }
  return cleaned
}

function getChatOrThrow(chatId: string) {
  const db = getDatabase()
  const chat = db.select().from(chats).where(eq(chats.id, chatId)).get()
  if (!chat) throw new Error("Chat not found")
  return chat
}

async function verifyFlapshotAttachmentForUse(attachment: Attachment) {
  const filePath = attachment.storedPath ?? attachment.sourcePath
  const result = await verifyStoredFlapshotFile({
    filePath,
    sizeBytes: attachment.byteLength,
    sha256: attachment.sha256,
    mimeType: attachment.mimeType,
    grantExpiresAt: attachment.storedPath ? null : attachment.grantExpiresAt,
  })
  getDatabase()
    .update(attachments)
    .set({ integrityStatus: result.status })
    .where(eq(attachments.id, attachment.id))
    .run()
  if (result.status !== "verified") throw new Error(result.message)
  if (!filePath) throw new Error("Flapshot attachment has no file path")
  return filePath
}

export const attachmentsRouter = router({
  createText: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        taskId: z.string().optional().nullable(),
        kind: attachmentKindSchema.default("pasted-text"),
        name: z.string().min(1),
        contentText: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      const chat = getChatOrThrow(input.chatId)

      return db
        .insert(attachments)
        .values({
          chatId: input.chatId,
          taskId: input.taskId ?? chat.taskId,
          kind: input.kind,
          name: cleanName(input.name),
          contentText: input.contentText,
        })
        .returning()
        .get()
    }),

  importFile: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        taskId: z.string().optional().nullable(),
        sourcePath: z.string(),
        kind: attachmentKindSchema.default("file"),
        name: z.string().optional(),
        contentText: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const chat = getChatOrThrow(input.chatId)
      const sourceStat = await stat(input.sourcePath)
      if (!sourceStat.isFile()) throw new Error("Attachment source must be a file")

      const attachment = db
        .insert(attachments)
        .values({
          chatId: input.chatId,
          taskId: input.taskId ?? chat.taskId,
          kind: input.kind,
          name: cleanName(input.name ?? basename(input.sourcePath)),
          sourcePath: input.sourcePath,
          contentText: input.contentText,
        })
        .returning()
        .get()

      const storageDir = join(attachmentRoot(), attachment.id)
      await mkdir(storageDir, { recursive: true })
      const storedPath = join(storageDir, attachment.name)
      await copyFile(input.sourcePath, storedPath)

      return db
        .update(attachments)
        .set({ storedPath })
        .where(eq(attachments.id, attachment.id))
        .returning()
        .get()
    }),

  listByChat: publicProcedure.input(z.object({ chatId: z.string() })).query(({ input }) => {
    const db = getDatabase()
    return db
      .select()
      .from(attachments)
      .where(eq(attachments.chatId, input.chatId))
      .orderBy(desc(attachments.createdAt))
      .all()
  }),

  listByTask: publicProcedure.input(z.object({ taskId: z.string() })).query(({ input }) => {
    const db = getDatabase()
    return db
      .select()
      .from(attachments)
      .where(eq(attachments.taskId, input.taskId))
      .orderBy(desc(attachments.createdAt))
      .all()
  }),

  promoteToTask: publicProcedure
    .input(z.object({ id: z.string(), taskId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      const attachment = db.select().from(attachments).where(eq(attachments.id, input.id)).get()
      if (!attachment) throw new Error("Attachment not found")

      const chat = db.select().from(chats).where(eq(chats.id, attachment.chatId)).get()
      if (!chat) throw new Error("Chat not found")

      const task = db.select().from(tasks).where(eq(tasks.id, input.taskId)).get()
      if (!task) throw new Error("Task not found")
      if (chat.projectId && task.projectId !== chat.projectId) {
        throw new Error("Attachment cannot be promoted to a task from another project")
      }

      return db
        .update(attachments)
        .set({ taskId: input.taskId })
        .where(eq(attachments.id, input.id))
        .returning()
        .get()
    }),

  writeToWorktree: publicProcedure
    .input(
      z.object({
        id: z.string(),
        worktreePath: z.string(),
        targetRelativePath: z.string().optional(),
        overwrite: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const attachment = db.select().from(attachments).where(eq(attachments.id, input.id)).get()
      if (!attachment) throw new Error("Attachment not found")
      const chat = db.select().from(chats).where(eq(chats.id, attachment.chatId)).get()
      if (!chat) throw new Error("Chat not found")
      const project = chat.projectId
        ? db.select().from(projects).where(eq(projects.id, chat.projectId)).get()
        : null
      const task = chat.taskId
        ? db.select().from(tasks).where(eq(tasks.id, chat.taskId)).get()
        : null

      const requestedRoot = resolve(input.worktreePath)
      const allowedRoots = new Set(
        [chat.worktreePath, project?.path, task?.primaryWorktreePath]
          .filter((value): value is string => Boolean(value))
          .map((value) => resolve(value)),
      )
      if (!allowedRoots.has(requestedRoot)) {
        throw new Error("Attachment target must be one of the chat's known worktree roots")
      }

      const targetPath = await prepareSafeWritePath(
        input.worktreePath,
        input.targetRelativePath ?? attachment.name,
      )
      const sourcePath =
        attachment.sourceApplication === "Flapshot"
          ? await verifyFlapshotAttachmentForUse(attachment)
          : (attachment.storedPath ?? attachment.sourcePath)

      if (attachment.sourceApplication === "Flapshot" && sourcePath) {
        try {
          const result = await copyVerifiedFlapshotFile({
            sourcePath,
            destinationPath: targetPath,
            overwrite: input.overwrite,
            sizeBytes: attachment.byteLength,
            sha256: attachment.sha256,
            mimeType: attachment.mimeType,
            grantExpiresAt: attachment.storedPath ? null : attachment.grantExpiresAt,
          })
          db.update(attachments)
            .set({ integrityStatus: result.status })
            .where(eq(attachments.id, attachment.id))
            .run()
          if (result.status !== "verified") throw new Error(result.message)
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "EEXIST") {
            throw new Error("Target file already exists")
          }
          throw error
        }
        const resultStat = await stat(targetPath)
        return { targetPath, byteLength: resultStat.size }
      }

      const writeContent = async (destination: string, exclusive: boolean) => {
        if (sourcePath) {
          await copyFile(sourcePath, destination, exclusive ? constants.COPYFILE_EXCL : 0)
        } else if (attachment.contentText !== null) {
          await writeFile(destination, attachment.contentText, {
            encoding: "utf-8",
            flag: exclusive ? "wx" : "w",
          })
        } else {
          throw new Error("Attachment has no stored content")
        }
      }

      if (!input.overwrite) {
        try {
          await writeContent(targetPath, true)
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "EEXIST") {
            throw new Error("Target file already exists")
          }
          throw error
        }
      } else {
        const temporaryPath = join(dirname(targetPath), `.flapstack-${randomUUID()}.tmp`)
        try {
          await writeContent(temporaryPath, true)
          await rm(targetPath, { force: true })
          await rename(temporaryPath, targetPath)
        } finally {
          await rm(temporaryPath, { force: true })
        }
      }

      const resultStat = await stat(targetPath)
      return { targetPath, byteLength: resultStat.size }
    }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const db = getDatabase()
    return db.select().from(attachments).where(eq(attachments.id, input.id)).get()
  }),

  readText: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const db = getDatabase()
    const attachment = db.select().from(attachments).where(eq(attachments.id, input.id)).get()
    if (!attachment) throw new Error("Attachment not found")

    if (attachment.contentText !== null) return attachment.contentText
    const sourcePath =
      attachment.sourceApplication === "Flapshot"
        ? await verifyFlapshotAttachmentForUse(attachment)
        : (attachment.storedPath ?? attachment.sourcePath)
    if (!sourcePath) throw new Error("Attachment has no readable text content")

    return readFile(sourcePath, "utf-8")
  }),

  delete: publicProcedure
    .input(z.object({ id: z.string(), chatId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .delete(attachments)
        .where(and(eq(attachments.id, input.id), eq(attachments.chatId, input.chatId)))
        .returning()
        .get()
    }),
})
