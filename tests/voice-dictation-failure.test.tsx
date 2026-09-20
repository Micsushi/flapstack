// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  error: null as Error | null,
  start: vi.fn(),
  cancel: vi.fn(),
  finalize: vi.fn(),
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
      transcribe: { useMutation: () => state.mutation },
    },
  },
}))
vi.mock("../src/renderer/lib/hooks/use-voice-recording", () => ({
  useVoiceRecording: () => ({
    error: state.error,
    isRecording: !state.error,
    audioLevel: 0,
    startRecording: async () => {},
    stopRecording: async () => {
      throw state.error
    },
    cancelRecording: () => {},
    waitForPcm: async () => {},
  }),
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

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
