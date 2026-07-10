import { describe, expect, it, vi } from "vitest"
import {
  resolveSttAdapter,
  resolveAvailableSttAdapter,
  resolveTtsAdapter,
  sttAdapterImplementations,
  sttAdapters,
  ttsAdapters,
} from "../src/main/lib/speech/registry"
import { normalizeVoiceSettings, resolveReadAloudEnabled } from "../src/main/lib/speech/settings"
import { extractSpokenSection, filterSpeakableText } from "../src/main/lib/speech/speakable-filter"
import { createFallbackSpokenSummary } from "../src/main/lib/speech/spoken-summary"
import { encodeWav, getKokoroChunks } from "../src/main/lib/speech/tts-kokoro"
import { parseWindowsVoices } from "../src/main/lib/speech/tts-native"
import { requiresAudioConversion } from "../src/main/lib/speech/stt-whisper-cpp"
import {
  appendReadAloudInstruction,
  READ_ALOUD_INSTRUCTION,
} from "../src/main/lib/speech/read-aloud-instruction"
import { speakWithTtsFallback } from "../src/main/lib/speech/tts-fallback"
import type { TtsAdapter } from "../src/main/lib/speech/types"

describe("speakable filter", () => {
  it("extracts only the Spoken section", () => {
    const reply = [
      "Spoken:",
      "I fixed the login bug and added a test.",
      "",
      "Displayed:",
      "```ts",
      "const x = 1",
      "```",
    ].join("\n")

    const section = extractSpokenSection(reply)
    expect(section).toContain("I fixed the login bug")
    expect(section).not.toContain("const x")

    const result = filterSpeakableText(reply)
    expect(result.shouldSpeak).toBe(true)
    expect(result.source).toBe("spoken")
    expect(result.text).not.toContain("const x")
  })

  it("falls back to prose when there is no Spoken section", () => {
    const result = filterSpeakableText("I updated the config and everything passes now.")
    expect(result.shouldSpeak).toBe(true)
    expect(result.source).toBe("prose")
  })

  it("skips replies that are only code / tables", () => {
    const reply = ["```ts", "const a = 1", "```", "| a | b |", "| --- | --- |"].join("\n")
    const result = filterSpeakableText(reply)
    expect(result.shouldSpeak).toBe(false)
  })
})

describe("spoken fallback summary", () => {
  it("strips code and markdown from the fallback", () => {
    const summary = createFallbackSpokenSummary("Here is `code` and **bold** text.")
    expect(summary).not.toContain("`")
    expect(summary).not.toContain("**")
  })

  it("truncates very long content with a screen pointer", () => {
    const long = "word ".repeat(400)
    const summary = createFallbackSpokenSummary(long)
    expect(summary.length).toBeLessThan(long.length)
    expect(summary).toContain("on screen")
  })
})

describe("adapter registry", () => {
  it("exposes local-first STT and Kokoro-default TTS adapters", () => {
    expect(sttAdapters.map((a) => a.id)).toEqual(["local-whisper"])
    expect(ttsAdapters.map((a) => a.id)).toEqual(["kokoro", "native-os"])
  })

  it("falls back to the local adapter for an obsolete cloud selection", () => {
    const adapter = resolveSttAdapter({ sttAdapterId: "openai-whisper", preferOffline: true })
    expect(adapter.id).toBe("local-whisper")
  })

  it("never silently falls back from an explicitly selected local STT adapter", async () => {
    const local = sttAdapterImplementations[0]!
    const localAvailability = vi.spyOn(local, "isAvailable").mockResolvedValue({
      available: false,
      status: "not-configured",
    })
    try {
      const adapter = await resolveAvailableSttAdapter({
        sttAdapterId: "local-whisper",
        preferOffline: true,
      })
      expect(adapter.id).toBe("local-whisper")
      expect(localAvailability).not.toHaveBeenCalled()
    } finally {
      localAvailability.mockRestore()
    }
  })

  it("prefers an offline STT adapter when the id is unknown and preferOffline is set", () => {
    const adapter = resolveSttAdapter({ sttAdapterId: "does-not-exist", preferOffline: true })
    expect(adapter.offline).toBe(true)
    expect(adapter.id).toBe("local-whisper")
  })

  it("falls back to the first TTS adapter for an unknown id", () => {
    const adapter = resolveTtsAdapter({ ttsAdapterId: "nope" })
    expect(adapter.id).toBe("kokoro")
  })
})

