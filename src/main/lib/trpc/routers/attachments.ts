import { and, desc, eq } from "drizzle-orm"
import { app } from "electron"
import { createHash, randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path"
import { z } from "zod"
import { attachments, chats, getDatabase, projects, tasks } from "../../db"
import { createId } from "../../db/utils"
import {
  readFileInsideRoot,
  removeFileInsideRoot,
  renamePathInsideRoot,
  RootedReadTooLargeError,
  writeFileInsideRoot,
} from "../../path-safety"
import { publicProcedure, router } from "../index"
import {
  assertRegisteredFilesystemRoot,
  assertRegisteredWorktree,
  bindFilesystemRootIdentity,
  PathValidationError,
} from "../../git/security/path-validation"
import { attachmentRelativeStoragePath, attachmentRootForUserData } from "../../attachments/paths"
import { attachmentDeletionQuarantineName } from "../../attachments/reconcile"
import {
  IMPORTED_FILE_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_IMAGE_DIMENSION,
  MAX_ATTACHMENT_IMAGE_PIXELS,
} from "../../../../shared/attachment-mime"

const textAttachmentKindSchema = z.enum(["pasted-text", "chat-history", "text"])
const importedAttachmentKindSchema = z.enum(["file", "image"])
const MAX_ATTACHMENT_BASE64_CHARS = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4
const IMAGE_MIME_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"])
const TEXT_FILE_MIME_TYPES = new Set([
  "text/calendar",
  "text/csv",
  "text/css",
  "text/html",
  "text/javascript",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/typescript",
  "text/xml",
])
const ZIP_CONTAINER_MIME_TYPES = new Set([
  "application/zip",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
])
const OLE_CONTAINER_MIME_TYPES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
])
const FILE_MIME_TYPES = new Set<string>(IMPORTED_FILE_MIME_TYPES)

