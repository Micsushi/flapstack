import { afterEach, describe, expect, it, vi } from "vitest"
import { composeDictationDraft, StreamingTranscriptState } from "../src/shared/streaming-transcript"
import {
  captureVoiceHistoryInsertTarget,
  clearVoiceHistoryInsertTargetsForTest,
  insertVoiceHistoryIntoTarget,
  registerVoiceHistoryInsertTarget,
} from "../src/renderer/lib/voice-history-insert"

afterEach(() => clearVoiceHistoryInsertTargetsForTest())

describe("committed and tentative streaming transcript", () => {
  it("preserves the initial draft while tentative text revises", () => {
    const transcript = new StreamingTranscriptState()
    const update = transcript.apply({ committed: "hello ", tentative: "wor" })
    expect(update).toEqual({
      committed: "hello",
      tentative: "wor",
    })
    expect(composeDictationDraft("existing", update.committed, update.tentative)).toBe(
      "existing hello wor",
    )
  })

  it("rejects a sidecar update that rewrites committed text", () => {
    const transcript = new StreamingTranscriptState()
    transcript.apply({ committed: "stable words", tentative: "next" })
    expect(() => transcript.apply({ committed: "changed words", tentative: "" })).toThrow(
      "committed text regressed",
    )
  })
})

describe("Voice History insertion ownership", () => {
  it("captures one immutable composer target and inserts exactly once", () => {
    const chatA = vi.fn()
    const chatB = vi.fn()
    registerVoiceHistoryInsertTarget("chat:a", chatA)
    registerVoiceHistoryInsertTarget("chat:b", chatB)
    const target = captureVoiceHistoryInsertTarget()
    expect(target).toBe("chat:b")
    expect(insertVoiceHistoryIntoTarget(target!, "dictated text")).toBe(true)
    expect(chatA).not.toHaveBeenCalled()
    expect(chatB).toHaveBeenCalledOnce()
  })
})
