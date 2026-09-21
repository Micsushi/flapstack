import { afterEach, beforeEach, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({
  enabled: false,
  adapter: "local-parakeet",
  key: "sk-synthetic-test" as string | null,
}))
vi.mock("../src/main/lib/speech/settings", async (original) => ({
  ...(await original<typeof import("../src/main/lib/speech/settings")>()),
  getVoiceSettings: () => ({
    cloudTranscriptionEnabled: state.enabled,
    sttAdapterId: state.adapter,
  }),
}))
vi.mock("../src/main/lib/credential-service", () => ({
  getCredentialService: () => ({ resolve: () => state.key }),
}))
vi.mock("node:child_process", () => ({ execFileSync: vi.fn(() => "") }))
import {
  cloudWhisperAdapter,
  cancelCloudTranscriptions,
  clearOpenAIKeyCache,
} from "../src/main/lib/speech/stt-cloud"
import { normalizeVoiceSettings } from "../src/main/lib/speech/settings"
const input = { audioBuffer: Buffer.from("synthetic audio"), format: "wav" as const }
beforeEach(() => {
  state.enabled = true
  state.adapter = "openai-whisper"
  state.key = "sk-synthetic-test"
  vi.stubEnv("OPENAI_API_KEY", "")
  vi.stubEnv("MAIN_VITE_OPENAI_API_KEY", "")
  clearOpenAIKeyCache()
})
afterEach(() => {
  cancelCloudTranscriptions()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
it("requires consent and explicit selection even for a direct adapter call", async () => {
  const request = vi.fn()
  vi.stubGlobal("fetch", request)
  for (const [enabled, adapter] of [
    [false, "openai-whisper"],
    [true, "local-whisper"],
  ] as const) {
    state.enabled = enabled
    state.adapter = adapter
    expect((await cloudWhisperAdapter.isAvailable()).available).toBe(false)
    await expect(cloudWhisperAdapter.transcribe(input)).rejects.toThrow("explicitly select")
  }
  expect(request).not.toHaveBeenCalled()
})
it("migrates old cloud selections to local and disabling consent restores local default", () => {
  expect(
    normalizeVoiceSettings({ voiceSettingsVersion: 2, sttAdapterId: "openai-whisper" })
      .sttAdapterId,
  ).toBe("local-parakeet")
  expect(
    normalizeVoiceSettings({
      voiceSettingsVersion: 2,
      sttAdapterId: "openai-whisper",
      cloudTranscriptionEnabled: true,
    }).sttAdapterId,
  ).toBe("openai-whisper")
  expect(
    normalizeVoiceSettings({
      voiceSettingsVersion: 2,
      sttAdapterId: "openai-whisper",
      cloudTranscriptionEnabled: false,
    }).sttAdapterId,
  ).toBe("local-parakeet")
})
it("requires configured authority before network access", async () => {
  state.key = null
  const request = vi.fn()
  vi.stubGlobal("fetch", request)
  await expect(cloudWhisperAdapter.transcribe(input)).rejects.toThrow("API key not configured")
  expect(request).not.toHaveBeenCalled()
})
it("returns engine provenance through the existing provider request without retaining audio", async () => {
  const request = vi.fn().mockResolvedValue(new Response("Known transcript", { status: 200 }))
  vi.stubGlobal("fetch", request)
  expect(await cloudWhisperAdapter.transcribe(input)).toEqual({
    text: "Known transcript",
    adapterId: "openai-whisper",
  })
  const [url, options] = request.mock.calls[0]!
  expect(url).toBe("https://api.openai.com/v1/audio/transcriptions")
  expect(options.body.get("model")).toBe("whisper-1")
  expect(options.body.get("prompt")).toBeNull()
})
it.each([401, 429, 500])("reports provider failure %s without automatic retry", async (status) => {
  const request = vi.fn().mockResolvedValue(new Response("", { status }))
  vi.stubGlobal("fetch", request)
  await expect(cloudWhisperAdapter.transcribe(input)).rejects.toThrow()
  expect(request).toHaveBeenCalledOnce()
})
it("disable aborts active transport and rejects a late result even if transport ignores abort", async () => {
  let finish!: (response: Response) => void
  const request = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
  )
  vi.stubGlobal("fetch", request)
  const pending = cloudWhisperAdapter.transcribe(input)
  const rejected = expect(pending).rejects.toThrow("Cloud transcription disabled")
  state.enabled = false
  cancelCloudTranscriptions()
  expect(request.mock.calls[0]![1].signal.aborted).toBe(true)
  finish(new Response("Must not reach history"))
  await rejected
})
