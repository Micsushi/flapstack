// @vitest-environment jsdom

import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { TooltipProvider } from "../src/renderer/components/ui/tooltip"

const transport = vi.hoisted(() => ({
  transcribe: vi.fn(),
  cancel: vi.fn(),
  mutation: { mutate: vi.fn(), mutateAsync: vi.fn() },
  settings: { sttAdapterId: "local-whisper" },
  utils: { speech: { getSettings: { invalidate: vi.fn() } } },
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    useUtils: () => transport.utils,
    speech: {
      getSettings: { useQuery: () => ({ data: transport.settings }) },
      updateSettings: { useMutation: () => transport.mutation },
    },
    voice: {
      startStreaming: { useMutation: () => transport.mutation },
      cancelStreaming: { useMutation: () => ({ mutateAsync: transport.cancel }) },
      finalizeStreaming: { useMutation: () => transport.mutation },
      feedStreaming: { useMutation: () => transport.mutation },
      transcribe: { useMutation: () => ({ mutateAsync: transport.transcribe }) },
    },
  },
}))
vi.mock("../src/renderer/lib/hooks/use-voice-recording", async () => {
  const { useState } = await import("react")
  return {
    blobToBase64: async () => "owned-synthetic-audio",
    getAudioFormat: () => "wav",
    useVoiceRecording: () => {
      const [isRecording, setRecording] = useState(false)
      return {
        error: null,
        isRecording,
        audioLevel: 0,
        startRecording: async () => setRecording(true),
        stopRecording: async () => {
          setRecording(false)
          return new Blob(["a".repeat(2000)], { type: "audio/wav" })
        },
        cancelRecording: () => setRecording(false),
        waitForPcm: async () => {},
      }
    },
  }
})
vi.mock("../src/renderer/lib/hotkeys", () => ({
  useResolvedHotkeyDisplay: () => null,
  useResolvedHotkeyDisplayWithAlt: () => ({ primary: null, alt: null }),
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

import { AgentVoiceButton } from "../src/renderer/features/agents/components/agent-send-button"
import {
  DictationSessionProvider,
  useDictationSession,
} from "../src/renderer/features/agents/voice/dictation-session"

it.each(["local-whisper", "openai-whisper"])(
  "cancels finishing %s dictation without replacing the draft",
  async (adapterId) => {
    transport.settings.sttAdapterId = adapterId
    vi.clearAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    let complete!: (result: { text: string; historySaved: boolean }) => void
    transport.transcribe.mockReturnValue(new Promise((resolve) => (complete = resolve)))
    transport.cancel.mockResolvedValue({ cancelled: true })
    function ComposerFixture() {
      const session = useDictationSession()
      const [draft, setDraft] = useState("existing draft")
      return (
        <div data-testid="composer">
          <output>{draft}</output>
          <AgentVoiceButton
            isRecording={session.isRecording}
            isStarting={session.isStarting}
            isTranscribing={session.isTranscribing}
            canCancelTranscription={session.canCancelTranscription}
            voiceInputReady
            onStart={() =>
              void session.start({
                key: "owned-composer",
                projectLabel: "Fixture",
                chatLabel: "Fixture",
                getText: () => draft,
                commitText: setDraft,
                showText: setDraft,
              })
            }
            onStop={() => void (session.isTranscribing ? session.cancel() : session.stop())}
          />
          <span data-testid="owner">{session.activeTargetKey ?? "idle"}</span>
        </div>
      )
    }
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const button = (label: string) => {
      const found = container.querySelector<HTMLButtonElement>(
        `[data-testid="composer"] button[aria-label="${label}"]`,
      )
      expect(found).not.toBeNull()
      expect(found!.disabled).toBe(false)
      return found!
    }
    try {
      await act(async () =>
        root.render(
          <TooltipProvider>
            <DictationSessionProvider>
              <ComposerFixture />
            </DictationSessionProvider>
          </TooltipProvider>,
        ),
      )
      await act(async () => button("Start dictation").click())
      await act(async () => button("Pause dictation").click())
      expect(transport.transcribe).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ sessionId: expect.any(String), audio: "owned-synthetic-audio" }),
      )
      await act(async () => button("Cancel transcription").click())
      expect(transport.cancel).toHaveBeenCalledExactlyOnceWith({
        sessionId: transport.transcribe.mock.calls[0][0].sessionId,
      })
      await act(async () => complete({ text: "late unwanted words", historySaved: false }))
      expect(container.querySelector("output")?.textContent).toBe("existing draft")
      expect(container.querySelector('[data-testid="owner"]')?.textContent).toBe("idle")
      button("Start dictation")
      expect(container.querySelector('[aria-label="Cancel transcription"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    }
  },
)
