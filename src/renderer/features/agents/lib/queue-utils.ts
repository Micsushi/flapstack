/**
 * Queue utilities for managing message queue in agents chat
 * Adapted from canvas chat queue implementation
 */

import type { UploadedImage, UploadedFile } from "../hooks/use-agents-file-upload"
import type { PastedTextFile } from "../hooks/use-pasted-text-files"
import { MENTION_PREFIXES } from "../mentions/mention-prefixes"
import { utf8ToBase64 } from "../utils/base64"

export interface QueuedImage {
  id: string
  url: string
  mediaType: string
  filename?: string
  base64Data?: string
}

export interface QueuedFile {
  id: string
  url: string
  filename: string
  mediaType?: string
  size?: number
}

// Text context selected from assistant messages
export interface SelectedTextContext {
  id: string
  text: string
  sourceMessageId: string
  preview: string // Truncated for display (~50 chars)
  createdAt: Date
}

export interface QueuedTextContext {
  id: string
  text: string
  sourceMessageId: string
}

// Text context selected from diff sidebar
export interface DiffTextContext {
  id: string
  text: string
  filePath: string
  lineNumber?: number
  lineType?: "old" | "new"
  preview: string // Truncated for display
  createdAt: Date
}

export interface QueuedDiffTextContext {
  id: string
  text: string
  filePath: string
  lineNumber?: number
  lineType?: "old" | "new"
}

export interface QueuedPastedText {
  id: string
  filePath: string
  filename: string
  size: number
  preview: string
  kind?: "pasted" | "chatHistory"
}

export type AgentQueueItem = {
  id: string
  message: string // Serialized value with @[id] tokens for mentions
  images?: QueuedImage[]
  files?: QueuedFile[]
  textContexts?: QueuedTextContext[]
  diffTextContexts?: QueuedDiffTextContext[]
  pastedTexts?: QueuedPastedText[]
  timestamp: Date
  status: "pending" | "processing" | "failed"
  attempts?: number
  nextRetryAt?: number
  lastError?: string
}

export const MAX_QUEUE_SEND_ATTEMPTS = 3

export function queueRetryDelay(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1))
}

export function queueItemAfterFailure(item: AgentQueueItem, error: unknown): AgentQueueItem {
  const attempts = (item.attempts ?? 0) + 1
  const lastError = error instanceof Error ? error.message : String(error)
  if (attempts >= MAX_QUEUE_SEND_ATTEMPTS) {
    return { ...item, attempts, lastError, status: "failed", nextRetryAt: undefined }
  }
  return {
    ...item,
    attempts,
    lastError,
    status: "pending",
    nextRetryAt: Date.now() + queueRetryDelay(attempts),
  }
}

export function buildQueuedMessageParts(item: AgentQueueItem): any[] {
  const parts: any[] = [
    ...(item.images || []).map((image) => ({
      type: "data-image" as const,
      data: {
        url: image.url,
        mediaType: image.mediaType,
        filename: image.filename,
        base64Data: image.base64Data,
      },
    })),
    ...(item.files || []).map((file) => ({
      type: "data-file" as const,
      data: {
        url: file.url,
        mediaType: file.mediaType,
        filename: file.filename,
        size: file.size,
      },
    })),
  ]

  const mentions = [
    ...(item.textContexts || []).map((context) => {
      const preview = context.text.slice(0, 50).replace(/[:\[\]]/g, "")
      return `@[${MENTION_PREFIXES.QUOTE}${preview}:${utf8ToBase64(context.text)}]`
    }),
    ...(item.diffTextContexts || []).map((context) => {
      const preview = context.text.slice(0, 50).replace(/[:\[\]]/g, "")
      return `@[${MENTION_PREFIXES.DIFF}${context.filePath}:${context.lineNumber || 0}:${preview}:${utf8ToBase64(context.text)}]`
    }),
    ...(item.pastedTexts || []).map((text) => {
      const preview = text.preview.replace(/[:\[\]|]/g, "")
      const prefix =
        text.kind === "chatHistory" ? MENTION_PREFIXES.CHAT_HISTORY : MENTION_PREFIXES.PASTED
      return `@[${prefix}${text.size}:${preview}|${text.filePath}]`
    }),
  ]

  const text = `${mentions.length > 0 ? `${mentions.join(" ")} ` : ""}${item.message || ""}`
  if (text) parts.push({ type: "text", text })
  return parts
}

export function generateQueueId(): string {
  return `queue_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

export function createQueueItem(
  id: string,
  message: string,
  images?: QueuedImage[],
  files?: QueuedFile[],
  textContexts?: QueuedTextContext[],
  diffTextContexts?: QueuedDiffTextContext[],
  pastedTexts?: QueuedPastedText[],
): AgentQueueItem {
  return {
    id,
    message,
    images: images && images.length > 0 ? images : undefined,
    files: files && files.length > 0 ? files : undefined,
    textContexts: textContexts && textContexts.length > 0 ? textContexts : undefined,
    diffTextContexts:
      diffTextContexts && diffTextContexts.length > 0 ? diffTextContexts : undefined,
    pastedTexts: pastedTexts && pastedTexts.length > 0 ? pastedTexts : undefined,
    timestamp: new Date(),
    status: "pending",
  }
}

export function getNextQueueItem(queue: AgentQueueItem[]): AgentQueueItem | null {
  return queue.find((item) => item.status === "pending") || null
}

export function removeQueueItem(queue: AgentQueueItem[], itemId: string): AgentQueueItem[] {
  return queue.filter((item) => item.id !== itemId)
}

export function updateQueueItemStatus(
  queue: AgentQueueItem[],
  itemId: string,
  status: AgentQueueItem["status"],
): AgentQueueItem[] {
  return queue.map((item) => (item.id === itemId ? { ...item, status } : item))
}

// Helper to convert UploadedImage to QueuedImage
export function toQueuedImage(img: UploadedImage): QueuedImage {
  return {
    id: img.id,
    url: img.url,
    mediaType: img.mediaType || "image/png",
    filename: img.filename,
    base64Data: img.base64Data,
  }
}

// Helper to convert UploadedFile to QueuedFile
export function toQueuedFile(file: UploadedFile): QueuedFile {
  return {
    id: file.id,
    url: file.url,
    filename: file.filename,
    mediaType: file.type,
    size: file.size,
  }
}

// Helper to convert SelectedTextContext to QueuedTextContext
export function toQueuedTextContext(ctx: SelectedTextContext): QueuedTextContext {
  return {
    id: ctx.id,
    text: ctx.text,
    sourceMessageId: ctx.sourceMessageId,
  }
}

// Helper to convert DiffTextContext to QueuedDiffTextContext
export function toQueuedDiffTextContext(ctx: DiffTextContext): QueuedDiffTextContext {
  return {
    id: ctx.id,
    text: ctx.text,
    filePath: ctx.filePath,
    lineNumber: ctx.lineNumber,
    lineType: ctx.lineType,
  }
}

// Helper to convert PastedTextFile to QueuedPastedText
export function toQueuedPastedText(pt: PastedTextFile): QueuedPastedText {
  return {
    id: pt.id,
    filePath: pt.filePath,
    filename: pt.filename,
    size: pt.size,
    preview: pt.preview,
    kind: pt.kind,
  }
}

// Helper to create a truncated preview from text
export function createTextPreview(text: string, maxLength: number = 50): string {
  const trimmed = text.trim().replace(/\s+/g, " ")
  if (trimmed.length <= maxLength) return trimmed
  return trimmed.slice(0, maxLength) + "..."
}
