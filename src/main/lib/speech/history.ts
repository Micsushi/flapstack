import { and, desc, eq, isNotNull, like, or } from "drizzle-orm"
import { app } from "electron"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { chats, getDatabase, subChats, voiceArtifacts } from "../db"
import { createId } from "../db/utils"
import type { TtsResult } from "./types"

const AUDIO_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const AUDIO_MAX_BYTES = 500 * 1024 * 1024

function historyRoot() {
  return join(app.getPath("userData"), "voice-history")
}

function requireChat(chatId?: string | null) {
  if (!chatId) return
  const chat = getDatabase().select().from(chats).where(eq(chats.id, chatId)).get()
  if (!chat) throw new Error("Chat not found")
}

export async function recordTranscription(input: {
  chatId?: string | null
  subChatId?: string | null
  text: string
  adapterId: string
  modelId?: string | null
  originKind?: "chat" | "new-chat" | null
  originId?: string | null
  originLabel?: string | null
  audioWav?: Buffer | null
  durationMs?: number | null
}) {
  requireChat(input.chatId)
  if (input.audioWav) {
    const id = createId()
    const audioPath = await stageVoiceAudio(id, "dictation.wav", input.audioWav)
    try {
      const artifact = getDatabase()
        .insert(voiceArtifacts)
        .values({
          id,
          chatId: input.chatId,
          subChatId: input.subChatId ?? null,
          kind: "transcription",
          text: input.text,
          adapterId: input.adapterId,
          modelId: input.modelId ?? null,
          originKind: input.originKind ?? null,
          originId: input.originId ?? null,
          originLabel: input.originLabel ?? null,
          durationMs: input.durationMs ?? null,
          mimeType: "audio/wav",
          byteLength: input.audioWav.length,
          audioPath,
        })
        .returning()
        .get()
      await pruneVoiceHistory().catch((error) =>
        console.warn("[Voice] Failed to prune history after transcription save:", error),
      )
      return artifact
    } catch (error) {
      await rm(join(historyRoot(), id), { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }
  const artifact = getDatabase()
    .insert(voiceArtifacts)
    .values({
      chatId: input.chatId,
      subChatId: input.subChatId ?? null,
      kind: "transcription",
      text: input.text,
      adapterId: input.adapterId,
      modelId: input.modelId ?? null,
      originKind: input.originKind ?? null,
      originId: input.originId ?? null,
      originLabel: input.originLabel ?? null,
      durationMs: input.durationMs ?? null,
      mimeType: null,
      byteLength: 0,
    })
    .returning()
    .get()
  return artifact
}

export async function recordSpeech(input: {
  chatId: string
  subChatId?: string | null
  messageId?: string | null
  text: string
  result: TtsResult
  synthesisKey: string
  voiceId?: string | null
  rate: number
}) {
  requireChat(input.chatId)
  const bytes = Buffer.from(input.result.audioBase64, "base64")
  const extension = input.result.mimeType === "audio/mpeg" ? "mp3" : "wav"
  const id = createId()
  const audioPath = await stageVoiceAudio(id, `speech.${extension}`, bytes)
  try {
    const artifact = getDatabase()
      .insert(voiceArtifacts)
      .values({
        id,
        chatId: input.chatId,
        subChatId: input.subChatId ?? null,
        messageId: input.messageId ?? null,
        kind: "speech",
        text: input.text,
        adapterId: input.result.adapterId,
        synthesisKey: input.synthesisKey,
        voiceId: input.voiceId ?? null,
        rate: Math.round(input.rate * 1_000),
        mimeType: input.result.mimeType,
        byteLength: bytes.length,
        audioPath,
      })
      .returning()
      .get()
    await pruneVoiceHistory().catch((error) =>
      console.warn("[Voice] Failed to prune history after speech save:", error),
    )
    return artifact
  } catch (error) {
    await rm(join(historyRoot(), id), { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function stageVoiceAudio(id: string, filename: string, bytes: Buffer): Promise<string> {
  const root = historyRoot()
  const stagingDirectory = join(root, `.stage-${id}-${createId()}`)
  const finalDirectory = join(root, id)
  await mkdir(stagingDirectory, { recursive: true })
  try {
    await writeFile(join(stagingDirectory, filename), bytes)
    await rename(stagingDirectory, finalDirectory)
    return join(finalDirectory, filename)
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/** Repair crash windows between staged audio and its SQLite metadata. */
export async function reconcileVoiceHistory(): Promise<{
  repairedRows: number
  removedEntries: number
}> {
  const root = historyRoot()
  if (!existsSync(root)) return { repairedRows: 0, removedEntries: 0 }
  const db = getDatabase()
  const rows = db.select().from(voiceArtifacts).all()
  let repairedRows = 0

  for (const row of rows) {
    if (!row.audioPath) continue
    const expectedDirectory = join(root, row.id)
    const validPath = dirname(row.audioPath) === expectedDirectory && existsSync(row.audioPath)
    if (validPath) continue
    if (row.kind === "transcription") {
      db.update(voiceArtifacts)
        .set({ audioPath: null, mimeType: null, byteLength: 0 })
        .where(eq(voiceArtifacts.id, row.id))
        .run()
    } else {
      db.delete(voiceArtifacts).where(eq(voiceArtifacts.id, row.id)).run()
    }
    repairedRows += 1
  }

  const liveAudioIds = new Set(
    db
      .select({ id: voiceArtifacts.id, audioPath: voiceArtifacts.audioPath })
      .from(voiceArtifacts)
      .where(isNotNull(voiceArtifacts.audioPath))
      .all()
      .flatMap((row) => (row.audioPath && existsSync(row.audioPath) ? [row.id] : [])),
  )
  let removedEntries = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && liveAudioIds.has(entry.name)) continue
    await rm(join(root, entry.name), { recursive: true, force: true })
    removedEntries += 1
  }
  return { repairedRows, removedEntries }
}

export function createSpeechSynthesisKey(input: {
  text: string
  adapterId: string
  voiceId?: string | null
  rate: number
}): string {
  return createHash("sha256")
    .update(JSON.stringify([input.text, input.adapterId, input.voiceId ?? null, input.rate]))
    .digest("hex")
}

export async function findReusableSpeech(input: {
  chatId: string
  messageId?: string | null
  synthesisKey: string
}): Promise<{ id: string; result: TtsResult } | null> {
  if (!input.messageId) return null
  const artifact = getDatabase()
    .select()
    .from(voiceArtifacts)
    .where(
      and(
        eq(voiceArtifacts.chatId, input.chatId),
        eq(voiceArtifacts.messageId, input.messageId),
        eq(voiceArtifacts.synthesisKey, input.synthesisKey),
        eq(voiceArtifacts.kind, "speech"),
      ),
    )
    .orderBy(desc(voiceArtifacts.createdAt))
    .get()
  if (!artifact?.audioPath) return null
  try {
    const audio = await readFile(artifact.audioPath)
    return {
      id: artifact.id,
      result: {
        audioBase64: audio.toString("base64"),
        mimeType: artifact.mimeType === "audio/mpeg" ? "audio/mpeg" : "audio/wav",
        adapterId: artifact.adapterId,
        ...(artifact.voiceId ? { voiceId: artifact.voiceId } : {}),
      },
    }
  } catch {
    return null
  }
}

export function mergeMessagesPreservingSpokenText(current: any[], incoming: any[]): any[] {
  const currentById = new Map(
    current.flatMap((message) =>
      typeof message?.id === "string" ? ([[message.id, message]] as const) : [],
    ),
  )
  const incomingIds = new Set(
    incoming.flatMap((message) => (typeof message?.id === "string" ? [message.id] : [])),
  )
  const mergedIncoming = incoming.map((message) => {
    const spokenText = currentById.get(message?.id)?.metadata?.spokenText
    if (typeof spokenText !== "string" || !spokenText.trim()) return message
    return { ...message, metadata: { ...(message.metadata || {}), spokenText } }
  })
  return [
    ...mergedIncoming,
    ...current.filter((message) => typeof message?.id !== "string" || !incomingIds.has(message.id)),
  ]
}

export async function deleteVoiceHistoryForChat(chatId: string): Promise<void> {
  const rows = getDatabase()
    .select({ id: voiceArtifacts.id })
    .from(voiceArtifacts)
    .where(eq(voiceArtifacts.chatId, chatId))
    .all()
  await Promise.all(
    rows.map((row) => rm(join(historyRoot(), basename(row.id)), { recursive: true, force: true })),
  )
}

export function getStoredSpokenText(subChatId?: string | null, messageId?: string | null) {
  if (!subChatId || !messageId) return null
  const subChat = getDatabase().select().from(subChats).where(eq(subChats.id, subChatId)).get()
  const messages = parseMessages(subChat?.messages)
  const message = messages.find((candidate) => candidate?.id === messageId)
  const spokenText = message?.metadata?.spokenText
  return typeof spokenText === "string" && spokenText.trim() ? spokenText : null
}

export function persistSpokenText(input: {
  subChatId?: string | null
  messageId?: string | null
  text: string
}) {
  if (!input.subChatId || !input.messageId || !input.text.trim()) return
  const db = getDatabase()
  const subChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
  const messages = parseMessages(subChat?.messages)
  const index = messages.findIndex((candidate) => candidate?.id === input.messageId)
  if (index < 0) return
  const message = messages[index]
  if (message?.metadata?.spokenText === input.text) return
  messages[index] = {
    ...message,
    metadata: { ...(message.metadata || {}), spokenText: input.text },
  }
  db.update(subChats)
    .set({ messages: JSON.stringify(messages) })
    .where(eq(subChats.id, input.subChatId))
    .run()
}

export function searchVoiceHistory(query: string, chatId?: string) {
  const needle = `%${query.trim()}%`
  const matchesQuery = query.trim()
    ? or(
        like(voiceArtifacts.text, needle),
        like(voiceArtifacts.originLabel, needle),
        like(voiceArtifacts.adapterId, needle),
        like(voiceArtifacts.modelId, needle),
      )
    : undefined
  const where = chatId
    ? matchesQuery
      ? and(eq(voiceArtifacts.chatId, chatId), matchesQuery)
      : eq(voiceArtifacts.chatId, chatId)
    : matchesQuery
  const rows = getDatabase()
    .select()
    .from(voiceArtifacts)
    .where(where)
    .orderBy(desc(voiceArtifacts.createdAt))
    .limit(100)
    .all()
  return rows
}

export async function readSpeechAudio(id: string) {
  const artifact = getDatabase()
    .select()
    .from(voiceArtifacts)
    .where(eq(voiceArtifacts.id, id))
    .get()
  if (!artifact || !artifact.audioPath) throw new Error("Voice audio not found")
  const audio = await readFile(artifact.audioPath)
  getDatabase()
    .update(voiceArtifacts)
    .set({ lastPlayedAt: new Date() })
    .where(eq(voiceArtifacts.id, id))
    .run()
  return {
    audioBase64: audio.toString("base64"),
    mimeType: artifact.mimeType ?? "audio/wav",
    artifact,
  }
}

export async function deleteVoiceHistoryEntry(id: string) {
  const artifact = getDatabase()
    .select()
    .from(voiceArtifacts)
    .where(eq(voiceArtifacts.id, id))
    .get()
  if (!artifact) return { deleted: false }
  if (artifact.audioPath)
    await rm(join(historyRoot(), basename(id)), { recursive: true, force: true })
  getDatabase().delete(voiceArtifacts).where(eq(voiceArtifacts.id, id)).run()
  return { deleted: true }
}

export function getVoiceHistoryAudioPath(id: string) {
  const artifact = getDatabase()
    .select()
    .from(voiceArtifacts)
    .where(eq(voiceArtifacts.id, id))
    .get()
  return artifact?.audioPath && existsSync(artifact.audioPath) ? artifact.audioPath : null
}

async function pruneVoiceHistory() {
  const rows = getDatabase()
    .select()
    .from(voiceArtifacts)
    .where(isNotNull(voiceArtifacts.audioPath))
    .orderBy(desc(voiceArtifacts.createdAt))
    .all()
  let total = 0
  const cutoff = Date.now() - AUDIO_RETENTION_MS
  for (const row of rows) {
    total += row.byteLength
    if ((row.createdAt?.getTime() ?? 0) >= cutoff && total <= AUDIO_MAX_BYTES) continue
    if (row.audioPath)
      await rm(join(historyRoot(), basename(row.id)), { recursive: true, force: true })
    if (row.kind === "transcription") {
      getDatabase()
        .update(voiceArtifacts)
        .set({ audioPath: null, mimeType: null, byteLength: 0 })
        .where(eq(voiceArtifacts.id, row.id))
        .run()
    } else {
      getDatabase().delete(voiceArtifacts).where(eq(voiceArtifacts.id, row.id)).run()
    }
  }
}

function parseMessages(raw: string | null | undefined): any[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
