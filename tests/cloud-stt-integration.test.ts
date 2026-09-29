import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const fixture = vi.hoisted(() => ({ key: "sk-synthetic-cloud-integration" as string | null }))
vi.mock("electron", () => ({
  app: { getPath: () => process.env.FLAPSTACK_TEST_USER_DATA!, isPackaged: false },
  shell: {},
}))
vi.mock("../src/main/lib/credential-service", () => ({
  getCredentialService: () => ({ resolve: () => fixture.key }),
}))
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFileSync: vi.fn(() => ""), // Never inspect the user's shell for a credential.
}))
vi.mock("../src/main/lib/trpc/index", async () => {
  const { initTRPC } = await import("@trpc/server")
  const t = initTRPC.context<{ getWindow: () => { id: number } }>().create()
  return { publicProcedure: t.procedure, router: t.router }
})

import { closeDatabase, getDatabase, voiceArtifacts } from "../src/main/lib/db"
import * as schema from "../src/main/lib/db/schema"
import { sttAdapterImplementations } from "../src/main/lib/speech/registry"
import { getVoiceSettings } from "../src/main/lib/speech/settings"
import { cancelCloudTranscriptions, clearOpenAIKeyCache } from "../src/main/lib/speech/stt-cloud"
import { speechRouter } from "../src/main/lib/trpc/routers/speech"
import { voiceRouter } from "../src/main/lib/trpc/routers/voice"

const caller = (id: number) => voiceRouter.createCaller({ getWindow: () => ({ id }) } as never)
const settings = speechRouter.createCaller({ getWindow: () => ({ id: 1 }) } as never)
// A valid silent WAV, generated in memory: no microphone, playback, or real provider.
const audio = Buffer.alloc(46)
audio.write("RIFF", 0)
audio.writeUInt32LE(38, 4)
audio.write("WAVEfmt ", 8)
audio.writeUInt32LE(16, 16)
audio.writeUInt16LE(1, 20)
audio.writeUInt16LE(1, 22)
audio.writeUInt32LE(16_000, 24)
audio.writeUInt32LE(32_000, 28)
audio.writeUInt16LE(2, 32)
audio.writeUInt16LE(16, 34)
audio.write("data", 36)
audio.writeUInt32LE(2, 40)
const input = {
  sessionId: "owned-cloud",
  audio: audio.toString("base64"),
  format: "wav" as const,
  chatId: "cloud-chat",
  selectedContext: { task: "private-context-sentinel" },
}
let directory = ""
const request = vi.fn<typeof fetch>()
const rows = () => getDatabase().select().from(voiceArtifacts).all()
const enable = () =>
  settings.updateSettings({ cloudTranscriptionEnabled: true, sttAdapterId: "openai-whisper" })

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-cloud-integration-"))
  const databasePath = join(directory, "agents.db")
  vi.stubEnv("FLAPSTACK_DB_PATH", databasePath)
  vi.stubEnv("FLAPSTACK_CONFIG_DIR", directory)
  vi.stubEnv("FLAPSTACK_TEST_USER_DATA", directory)
  vi.stubEnv("OPENAI_API_KEY", "")
  vi.stubEnv("MAIN_VITE_OPENAI_API_KEY", "")
  fixture.key = "sk-synthetic-cloud-integration"
  clearOpenAIKeyCache()
  const sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare("INSERT INTO chats (id, name, scope, permission_mode) VALUES (?, ?, ?, ?)")
    .run("cloud-chat", "Synthetic cloud", "global", "read-only")
  sqlite.close()
  // Keep actual registry selection, but prevent local sidecars/provisioning in this cloud fixture.
  for (const adapter of sttAdapterImplementations.filter((item) => item.kind === "local")) {
    vi.spyOn(adapter, "isAvailable").mockResolvedValue({
      available: false,
      status: "unavailable",
      reason: "Fixture local unavailable",
    })
    if (adapter.canAutoProvision) vi.spyOn(adapter, "canAutoProvision").mockResolvedValue(false)
    vi.spyOn(adapter, "transcribe").mockRejectedValue(new Error("Unexpected local execution"))
  }
  request.mockReset().mockRejectedValue(new Error("Unexpected intercepted request"))
  vi.stubGlobal("fetch", request) // Fail closed: never call or retain the original network transport.
})

