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