function attachmentRoot() {
  return attachmentRootForUserData(app.getPath("userData"))
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

function scopedAttachmentTaskId(
  chat: ReturnType<typeof getChatOrThrow>,
  requestedTaskId: string | null | undefined,
): string | null {
  const taskId = requestedTaskId ?? chat.taskId
  if (!taskId) return null

  const task = getDatabase().select().from(tasks).where(eq(tasks.id, taskId)).get()
  if (!task) throw new Error("Attachment task not found")
  if (!chat.projectId || task.projectId !== chat.projectId) {
    throw new Error("Attachment task must belong to the chat project scope")
  }
  return task.id
}

export const attachmentsRouter = router({
  createText: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        taskId: z.string().optional().nullable(),
        kind: textAttachmentKindSchema.default("pasted-text"),
        name: z.string().min(1),
        contentText: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      const chat = getChatOrThrow(input.chatId)
      const taskId = scopedAttachmentTaskId(chat, input.taskId)

      return db
        .insert(attachments)
        .values({
          chatId: input.chatId,
          taskId,
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
        dataBase64: z
          .string()
          .max(MAX_ATTACHMENT_BASE64_CHARS, "Attachment base64 exceeds the size limit"),
        kind: importedAttachmentKindSchema.default("file"),
        name: z.string().optional(),
        mimeType: z.string().max(255).trim().toLowerCase(),
      }),
    )
    .mutation(async ({ input }) => {
      const data = decodeAttachmentBase64(input.dataBase64)
      const mimeType = deriveAttachmentMimeType(input.kind, input.mimeType, data)
      const db = getDatabase()
      const chat = getChatOrThrow(input.chatId)
      const taskId = scopedAttachmentTaskId(chat, input.taskId)
      const id = createId()
      const name = cleanName(input.name ?? "attachment")
      const rootPath = attachmentRoot()
      const sha256 = createHash("sha256").update(data).digest("hex")
      let attachment: typeof attachments.$inferSelect | undefined

      await mkdir(rootPath, { recursive: true })
      await writeFileInsideRoot(
        rootPath,
        attachmentRelativeStoragePath(id, name),
        { data },
        {
          afterCommit: (storedPath) => {
            attachment = db
              .insert(attachments)
              .values({
                id,
                chatId: input.chatId,
                taskId,
                kind: input.kind,
                name,
                sourceKind: "upload",
                storedPath,
                byteLength: data.byteLength,
                mimeType,
                sha256,
              })
              .returning()
              .get()
            if (!attachment) throw new Error("Attachment import did not persist")
          },
        },
      )

      if (!attachment) throw new Error("Attachment import did not persist")
      return attachment
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
      if (!chat.projectId || task.projectId !== chat.projectId) {
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
      const task = attachment.taskId
        ? db.select().from(tasks).where(eq(tasks.id, attachment.taskId)).get()
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
      let registeredRoot
      if (task?.primaryWorktreePath && resolve(task.primaryWorktreePath) === requestedRoot) {
        try {
          registeredRoot = assertRegisteredFilesystemRoot(input.worktreePath)
        } catch (error) {
          if (!(error instanceof PathValidationError) || error.code !== "UNREGISTERED_WORKTREE") {
            throw error
          }
          // The promoted task row is the authority for this app-managed root.
          registeredRoot = bindFilesystemRootIdentity(input.worktreePath)
        }
      } else {
        registeredRoot = assertRegisteredWorktree(input.worktreePath)
      }

      const storedTarget = attachment.storedPath
        ? storedAttachmentTarget(attachment.storedPath)
        : null
      if (!storedTarget && attachment.contentText === null) {
        throw new Error("Attachment has no stored content")
      }
      const storedData = storedTarget ? await readStoredAttachment(attachment) : null
      try {
        return await writeFileInsideRoot(
          registeredRoot.canonicalPath,
          input.targetRelativePath ?? attachment.name,
          storedData ? { data: storedData } : { data: attachment.contentText! },
          { overwrite: input.overwrite },
        )
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
          throw new Error("Target file already exists")
        }
        throw error
      }
    }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const db = getDatabase()
    return db.select().from(attachments).where(eq(attachments.id, input.id)).get()
  }),

  readText: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const db = getDatabase()
    const attachment = db.select().from(attachments).where(eq(attachments.id, input.id)).get()
    if (!attachment) throw new Error("Attachment not found")

    if (attachment.storedPath) {
      return (await readStoredAttachment(attachment, 2_000_000)).toString("utf-8")
    }
    if (attachment.contentText !== null) return attachment.contentText
    throw new Error("Attachment has no readable text content")
  }),

  delete: publicProcedure
    .input(z.object({ id: z.string(), chatId: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const attachment = db
        .select()
        .from(attachments)
        .where(and(eq(attachments.id, input.id), eq(attachments.chatId, input.chatId)))
        .get()
      if (!attachment) return undefined
      let quarantine:
        | {
            rootPath: string
            originalRelativePath: string
            quarantineRelativePath: string
          }
        | undefined
      if (attachment.storedPath) {
        const target = storedAttachmentTarget(attachment.storedPath)
        const quarantineName = attachmentDeletionQuarantineName(
          basename(target.relativePath),
          randomUUID(),
        )
        try {
          const renamed = await renamePathInsideRoot(
            target.rootPath,
            target.relativePath,
            quarantineName,
          )
          quarantine = {
            rootPath: target.rootPath,
            originalRelativePath: target.relativePath,
            quarantineRelativePath: relative(target.rootPath, renamed.newPath),
          }
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
            throw error
          }
        }
      }
      let deleted: typeof attachments.$inferSelect | undefined
      try {
        deleted = db
          .delete(attachments)
          .where(and(eq(attachments.id, input.id), eq(attachments.chatId, input.chatId)))
          .returning()
          .get()
        if (!deleted) throw new Error("Attachment database row did not delete")
      } catch (error) {
        if (quarantine) {
          try {
            await renamePathInsideRoot(
              quarantine.rootPath,
              quarantine.quarantineRelativePath,
              basename(quarantine.originalRelativePath),
            )
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              "Attachment delete failed and payload rollback was unsafe",
            )
          }
        }
        throw error
      }

      if (quarantine) {
        await removeFileInsideRoot(quarantine.rootPath, quarantine.quarantineRelativePath, {
          removeEmptyParent: true,
        }).catch((error) => {
          // The row is already committed deleted. Leave the uniquely named
          // quarantine for bounded startup reconciliation.
          console.warn("[Attachments] Quarantine cleanup deferred:", error)
        })
      }
      return deleted
    }),
})

