import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/flapstack-voice-test" } }))

import {
  createSpeechSynthesisKey,
  mergeMessagesPreservingSpokenText,
} from "../src/main/lib/speech/history"

describe("voice history persistence", () => {
  it("keeps spoken metadata written while a harness run is active", () => {
    const current = [
      { id: "assistant-old", role: "assistant", metadata: { spokenText: "Resolved speech" } },
    ]
    const incoming = [{ id: "assistant-old", role: "assistant", metadata: { model: "test" } }]
    expect(mergeMessagesPreservingSpokenText(current, incoming)[0]?.metadata).toEqual({
      model: "test",
      spokenText: "Resolved speech",
    })
  })

  it("changes the reuse key when voice, rate, adapter, or text changes", () => {
    const base = { text: "hello", adapterId: "native", voiceId: "Alex", rate: 1 }
    const key = createSpeechSynthesisKey(base)
    expect(createSpeechSynthesisKey(base)).toBe(key)
    expect(createSpeechSynthesisKey({ ...base, rate: 1.2 })).not.toBe(key)
    expect(createSpeechSynthesisKey({ ...base, voiceId: "Samantha" })).not.toBe(key)
  })
})
