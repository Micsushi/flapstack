import { afterEach, expect, it, vi } from "vitest"
vi.mock("../src/main/lib/credential-service", () => ({
  getCredentialService: () => ({ resolve: () => "sk-owned-test-fixture" }),
}))
vi.mock("../src/main/lib/speech/settings", () => ({
  getVoiceSettings: () => ({ cloudTranscriptionEnabled: true, sttAdapterId: "openai-whisper" }),
}))
import { cloudWhisperAdapter } from "../src/main/lib/speech/stt-cloud"
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function mockTransport() {
  const request = vi.fn(
    (_url, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = options.signal!
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      }),
  )
  vi.stubGlobal("fetch", request)
  return request
}
it("aborts an active cloud transport on user cancellation without reporting timeout", async () => {
  const fetch = mockTransport()
  const controller = new AbortController()
  const pending = cloudWhisperAdapter.transcribe({
    audioBuffer: Buffer.from("fixture"),
    format: "wav",
    signal: controller.signal,
  })
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" })
  expect(fetch).toHaveBeenCalledOnce()
  controller.abort()
  await rejected
})
it("does not dispatch a pre-cancelled request", async () => {
  const fetch = mockTransport()
  const controller = new AbortController()
  controller.abort()
  await expect(
    cloudWhisperAdapter.transcribe({
      audioBuffer: Buffer.from("fixture"),
      format: "wav",
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" })
  expect(fetch).not.toHaveBeenCalled()
})
it("retains the transport timeout when no cancellation was requested", async () => {
  vi.useFakeTimers()
  mockTransport()
  const pending = cloudWhisperAdapter.transcribe({
    audioBuffer: Buffer.from("fixture"),
    format: "wav",
  })
  const rejected = expect(pending).rejects.toThrow("Transcription timed out.")
  await vi.advanceTimersByTimeAsync(30_000)
  await rejected
})