function storedAttachmentTarget(storedPath: string): { rootPath: string; relativePath: string } {
  const rootPath = resolve(attachmentRoot())
  const absolutePath = resolve(storedPath)
  const relativePath = relative(rootPath, absolutePath)
  if (
    !isAbsolute(storedPath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Attachment storage path is outside the durable attachment namespace")
  }
  return { rootPath, relativePath }
}

async function readVerifiedStoredAttachment(
  attachment: typeof attachments.$inferSelect,
  maxBytes = MAX_ATTACHMENT_BYTES,
): Promise<Buffer> {
  if (
    attachment.sourceKind !== "upload" ||
    attachment.byteLength === null ||
    !Number.isInteger(attachment.byteLength) ||
    attachment.byteLength < 0 ||
    attachment.byteLength > MAX_ATTACHMENT_BYTES ||
    typeof attachment.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(attachment.sha256)
  ) {
    throw new Error("Attachment integrity metadata is missing or invalid")
  }
  if (attachment.byteLength > maxBytes) {
    throw new Error("Attachment exceeds the readable text size limit")
  }
  if (!attachment.storedPath) {
    throw new Error("Attachment integrity metadata has no stored content")
  }

  const target = storedAttachmentTarget(attachment.storedPath)
  let data: Buffer
  try {
    data = await readFileInsideRoot(target.rootPath, target.relativePath, {
      maxBytes: Math.min(maxBytes, attachment.byteLength),
    })
  } catch (error) {
    if (error instanceof RootedReadTooLargeError) {
      throw new Error("Attachment integrity verification failed")
    }
    throw error
  }
  const actualSha256 = createHash("sha256").update(data).digest("hex")
  if (data.byteLength !== attachment.byteLength || actualSha256 !== attachment.sha256) {
    throw new Error("Attachment integrity verification failed")
  }
  return data
}

async function readStoredAttachment(
  attachment: typeof attachments.$inferSelect,
  maxBytes = MAX_ATTACHMENT_BYTES,
): Promise<Buffer> {
  if (attachment.sourceKind === "upload") {
    return readVerifiedStoredAttachment(attachment, maxBytes)
  }
  if (
    attachment.sourceKind !== null ||
    attachment.byteLength !== null ||
    attachment.mimeType !== null ||
    attachment.sha256 !== null ||
    !attachment.storedPath
  ) {
    throw new Error("Attachment legacy provenance is inconsistent")
  }

  const target = storedAttachmentTarget(attachment.storedPath)
  try {
    return await readFileInsideRoot(target.rootPath, target.relativePath, { maxBytes })
  } catch (error) {
    if (error instanceof RootedReadTooLargeError) {
      throw new Error("Attachment exceeds the readable size limit")
    }
    throw error
  }
}

export function decodeAttachmentBase64(
  value: string,
  decode: (encoded: string) => Buffer = (encoded) => Buffer.from(encoded, "base64"),
): Buffer {
  if (value.length % 4 !== 0) {
    throw new Error("Attachment data must be canonical base64")
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0
  const decodedByteLength = (value.length / 4) * 3 - padding
  if (decodedByteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES}-byte size limit`)
  }
  const contentLength = value.length - padding
  let lastSextet = 0
  for (let index = 0; index < contentLength; index += 1) {
    const sextet = base64Sextet(value.charCodeAt(index))
    if (sextet < 0) throw new Error("Attachment data must be canonical base64")
    lastSextet = sextet
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 0x3d) {
      throw new Error("Attachment data must be canonical base64")
    }
  }
  if (
    (padding === 2 && (lastSextet & 0x0f) !== 0) ||
    (padding === 1 && (lastSextet & 0x03) !== 0)
  ) {
    throw new Error("Attachment data must be canonical base64")
  }
  const data = decode(value)
  if (data.byteLength !== decodedByteLength) {
    throw new Error("Attachment data must be canonical base64")
  }
  return data
}

function base64Sextet(code: number): number {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52
  if (code === 0x2b) return 62
  if (code === 0x2f) return 63
  return -1
}

function deriveAttachmentMimeType(
  kind: "file" | "image",
  declaredMimeType: string,
  data: Buffer,
): string {
  const allowed = kind === "image" ? IMAGE_MIME_TYPES : FILE_MIME_TYPES
  if (!allowed.has(declaredMimeType)) {
    throw new Error(
      `MIME type ${declaredMimeType || "(empty)"} is not allowed for ${kind} attachments`,
    )
  }

  const image = inspectImage(data)
  if (kind === "image") {
    if (!image) {
      throw new Error("Image attachment content has no supported image signature")
    }
    if (declaredMimeType !== image.mimeType) {
      throw new Error(
        `Declared MIME type ${declaredMimeType} does not match image content ${image.mimeType}`,
      )
    }
    return image.mimeType
  }
  if (image) {
    throw new Error(`Image content must use the image attachment kind (${image.mimeType})`)
  }

  const detectedFileMimeType = sniffFileMimeType(data)
  if (detectedFileMimeType) {
    if (detectedFileMimeType === "application/x-ole-storage") {
      if (!OLE_CONTAINER_MIME_TYPES.has(declaredMimeType)) {
        throw new Error(`Declared MIME type ${declaredMimeType} does not match OLE office content`)
      }
      return declaredMimeType
    }
    const compatible =
      declaredMimeType === "application/octet-stream" ||
      declaredMimeType === detectedFileMimeType ||
      (detectedFileMimeType === "application/zip" && ZIP_CONTAINER_MIME_TYPES.has(declaredMimeType))
    if (!compatible) {
      throw new Error(
        `Declared MIME type ${declaredMimeType} does not match file content ${detectedFileMimeType}`,
      )
    }
    return declaredMimeType === "application/octet-stream" ? detectedFileMimeType : declaredMimeType
  }

  if (isSafeUtf8Text(data)) {
    if (
      declaredMimeType !== "application/octet-stream" &&
      !TEXT_FILE_MIME_TYPES.has(declaredMimeType)
    ) {
      throw new Error(`Declared MIME type ${declaredMimeType} does not match safe text content`)
    }
    return declaredMimeType === "application/octet-stream" ? "text/plain" : declaredMimeType
  }
  if (declaredMimeType !== "application/octet-stream") {
    throw new Error(`Binary file content requires application/octet-stream MIME provenance`)
  }
  return "application/octet-stream"
}

type InspectedImage = { mimeType: string; width: number; height: number }

function inspectImage(data: Buffer): InspectedImage | null {
  if (hasPrefix(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    if (
      data.length < 45 ||
      data.readUInt32BE(8) !== 13 ||
      data.subarray(12, 16).toString("ascii") !== "IHDR"
    ) {
      throw new Error("Image PNG structure is incomplete")
    }
    const width = data.readUInt32BE(16)
    const height = data.readUInt32BE(20)
    let offset = 8
    let sawEnd = false
    while (offset + 12 <= data.length) {
      const chunkLength = data.readUInt32BE(offset)
      const chunkEnd = offset + 12 + chunkLength
      if (chunkEnd > data.length) throw new Error("Image PNG structure is truncated")
      const chunkType = data.subarray(offset + 4, offset + 8).toString("ascii")
      if (chunkType === "IEND") {
        if (chunkLength !== 0 || chunkEnd !== data.length) {
          throw new Error("Image PNG end structure is invalid")
        }
        sawEnd = true
        break
      }
      offset = chunkEnd
    }
    if (!sawEnd) throw new Error("Image PNG structure has no end marker")
    return checkedImage("image/png", width, height)
  }
  if (hasPrefix(data, [0xff, 0xd8, 0xff])) {
    if (data.length < 13 || !hasSuffix(data, [0xff, 0xd9])) {
      throw new Error("Image JPEG structure is incomplete")
    }
    let offset = 2
    while (offset + 4 <= data.length - 2) {
      if (data[offset] !== 0xff) throw new Error("Image JPEG marker structure is invalid")
      while (data[offset] === 0xff) offset += 1
      const marker = data[offset]
      offset += 1
      if (marker === 0xd8 || marker === 0xd9) continue
      if (offset + 2 > data.length) throw new Error("Image JPEG segment is truncated")
      const segmentLength = data.readUInt16BE(offset)
      if (segmentLength < 2 || offset + segmentLength > data.length) {
        throw new Error("Image JPEG segment is truncated")
      }
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb].includes(marker)) {
        if (segmentLength < 7) throw new Error("Image JPEG dimensions are invalid")
        return checkedImage(
          "image/jpeg",
          data.readUInt16BE(offset + 5),
          data.readUInt16BE(offset + 3),
        )
      }
      offset += segmentLength
    }
    throw new Error("Image JPEG structure has no dimensions")
  }
  if (
    data.length >= 6 &&
    (data.subarray(0, 6).toString("ascii") === "GIF87a" ||
      data.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    if (data.length < 14 || data[data.length - 1] !== 0x3b) {
      throw new Error("Image GIF structure is incomplete")
    }
    return checkedImage("image/gif", data.readUInt16LE(6), data.readUInt16LE(8))
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    if (data.length < 20 || data.readUInt32LE(4) + 8 !== data.length) {
      throw new Error("Image WebP structure is incomplete")
    }
    const chunkType = data.subarray(12, 16).toString("ascii")
    const chunkLength = data.readUInt32LE(16)
    if (20 + chunkLength > data.length) throw new Error("Image WebP chunk is truncated")
    if (chunkType === "VP8X" && chunkLength >= 10 && data.length >= 30) {
      let nestedOffset = 20 + chunkLength + (chunkLength % 2)
      let hasImagePayload = false
      while (nestedOffset + 8 <= data.length) {
        const nestedType = data.subarray(nestedOffset, nestedOffset + 4).toString("ascii")
        const nestedLength = data.readUInt32LE(nestedOffset + 4)
        const nestedEnd = nestedOffset + 8 + nestedLength + (nestedLength % 2)
        if (nestedEnd > data.length) throw new Error("Image WebP nested chunk is truncated")
        if (["VP8 ", "VP8L", "ANMF"].includes(nestedType)) hasImagePayload = true
        nestedOffset = nestedEnd
      }
      if (!hasImagePayload || nestedOffset !== data.length) {
        throw new Error("Image WebP structure has no image payload")
      }
      return checkedImage("image/webp", data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1)
    }
    if (chunkType === "VP8L" && chunkLength >= 5 && data[20] === 0x2f) {
      const dimensions = data.readUInt32LE(21)
      return checkedImage(
        "image/webp",
        (dimensions & 0x3fff) + 1,
        ((dimensions >>> 14) & 0x3fff) + 1,
      )
    }
    if (
      chunkType === "VP8 " &&
      chunkLength >= 10 &&
      hasPrefix(data.subarray(23), [0x9d, 0x01, 0x2a])
    ) {
      return checkedImage(
        "image/webp",
        data.readUInt16LE(26) & 0x3fff,
        data.readUInt16LE(28) & 0x3fff,
      )
    }
    throw new Error("Image WebP structure has no supported dimensions")
  }
  return null
}

function checkedImage(mimeType: string, width: number, height: number): InspectedImage {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_ATTACHMENT_IMAGE_DIMENSION ||
    height > MAX_ATTACHMENT_IMAGE_DIMENSION ||
    width * height > MAX_ATTACHMENT_IMAGE_PIXELS
  ) {
    throw new Error("Image dimensions exceed the bounded pixel limit")
  }
  return { mimeType, width, height }
}

function sniffFileMimeType(data: Buffer): string | null {
  if (data.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf"
  if (hasPrefix(data, [0x1f, 0x8b])) return "application/gzip"
  if (
    hasPrefix(data, [0x50, 0x4b, 0x03, 0x04]) ||
    hasPrefix(data, [0x50, 0x4b, 0x05, 0x06]) ||
    hasPrefix(data, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return "application/zip"
  }
  if (hasPrefix(data, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    return "application/x-7z-compressed"
  }
  if (hasPrefix(data, [0x00, 0x61, 0x73, 0x6d])) return "application/wasm"
  if (hasPrefix(data, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return "application/x-ole-storage"
  }
  if (data.length >= 262 && data.subarray(257, 262).toString("ascii") === "ustar") {
    return "application/x-tar"
  }
  return null
}

function hasPrefix(data: Buffer, prefix: number[]): boolean {
  return data.length >= prefix.length && prefix.every((byte, index) => data[index] === byte)
}

function hasSuffix(data: Buffer, suffix: number[]): boolean {
  return (
    data.length >= suffix.length &&
    suffix.every((byte, index) => data[data.length - suffix.length + index] === byte)
  )
}

function isSafeUtf8Text(data: Buffer): boolean {
  if (data.includes(0)) return false
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data)
  } catch {
    return false
  }
  for (const character of text) {
    const codePoint = character.codePointAt(0)!
    if (codePoint < 0x20 && ![0x09, 0x0a, 0x0c, 0x0d].includes(codePoint)) return false
  }
  return true
}
