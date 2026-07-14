import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { eq } from "drizzle-orm"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { closeDatabase, getDatabase, voiceArtifacts } from "../src/main/lib/db"
import * as schema from "../src/main/lib/db/schema"

vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.FLAPSTACK_TEST_USER_DATA || "/tmp/flapstack-voice-history-test",
    isPackaged: false,
  },
}))

import {
  reconcileVoiceHistory,
  recordSpeech,
  recordTranscription,
} from "../src/main/lib/speech/history"

let directory = ""
let databasePath = ""

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-voice-history-"))
  databasePath = join(directory, "agents.db")
  process.env.FLAPSTACK_DB_PATH = databasePath
  process.env.FLAPSTACK_CONFIG_DIR = directory
  process.env.FLAPSTACK_TEST_USER_DATA = directory
  const sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare(
      "INSERT INTO chats (id, name, scope, permission_mode) VALUES ('chat-1', 'Voice', 'global', 'read-only')",
    )
    .run()
  sqlite.close()
})

afterEach(() => {
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  delete process.env.FLAPSTACK_CONFIG_DIR
  delete process.env.FLAPSTACK_TEST_USER_DATA
  rmSync(directory, { recursive: true, force: true })
})

describe("Voice history durable audio", () => {
  it("finalizes audio before publishing its metadata row", async () => {
    const transcription = await recordTranscription({
      chatId: "chat-1",
      text: "staged dictation",
      adapterId: "local-parakeet",
      audioWav: Buffer.from("dictation-audio"),
    })
    const speech = await recordSpeech({
      chatId: "chat-1",
      text: "staged speech",
      result: {
        audioBase64: Buffer.from("speech-audio").toString("base64"),
        mimeType: "audio/wav",
        adapterId: "native-os",
      },
      synthesisKey: "speech-key",
      rate: 1,
    })

    expect(transcription.audioPath && existsSync(transcription.audioPath)).toBe(true)
    expect(speech.audioPath && existsSync(speech.audioPath)).toBe(true)
    expect(
      getDatabase()
        .select({ id: voiceArtifacts.id, audioPath: voiceArtifacts.audioPath })
        .from(voiceArtifacts)
        .all(),
    ).toEqual(
      expect.arrayContaining([
        { id: transcription.id, audioPath: transcription.audioPath },
        { id: speech.id, audioPath: speech.audioPath },
      ]),
    )
  })

  it("reconciles missing-row, missing-file, and staged crash windows", async () => {
    const root = join(directory, "voice-history")
    const orphanDirectory = join(root, "orphan-final")
    const stagingDirectory = join(root, ".stage-crashed")
    mkdirSync(orphanDirectory, { recursive: true })
    mkdirSync(stagingDirectory, { recursive: true })
    writeFileSync(join(orphanDirectory, "speech.wav"), "orphan")
    writeFileSync(join(stagingDirectory, "dictation.wav"), "staged")
    const db = getDatabase()
    db.insert(voiceArtifacts)
      .values([
        {
          id: "missing-speech",
          chatId: "chat-1",
          kind: "speech",
          text: "missing speech",
          adapterId: "native-os",
          audioPath: join(root, "missing-speech", "speech.wav"),
          mimeType: "audio/wav",
          byteLength: 10,
        },
        {
          id: "missing-transcription",
          chatId: "chat-1",
          kind: "transcription",
          text: "keep text",
          adapterId: "local-parakeet",
          audioPath: join(root, "missing-transcription", "dictation.wav"),
          mimeType: "audio/wav",
          byteLength: 10,
        },
      ])
      .run()

    await expect(reconcileVoiceHistory()).resolves.toEqual({ repairedRows: 2, removedEntries: 2 })
    expect(
      db.select().from(voiceArtifacts).where(eq(voiceArtifacts.id, "missing-speech")).get(),
    ).toBeUndefined()
    expect(
      db
        .select({
          audioPath: voiceArtifacts.audioPath,
          mimeType: voiceArtifacts.mimeType,
          byteLength: voiceArtifacts.byteLength,
        })
        .from(voiceArtifacts)
        .where(eq(voiceArtifacts.id, "missing-transcription"))
        .get(),
    ).toEqual({ audioPath: null, mimeType: null, byteLength: 0 })
    expect(existsSync(orphanDirectory)).toBe(false)
    expect(existsSync(stagingDirectory)).toBe(false)
  })
})
