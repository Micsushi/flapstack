// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { defaultVoiceSettings } from "../src/main/lib/speech/types"
const state = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, update: vi.fn() }))
vi.mock("../src/renderer/lib/trpc", () => {
  const mutation = { useMutation: () => ({ mutate: state.update, isPending: false }) }
  return {
    trpc: {
      useUtils: () => ({}),
      voice: { hasOpenAIKey: { useQuery: () => ({ data: { hasKey: false } }) } },
      speech: {
        getSettings: { useQuery: () => ({ data: state.settings }) },
        listAdapters: {
          useQuery: () => ({
            data: {
              stt: [
                { id: "local-parakeet", label: "Local", kind: "local" },
                { id: "openai-whisper", label: "OpenAI Whisper", kind: "cloud" },
              ],
              tts: [],
              availability: { stt: {}, tts: {} },
            },
          }),
        },
        listVoices: { useQuery: () => ({ data: { voices: [] } }) },
        listSttModels: { useQuery: () => ({ data: [] }) },
        searchHistory: { useQuery: () => ({ data: [] }) },
        getSttModelStatus: { useQuery: () => ({ data: { status: "missing" } }) },
        updateSettings: mutation,
        speak: mutation,
        stopSpeaking: mutation,
        deleteHistoryEntry: mutation,
        revealHistoryAudio: mutation,
        downloadSttModel: mutation,
      },
    },
  }
})
import { AgentsVoiceTab } from "../src/renderer/components/dialogs/settings-tabs/agents-voice-tab"
it("requires an explicit consent toggle before cloud selection and exposes revocation", async () => {
  state.settings = { ...defaultVoiceSettings }
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement("div"),
    root = createRoot(container)
  document.body.appendChild(container)
  try {
    await act(async () => root.render(<AgentsVoiceTab />))
    const option = () =>
      container.querySelector<HTMLOptionElement>('option[value="openai-whisper"]')!
    const consent = () =>
      [...container.querySelectorAll<HTMLLabelElement>("label")]
        .find((label) => label.textContent?.includes("Allow cloud transcription"))!
        .querySelector<HTMLInputElement>("input")!
    expect(option().disabled).toBe(true)
    await act(async () => consent().click())
    expect(state.update).toHaveBeenLastCalledWith({ cloudTranscriptionEnabled: true })
    expect(state.settings.sttAdapterId).toBe("local-parakeet")
    state.settings = { ...defaultVoiceSettings, cloudTranscriptionEnabled: true }
    await act(async () => root.render(<AgentsVoiceTab />))
    expect(option().disabled).toBe(false)
    const select = container.querySelector<HTMLSelectElement>(
      '[aria-label="Transcription engine"]',
    )!
    await act(async () => {
      select.value = "openai-whisper"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(state.update).toHaveBeenLastCalledWith({ sttAdapterId: "openai-whisper" })
    await act(async () => consent().click())
    expect(state.update).toHaveBeenLastCalledWith({ cloudTranscriptionEnabled: false })
    expect(container.textContent).toContain("Local errors never trigger an automatic upload")
  } finally {
    await act(async () => root.unmount())
    container.remove()
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  }
})