describe("voice settings normalization", () => {
  it("clamps the rate into the supported range", () => {
    expect(normalizeVoiceSettings({ rate: 9 }).rate).toBe(2)
    expect(normalizeVoiceSettings({ rate: 0.1 }).rate).toBe(0.5)
  })

  it("applies defaults for missing / invalid fields", () => {
    const settings = normalizeVoiceSettings({})
    expect(settings.sttAdapterId).toBe("local-whisper")
    expect(settings.ttsAdapterId).toBe("kokoro")
    expect(settings.preferOffline).toBe(true)
    expect(settings.autoReadAloud).toBe(false)
    expect(settings.whisperCppBinPath).toBeNull()
  })

  it("keeps a configured whisper.cpp binary path", () => {
    expect(
      normalizeVoiceSettings({ whisperCppBinPath: " /opt/bin/whisper-cli " }).whisperCppBinPath,
    ).toBe("/opt/bin/whisper-cli")
  })

  it("uses a per-chat read-aloud override before the global default", () => {
    const settings = normalizeVoiceSettings({
      autoReadAloud: false,
      readAloudByChatId: { "chat-1": true },
    })
    expect(resolveReadAloudEnabled(settings, "chat-1")).toBe(true)
    expect(resolveReadAloudEnabled(settings, "chat-2")).toBe(false)
  })
})

describe("native voice helpers", () => {
  it("parses the Windows SAPI voice list", () => {
    expect(
      parseWindowsVoices('[{"id":"Microsoft Ava","label":"Microsoft Ava","language":"en-US"}]'),
    ).toEqual([{ id: "Microsoft Ava", label: "Microsoft Ava", language: "en-US" }])
  })

  it("uses the Windows default voice when PowerShell returns malformed JSON", () => {
    expect(parseWindowsVoices("not-json")).toEqual([
      { id: "default", label: "Windows default voice" },
    ])
  })
})

describe("local Whisper audio preparation", () => {
  it("converts browser-recorded WebM and Safari M4A before invoking whisper.cpp", () => {
    expect(requiresAudioConversion("webm")).toBe(true)
    expect(requiresAudioConversion("m4a")).toBe(true)
    expect(requiresAudioConversion("wav")).toBe(false)
    expect(requiresAudioConversion("ogg")).toBe(false)
  })
})

describe("TTS fallback", () => {
  const input = { text: "Hello", rate: 1 }
  const native: TtsAdapter = {
    id: "native-os",
    label: "Native",
    kind: "os",
    offline: true,
    platform: "all",
    isAvailable: vi.fn().mockResolvedValue({ available: true, status: "available" }),
    listVoices: vi.fn(),
    speak: vi.fn().mockResolvedValue({
      audioBase64: "native",
      mimeType: "audio/wav",
      adapterId: "native-os",
    }),
    stop: vi.fn(),
  }

  it("uses Native OS TTS if Kokoro's first model download fails", async () => {
    const kokoro: TtsAdapter = {
      ...native,
      id: "kokoro",
      label: "Kokoro",
      speak: vi.fn().mockRejectedValue(new Error("model download failed")),
    }
    await expect(speakWithTtsFallback(kokoro, native, input)).resolves.toMatchObject({
      adapterId: "native-os",
    })
  })

  it("keeps the selected adapter error when Native OS TTS is unavailable", async () => {
    const kokoro: TtsAdapter = {
      ...native,
      id: "kokoro",
      speak: vi.fn().mockRejectedValue(new Error("bad")),
    }
    const unavailableNative: TtsAdapter = {
      ...native,
      isAvailable: vi.fn().mockResolvedValue({ available: false, status: "unavailable" }),
    }
    await expect(speakWithTtsFallback(kokoro, unavailableNative, input)).rejects.toThrow("bad")
  })
})

describe("kokoro helpers", () => {
  it("splits text into sentence-aligned chunks under the char cap", () => {
    const chunks = getKokoroChunks("One sentence. Two sentence. Three.", 100)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks.every((c) => c.length <= 100)).toBe(true)
  })

  it("hard-splits a single overly long sentence", () => {
    const chunks = getKokoroChunks("word ".repeat(200), 100)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.length <= 100)).toBe(true)
  })

  it("writes a valid 44-byte RIFF/WAVE header", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]), 24000)
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF")
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE")
    // 44-byte header + 2 bytes per sample.
    expect(wav.length).toBe(44 + 5 * 2)
    expect(wav.readUInt32LE(24)).toBe(24000)
  })
})

describe("read-aloud instruction", () => {
  it("tells the harness to author Spoken and Displayed sections", () => {
    expect(READ_ALOUD_INSTRUCTION).toContain("Spoken:")
    expect(READ_ALOUD_INSTRUCTION).toContain("Displayed:")
  })

  it("adds the instruction to prompt-only harnesses only when enabled", () => {
    expect(appendReadAloudInstruction("Fix the bug", true)).toContain("Spoken:")
    expect(appendReadAloudInstruction("Fix the bug", false)).toBe("Fix the bug")
  })
})
