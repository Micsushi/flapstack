import { beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ transcribe: vi.fn(), history: vi.fn(), available: vi.fn() }))
vi.mock("../src/main/lib/trpc/index", async () => {
  const { initTRPC } = await import("@trpc/server")
  const t = initTRPC.context<{ getWindow: () => { id: number } }>().create()
  return { publicProcedure: t.procedure, router: t.router }
})
vi.mock("../src/main/lib/speech/registry", () => ({
  resolveAvailableSttAdapter: async () => ({
    id: "local-whisper",
    kind: "local",
    supportsVocabularyHints: true,
    isAvailable: state.available,
    transcribe: state.transcribe,
  }),
  sttAdapterImplementations: [],
}))
vi.mock("../src/main/lib/speech/settings", () => ({
  getVoiceSettings: () => ({ whisperModelId: "base" }),
}))
vi.mock("../src/main/lib/speech/stt-cloud", () => ({
  clearOpenAIKeyCache: vi.fn(),
  getOpenAIApiKey: vi.fn(),
}))
vi.mock("../src/main/lib/credential-service", () => ({ getCredentialService: vi.fn() }))
vi.mock("../src/main/lib/speech/history", () => ({ recordTranscription: state.history }))
vi.mock("../src/main/lib/speech/stt-parakeet-streaming", () => ({
  parakeetSidecar: { cancel: vi.fn() },
}))
import { voiceRouter } from "../src/main/lib/trpc/routers/voice"
const caller = (id: number) => voiceRouter.createCaller({ getWindow: () => ({ id }) } as never)
const input = { sessionId: "owned-batch", audio: "dGVzdA==", format: "wav" as const }
beforeEach(() => {
  vi.clearAllMocks()
  state.available.mockResolvedValue({ available: true })
  state.history.mockResolvedValue({})
})
it("aborts only the owning window and rejects a late result before history", async () => {
  let finish!: (value: { text: string; adapterId: string }) => void
  let signal!: AbortSignal
  state.transcribe.mockImplementation((value) => {
    signal = value.signal
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const pending = caller(1).transcribe(input)
  const rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(state.transcribe).toHaveBeenCalledOnce())
  await caller(2).cancelStreaming({ sessionId: input.sessionId })
  expect(signal.aborted).toBe(false)
  await caller(1).cancelStreaming({ sessionId: input.sessionId })
  expect(signal.aborted).toBe(true)
  finish({ text: "late words", adapterId: "local-whisper" })
  await rejected
  expect(state.history).not.toHaveBeenCalled()
  state.transcribe.mockResolvedValue({ text: "new words", adapterId: "local-whisper" })
  expect(await caller(1).transcribe(input)).toMatchObject({ text: "new words", historySaved: true })
  expect(state.history).toHaveBeenCalledWith(
    expect.objectContaining({ adapterId: "local-whisper", modelId: "base" }),
  )
})
it("cancels while readiness is pending without invoking the adapter", async () => {
  let ready!: (value: { available: boolean }) => void
  state.available.mockReturnValue(
    new Promise((resolve) => {
      ready = resolve
    }),
  )
  const pending = caller(1).transcribe(input)
  const rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(state.available).toHaveBeenCalledOnce())
  await caller(1).cancelStreaming({ sessionId: input.sessionId })
  ready({ available: true })
  await rejected
  expect(state.transcribe).not.toHaveBeenCalled()
  expect(state.history).not.toHaveBeenCalled()
})

it("reports too late once successful persistence starts", async () => {
  let saved!: () => void
  state.transcribe.mockResolvedValue({ text: "completed words", adapterId: "local-whisper" })
  state.history.mockReturnValue(
    new Promise<void>((resolve) => {
      saved = resolve
    }),
  )
  const pending = caller(1).transcribe(input)
  await vi.waitFor(() => expect(state.history).toHaveBeenCalledOnce())
  expect(await caller(1).cancelStreaming({ sessionId: input.sessionId })).toEqual({
    cancelled: false,
  })
  saved()
  expect(await pending).toMatchObject({ text: "completed words", historySaved: true })
})
