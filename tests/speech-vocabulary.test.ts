import { describe, expect, it } from "vitest"
import {
  MAX_SPEECH_VOCABULARY_TERM_LENGTH,
  buildSelectedSpeechVocabulary,
  resolveSpeechVocabularyHints,
} from "../src/shared/speech-vocabulary"

describe("selected-context speech vocabulary", () => {
  it("builds bounded inspectable terms only from the selected project, task, and Chat", () => {
    expect(
      buildSelectedSpeechVocabulary({
        project: " Flapstack\n",
        task: "Stage 6 vocabulary",
        chat: "Voice privacy",
      }),
    ).toEqual([
      { source: "project", value: "Flapstack" },
      { source: "task", value: "Stage 6 vocabulary" },
      { source: "chat", value: "Voice privacy" },
    ])
    expect(
      buildSelectedSpeechVocabulary({
        project: "x".repeat(MAX_SPEECH_VOCABULARY_TERM_LENGTH + 20),
      })[0]?.value,
    ).toHaveLength(MAX_SPEECH_VOCABULARY_TERM_LENGTH)
  })

  it("deduplicates terms deterministically and ignores unrelated context", () => {
    const unrelated = { hiddenPrompt: "PRIVATE", otherProject: "Unselected" }
    const terms = buildSelectedSpeechVocabulary({
      project: "Flapstack",
      task: "flapstack",
      chat: null,
      ...unrelated,
    })
    expect(terms).toEqual([{ source: "project", value: "Flapstack" }])
    expect(JSON.stringify(terms)).not.toContain("PRIVATE")
    expect(JSON.stringify(terms)).not.toContain("Unselected")
  })

  it("sends hints only to supporting local engines or explicitly consented cloud engines", () => {
    const terms = buildSelectedSpeechVocabulary({
      project: "Flapstack",
      task: "Stage 6",
      chat: "Voice",
    })
    expect(
      resolveSpeechVocabularyHints({ kind: "local", supportsVocabularyHints: true }, terms),
    ).toEqual(["Flapstack", "Stage 6", "Voice"])
    expect(
      resolveSpeechVocabularyHints({ kind: "local", supportsVocabularyHints: false }, terms),
    ).toEqual([])
    expect(
      resolveSpeechVocabularyHints({ kind: "cloud", supportsVocabularyHints: true }, terms),
    ).toEqual([])
    expect(
      resolveSpeechVocabularyHints({ kind: "cloud", supportsVocabularyHints: true }, terms, {
        allowCloudSelectedContext: true,
      }),
    ).toEqual(["Flapstack", "Stage 6", "Voice"])
  })
})