afterEach(() => {
  cancelCloudTranscriptions()
  closeDatabase()
  clearOpenAIKeyCache()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

it("requires persisted opt-in and selection, then retains only transcript provenance across reopen", async () => {
  await expect(caller(1).transcribe(input)).rejects.toThrow("Fixture local unavailable")
  await settings.updateSettings({
    sttAdapterId: "openai-whisper",
    cloudTranscriptionEnabled: false,
  })
  await expect(caller(1).transcribe(input)).rejects.toThrow("Fixture local unavailable")
  await settings.updateSettings({ cloudTranscriptionEnabled: true })
  await expect(caller(1).transcribe(input)).rejects.toThrow("Fixture local unavailable")
  await enable()
  fixture.key = null
  await expect(caller(1).transcribe(input)).rejects.toThrow("API key")
  expect(request).not.toHaveBeenCalled()
  expect(rows()).toEqual([])
  fixture.key = "sk-synthetic-cloud-integration"
  request.mockResolvedValueOnce(new Response("  Synthetic transcript\n", { status: 200 }))
  expect(await caller(1).transcribe(input)).toMatchObject({
    text: "Synthetic transcript",
    adapterId: "openai-whisper",
    historySaved: true,
  })
  expect(request).toHaveBeenCalledOnce()
  const [url, options] = request.mock.calls[0]!
  expect(url).toBe("https://api.openai.com/v1/audio/transcriptions")
  const form = options!.body as FormData
  expect(form.get("model")).toBe("whisper-1")
  expect(form.get("prompt")).toBeNull()
  expect(Buffer.from(await (form.get("file") as Blob).arrayBuffer())).toEqual(audio)
  const saved = rows()
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({
    chatId: "cloud-chat",
    text: "Synthetic transcript",
    adapterId: "openai-whisper",
    modelId: "whisper-1",
    audioPath: null,
    byteLength: 0,
  })
  closeDatabase()
  expect(rows()).toEqual(saved)
  expect(getVoiceSettings().sttAdapterId).toBe("openai-whisper")
  expect(existsSync(join(directory, "voice-history"))).toBe(false)
  const retained =
    JSON.stringify(rows()) + readFileSync(join(directory, "voice-settings.json"), "utf8")
  expect(retained).not.toContain(fixture.key)
  expect(retained).not.toContain(input.audio)
  expect(retained).not.toContain("private-context-sentinel")
})

it("persists nothing after provider or offline failure and permits the next owned request", async () => {
  await enable()
  for (const failure of [new Response("", { status: 401 }), new Error("Synthetic offline")]) {
    request.mockClear()
    if (failure instanceof Error) request.mockRejectedValueOnce(failure)
    else request.mockResolvedValueOnce(failure)
    await expect(caller(1).transcribe(input)).rejects.toThrow()
    expect(request).toHaveBeenCalledOnce()
    expect(rows()).toEqual([])
  }
  request.mockResolvedValueOnce(new Response("Recovered"))
  await expect(caller(1).transcribe(input)).resolves.toMatchObject({ historySaved: true })
  expect(rows()).toHaveLength(1)
})

it("propagates owned cancellation and persisted consent revocation through transport to history", async () => {
  for (const action of ["cancel", "disable"] as const) {
    await enable()
    let finish!: (response: Response) => void
    request.mockClear().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = caller(1).transcribe(input)
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    const signal = request.mock.calls[0]![1]!.signal!
    expect(await caller(2).cancelStreaming({ sessionId: input.sessionId })).toEqual({
      cancelled: false,
    })
    expect(signal.aborted).toBe(false)
    if (action === "cancel")
      expect(await caller(1).cancelStreaming({ sessionId: input.sessionId })).toEqual({
        cancelled: true,
      })
    else {
      await settings.updateSettings({ cloudTranscriptionEnabled: false })
      expect(getVoiceSettings().sttAdapterId).toBe("local-parakeet")
    }
    expect(signal.aborted).toBe(true)
    finish(new Response("Late transcript must not persist")) // Simulate a transport ignoring abort.
    await rejected
    closeDatabase()
    expect(rows()).toEqual([])
    expect(existsSync(join(directory, "voice-history"))).toBe(false)
  }
  await enable()
  request.mockResolvedValueOnce(new Response("New session"))
  await expect(caller(1).transcribe(input)).resolves.toMatchObject({ historySaved: true })
  expect(rows()).toHaveLength(1)
})
