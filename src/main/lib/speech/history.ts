import { and, desc, eq, like } from "drizzle-orm"
import { app } from "electron"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { chats, getDatabase, voiceArtifacts } from "../db"
import type { TtsResult } from "./types"

const AUDIO_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const AUDIO_MAX_BYTES = 500 * 1024 * 1024

function historyRoot() {
  return join(app.getPath("userData"), "voice-history")
}

function requireChat(chatId: string) {
  const chat = getDatabase().select().from(chats).where(eq(chats.id, chatId)).get()
  if (!chat) throw new Error("Chat not found")
}

export function recordTranscription(input: {
  chatId: string
  subChatId?: string | null
  text: string
  adapterId: string
}) {
  requireChat(input.chatId)
  return getDatabase()
    .insert(voiceArtifacts)
    .values({
      chatId: input.chatId,
      subChatId: input.subChatId ?? null,
      kind: "transcription",
      text: input.text,
      adapterId: input.adapterId,
    })
    .returning()
    .get()
}

export async function recordSpeech(input: {
  chatId: string
  subChatId?: string | null
  messageId?: string | null
  text: string
  result: TtsResult
}) {
  requireChat(input.chatId)
  const bytes = Buffer.from(input.result.audioBase64, "base64")
  const extension = input.result.mimeType === "audio/mpeg" ? "mp3" : "wav"
  const artifact = getDatabase()
    .insert(voiceArtifacts)
    .values({
      chatId: input.chatId,
      subChatId: input.subChatId ?? null,
      messageId: input.messageId ?? null,
      kind: "speech",
      text: input.text,
      adapterId: input.result.adapterId,
      mimeType: input.result.mimeType,
      byteLength: bytes.length,
    })
    .returning()
    .get()
  const directory = join(historyRoot(), artifact.id)
  const audioPath = join(directory, `speech.${extension}`)
  await mkdir(directory, { recursive: true })
  await writeFile(audioPath, bytes)
  const saved = getDatabase()
    .update(voiceArtifacts)
    .set({ audioPath })
    .where(eq(voiceArtifacts.id, artifact.id))
    .returning()
    .get()
  await pruneVoiceHistory()
  return saved
}

export function searchVoiceHistory(query: string, chatId?: string) {
  const needle = `%${query.trim()}%`
  const where = chatId
    ? query.trim()
      ? and(eq(voiceArtifacts.chatId, chatId), like(voiceArtifacts.text, needle))
      : eq(voiceArtifacts.chatId, chatId)
    : query.trim()
      ? like(voiceArtifacts.text, needle)
      : undefined
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
  if (!artifact || artifact.kind !== "speech" || !artifact.audioPath)
    throw new Error("Speech audio not found")
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

async function pruneVoiceHistory() {
  const rows = getDatabase()
    .select()
    .from(voiceArtifacts)
    .where(eq(voiceArtifacts.kind, "speech"))
    .orderBy(desc(voiceArtifacts.createdAt))
    .all()
  let total = 0
  const cutoff = Date.now() - AUDIO_RETENTION_MS
  for (const row of rows) {
    total += row.byteLength
    if ((row.createdAt?.getTime() ?? 0) >= cutoff && total <= AUDIO_MAX_BYTES) continue
    if (row.audioPath)
      await rm(join(historyRoot(), basename(row.id)), { recursive: true, force: true })
    getDatabase().delete(voiceArtifacts).where(eq(voiceArtifacts.id, row.id)).run()
  }
}
