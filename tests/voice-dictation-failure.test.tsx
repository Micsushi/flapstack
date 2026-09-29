// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  error: null as Error | null,
  start: vi.fn(),
  cancel: vi.fn(),
  finalize: vi.fn(),
  stopRecording: vi.fn(),
  transcribe: vi.fn(),
  mutation: { mutate: vi.fn(), mutateAsync: vi.fn() },
  settings: { sttAdapterId: "local-parakeet" },
  utils: { speech: { getSettings: { invalidate: vi.fn() } } },
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    useUtils: () => state.utils,
    speech: {
      getSettings: { useQuery: () => ({ data: state.settings }) },
      updateSettings: { useMutation: () => state.mutation },
    },
    voice: {
      startStreaming: { useMutation: () => ({ mutateAsync: state.start }) },
      cancelStreaming: { useMutation: () => ({ mutateAsync: state.cancel, mutate: state.cancel }) },
      finalizeStreaming: { useMutation: () => ({ mutateAsync: state.finalize }) },
      feedStreaming: { useMutation: () => state.mutation },
      transcribe: { useMutation: () => ({ mutateAsync: state.transcribe }) },
    },
  },
}))
vi.mock("../src/renderer/lib/hooks/use-voice-recording", () => ({
  blobToBase64: async () => "audio-fixture",
  getAudioFormat: () => "wav",
  useVoiceRecording: () => ({
    error: state.error,
    isRecording: !state.error,
    audioLevel: 0,
    startRecording: async () => {},
    stopRecording: () => state.stopRecording(),
    cancelRecording: () => {},
    waitForPcm: async () => {},
  }),
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
import { toast } from "sonner"
beforeEach(() => {
  vi.clearAllMocks()
  state.error = null
  state.settings.sttAdapterId = "local-parakeet"
  state.stopRecording.mockImplementation(async () => {
    throw state.error
  })
})

import {
  DictationSessionProvider,
  useDictationSession,
} from "../src/renderer/features/agents/voice/dictation-session"

it("cancels the owned streaming session after microphone failure during pending startup", async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement("div"))
  let session!: ReturnType<typeof useDictationSession>
  let finishStartup!: () => void
  state.start.mockReturnValue(
    new Promise<void>((resolve) => {
      finishStartup = resolve
    }),
  )
  state.cancel.mockResolvedValue(undefined)
  const logged = vi.spyOn(console, "error").mockImplementation(() => {})
  function Harness() {
    session = useDictationSession()
    return null
  }
  const render = () =>
    root.render(createElement(DictationSessionProvider, null, createElement(Harness)))
  try {
    await act(async () => render())
    let starting!: Promise<void>
    const commitText = vi.fn()
    await act(async () => {
      starting = session.start({
        key: "owned",
        projectLabel: "Fixture",
        chatLabel: "Fixture",
        getText: () => "existing draft",
        commitText,
        showText: vi.fn(),
      })
    })
    await act(async () => {
      state.error = new Error("Microphone disconnected")
      render()
    })
    expect(state.cancel).not.toHaveBeenCalled()
    await act(async () => {
      finishStartup()
      await starting
    })
    expect(state.cancel).toHaveBeenCalledExactlyOnceWith({ sessionId: expect.any(String) })
    expect(state.finalize).not.toHaveBeenCalled()
    expect(session.activeTargetKey).toBeNull()
    expect(commitText).toHaveBeenCalledExactlyOnceWith("existing draft")
  } finally {
    await act(async () => root.unmount())
    logged.mockRestore()
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  }
})

it.each(["normalizing", "transcribing", "completed", "streaming-completed"])(
  "handles batch cancellation while %s without losing the draft",
  async (phase) => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    state.settings.sttAdapterId =
      phase === "streaming-completed" ? "local-parakeet" : "local-whisper"
    state.start.mockResolvedValue(undefined)
    state.cancel.mockResolvedValue({ cancelled: !phase.endsWith("completed") })
    let finish!: () => void
    const blob = new Blob(["a".repeat(2000)], { type: "audio/wav" })
    if (phase === "normalizing")
      state.stopRecording.mockReturnValue(
        new Promise((resolve) => {
          finish = () => resolve(blob)
        }),
      )
    else {
      state.stopRecording.mockResolvedValue(blob)
      const transcribe = phase === "streaming-completed" ? state.finalize : state.transcribe
      transcribe.mockReturnValue(
        new Promise((resolve) => {
          finish = () => resolve({ text: "new words", historySaved: true })
        }),
      )
    }
    let session!: ReturnType<typeof useDictationSession>
    function Harness() {
      session = useDictationSession()
      return null
    }
    const root = createRoot(document.createElement("div"))
    const commitText = vi.fn()
    try {
      await act(async () =>
        root.render(createElement(DictationSessionProvider, null, createElement(Harness))),
      )
      await act(async () =>
        session.start({
          key: "batch",
          projectLabel: "Fixture",
          chatLabel: "Fixture",
          getText: () => "existing draft",
          commitText,
          showText: vi.fn(),
        }),
      )
      let stopping!: Promise<void>, cancelling!: Promise<void>
      await act(async () => {
        stopping = session.stop()
      })
      expect(session.isTranscribing).toBe(true)
      await act(async () => {
        cancelling = session.cancel()
      })
      await act(async () => {
        finish()
        await Promise.all([stopping, cancelling])
      })
      if (phase === "normalizing" || phase === "streaming-completed")
        expect(state.transcribe).not.toHaveBeenCalled()
      else
        expect(state.transcribe).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: expect.any(String), audio: "audio-fixture" }),
        )
      if (phase.endsWith("completed"))
        expect(commitText).toHaveBeenLastCalledWith("existing draft new words")
      else expect(commitText).toHaveBeenCalledExactlyOnceWith("existing draft")
      expect(toast.error).not.toHaveBeenCalled()
      expect(session.isTranscribing).toBe(false)
    } finally {
      await act(async () => root.unmount())
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    }
  },
)

it.each(["local-whisper", "openai-whisper"])(
  "awaits finishing %s dictation without cancelling its transcript",
  async (adapterId) => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    state.settings.sttAdapterId = adapterId
    state.stopRecording.mockResolvedValue(new Blob(["a".repeat(2000)], { type: "audio/wav" }))
    let finish!: () => void
    state.transcribe.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ text: "dictated words", historySaved: true })
      }),
    )
    let session!: ReturnType<typeof useDictationSession>
    function Harness() {
      session = useDictationSession()
      return null
    }
    const root = createRoot(document.createElement("div"))
    const commitText = vi.fn()
    try {
      await act(async () =>
        root.render(createElement(DictationSessionProvider, null, createElement(Harness))),
      )
      await act(async () =>
        session.start({
          key: "send",
          projectLabel: "Fixture",
          chatLabel: "Fixture",
          getText: () => "existing draft",
          commitText,
          showText: vi.fn(),
        }),
      )
      let stopping!: Promise<void>, sending!: Promise<void>
      await act(async () => {
        stopping = session.stop()
      })
      expect(session.isTranscribing).toBe(true)
      await act(async () => {
        sending = session.stop()
      })
      expect(state.cancel).not.toHaveBeenCalled()
      expect(commitText).toHaveBeenCalledExactlyOnceWith("existing draft")
      await act(async () => {
        finish()
        await Promise.all([stopping, sending])
      })
      expect(commitText).toHaveBeenLastCalledWith("existing draft dictated words")
      expect(state.cancel).not.toHaveBeenCalled()
      expect(session.isTranscribing).toBe(false)
    } finally {
      await act(async () => root.unmount())
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    }
  },
)
