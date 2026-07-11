import { describe, expect, it, vi } from "vitest"
import {
  resolveSttAdapter,
  resolveAvailableSttAdapter,
  resolveTtsAdapter,
  resolveTtsVoiceId,
  sttAdapterImplementations,
  sttAdapters,
  ttsAdapters,
} from "../src/main/lib/speech/registry"
import { normalizeVoiceSettings, resolveReadAloudEnabled } from "../src/main/lib/speech/settings"
import { extractSpokenSection, filterSpeakableText } from "../src/main/lib/speech/speakable-filter"
import { createFallbackSpokenSummary } from "../src/main/lib/speech/spoken-summary"
import { resolveSpeechText } from "../src/main/lib/speech/speech-text"
import {
  encodeWav,
  getKokoroChunks,
  synthesizeKokoroChunks,
} from "../src/main/lib/speech/tts-kokoro"
import { buildMacosSayArgs, parseWindowsVoices } from "../src/main/lib/speech/tts-native"
import {
  getWhisperModelDescriptor,
  raceAbort,
  requiresAudioConversion,
  verifyWhisperBinary,
} from "../src/main/lib/speech/stt-whisper-cpp"
import { encodePcmWav } from "../src/renderer/lib/hooks/use-voice-recording"
import {
  appendReadAloudInstruction,
  READ_ALOUD_INSTRUCTION,
} from "../src/main/lib/speech/read-aloud-instruction"
import { speakWithTtsFallback } from "../src/main/lib/speech/tts-fallback"
import { toMicrophoneError } from "../src/renderer/lib/hooks/use-voice-recording"
import {
  getManagedSpeechSnapshot,
  playManagedSpeech,
  stopManagedSpeech,
  subscribeManagedSpeech,
} from "../src/renderer/lib/speech-playback"
import { buildMessageSpeechRequest } from "../src/renderer/lib/message-speech-request"
import type { TtsAdapter } from "../src/main/lib/speech/types"
import { SpeechRequestOwnership } from "../src/main/lib/speech/request-ownership"
import { ProgressSubscribers } from "../src/main/lib/speech/progress-subscribers"

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

  it("keeps short hyphen-bullet lists inside Spoken", () => {
    const result = filterSpeakableText("Spoken:\n- first item\n- second item")
    expect(result).toMatchObject({ shouldSpeak: true, source: "spoken" })
    expect(result.text).toContain("first item")
    expect(result.text).toContain("second item")
  })

  it("removes +/- lines only after explicit diff context", () => {
    const result = filterSpeakableText(
      "Spoken:\nSummary survives.\ndiff --git a/a b/a\n@@ -1 +1 @@\n-old\n+new",
    )
    expect(result.text).toBe("Summary survives.")
  })

  it("skips replies that are only code / tables", () => {
    const reply = ["```ts", "const a = 1", "```", "| a | b |", "| --- | --- |"].join("\n")
    const result = filterSpeakableText(reply)
    expect(result.shouldSpeak).toBe(false)
  })

  it("treats an explicit empty or filtered Spoken section as authoritative", () => {
    expect(resolveSpeechText("Spoken:\n\nDisplayed:\nSecret details")).toBeNull()
    expect(
      resolveSpeechText("Spoken:\n```ts\nconst secret = true\n```\nDisplayed:\nDetails"),
    ).toBeNull()
    expect(resolveSpeechText("No explicit section here.")).toContain("No explicit section")
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

  it("drops a Kokoro voice when availability resolves to Native", () => {
    expect(resolveTtsVoiceId("kokoro", "native-os", "af_heart")).toBeNull()
    expect(resolveTtsVoiceId("native-os", "native-os", "Samantha")).toBe("Samantha")
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
    expect(settings.whisperModelId).toBe("base")
    expect(settings.whisperCppBinPath).toBeNull()
  })

  it("keeps a configured whisper.cpp binary path", () => {
    expect(
      normalizeVoiceSettings({ whisperCppBinPath: " /opt/bin/whisper-cli " }).whisperCppBinPath,
    ).toBe("/opt/bin/whisper-cli")
  })

  it("keeps a supported model and rejects an unknown one", () => {
    expect(normalizeVoiceSettings({ whisperModelId: "small" }).whisperModelId).toBe("small")
    expect(normalizeVoiceSettings({ whisperModelId: "large" }).whisperModelId).toBe("base")
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
  it("encodes renderer audio as 16 kHz mono PCM WAV", () => {
    const wav = encodePcmWav(new Float32Array([0, 1, -1]))
    const view = new DataView(wav)
    expect(String.fromCharCode(...new Uint8Array(wav, 0, 4))).toBe("RIFF")
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
  })

  it("pins the model revision and checksum", () => {
    const descriptor = getWhisperModelDescriptor()
    expect(descriptor.url).toContain(descriptor.revision)
    expect(descriptor.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it("pins a checksum and size for every selectable model", () => {
    for (const modelId of ["tiny", "base", "small"] as const) {
      const descriptor = getWhisperModelDescriptor(modelId)
      expect(descriptor.url).toContain(descriptor.file)
      expect(descriptor.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(descriptor.sizeBytes).toBeGreaterThan(70_000_000)
    }
  })

  it("converts browser-recorded WebM and Safari M4A before invoking whisper.cpp", () => {
    expect(requiresAudioConversion("webm")).toBe(true)
    expect(requiresAudioConversion("m4a")).toBe(true)
    expect(requiresAudioConversion("wav")).toBe(false)
    expect(requiresAudioConversion("ogg")).toBe(false)
  })

  it("rejects an arbitrary executable as a Whisper engine", async () => {
    if (process.platform === "win32") return
    await expect(verifyWhisperBinary("/bin/echo")).resolves.toBe(false)
  })

  it("removes each abort listener after a completed chunk read", async () => {
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, "addEventListener")
    const remove = vi.spyOn(controller.signal, "removeEventListener")
    await expect(raceAbort(Promise.resolve("chunk"), controller.signal)).resolves.toBe("chunk")
    expect(add).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("fans shared download progress out to every caller and removes only that caller", () => {
    const subscribers = new ProgressSubscribers<string, number>()
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = subscribers.subscribe("base", first, 0)
    subscribers.subscribe("base", second, 0)

    subscribers.publish("base", 50)
    unsubscribeFirst()
    subscribers.publish("base", 100)

    expect(first.mock.calls).toEqual([[0], [50]])
    expect(second.mock.calls).toEqual([[0], [50], [100]])
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
    vi.mocked(native.speak).mockClear()
    const kokoro: TtsAdapter = {
      ...native,
      id: "kokoro",
      label: "Kokoro",
      speak: vi.fn().mockRejectedValue(new Error("model download failed")),
    }
    const providerVoiceInput = { ...input, voiceId: "af_heart" }
    await expect(speakWithTtsFallback(kokoro, native, providerVoiceInput)).resolves.toMatchObject({
      adapterId: "native-os",
    })
    expect(native.speak).toHaveBeenCalledWith({ ...providerVoiceInput, voiceId: null })
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

  it("does not start native fallback after a speech request is cancelled", async () => {
    const kokoro: TtsAdapter = {
      ...native,
      id: "kokoro",
      label: "Kokoro",
      speak: vi.fn().mockRejectedValue(new Error("model download failed")),
    }
    const fallback = { ...native, speak: vi.fn() }
    let checks = 0

    await expect(
      speakWithTtsFallback(kokoro, fallback, input, {
        shouldContinue: () => checks++ === 0,
      }),
    ).rejects.toThrow("cancelled")
    expect(fallback.speak).not.toHaveBeenCalled()
  })
})

describe("speech request ownership", () => {
  it("preempts within one window without cancelling another window", () => {
    const ownership = new SpeechRequestOwnership()
    const firstWindowA = ownership.begin(1)
    const firstWindowB = ownership.begin(2)
    ownership.begin(1)
    expect(ownership.isActive(1, firstWindowA)).toBe(false)
    expect(ownership.isActive(2, firstWindowB)).toBe(true)
  })
})

describe("message speech request", () => {
  it("persists replay context and leaves speed control to the audio element", () => {
    expect(
      buildMessageSpeechRequest({
        text: "Spoken:\nReady.",
        chatId: "chat-1",
        subChatId: "subchat-1",
        messageId: "message-1",
      }),
    ).toEqual({
      text: "Spoken:\nReady.",
      rate: 1,
      chatId: "chat-1",
      subChatId: "subchat-1",
      messageId: "message-1",
    })
  })
})

describe("kokoro helpers", () => {
  it("stops before synthesizing another chunk after cancellation", async () => {
    const generate = vi
      .fn()
      .mockResolvedValue({ audio: new Float32Array([0]), sampling_rate: 24000 })
    let checks = 0
    await expect(
      synthesizeKokoroChunks({ generate }, ["first", "second"], "af_heart", 1, {
        shouldContinue: () => checks++ < 2,
      }),
    ).rejects.toThrow("cancelled")
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it("keeps macOS spoken text out of argv", () => {
    const args = buildMacosSayArgs(undefined, 175, "/tmp/speech.aiff")
    expect(args).toEqual(["-r", "175", "-o", "/tmp/speech.aiff"])
    expect(args).not.toContain("--leading-option-like-text")
  })

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

  it("uses the same prompt instruction for every prompt-only harness", () => {
    const prompt = appendReadAloudInstruction("Fix the bug", true)
    expect(prompt).toContain("Displayed:")
    expect(prompt).toContain("no code")
  })
})

describe("renderer speech playback", () => {
  it("preempts the active utterance when new speech starts", async () => {
    const instances: FakeAudio[] = []
    const createObjectURL = vi.fn(() => `blob:${instances.length}`)
    const revokeObjectURL = vi.fn()

    class TestAudio extends FakeAudio {
      constructor(src: string) {
        super(src)
        instances.push(this)
      }
    }

    vi.stubGlobal("Audio", TestAudio)
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL })
    vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"))

    try {
      await playManagedSpeech({
        audioBase64: Buffer.from("one").toString("base64"),
        mimeType: "audio/wav",
      })
      await playManagedSpeech({
        audioBase64: Buffer.from("two").toString("base64"),
        mimeType: "audio/wav",
      })

      expect(instances).toHaveLength(2)
      expect(instances[0]!.pause).toHaveBeenCalledOnce()
      expect(instances[1]!.play).toHaveBeenCalledOnce()
      stopManagedSpeech()
      expect(instances[1]!.pause).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("publishes playback state and resets the preempted owner", async () => {
    const instances: FakeAudio[] = []
    class TestAudio extends FakeAudio {
      constructor(src: string) {
        super(src)
        instances.push(this)
      }
    }
    vi.stubGlobal("Audio", TestAudio)
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:speech"), revokeObjectURL: vi.fn() })
    vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"))

    const states: boolean[] = []
    const firstStopped = vi.fn()
    const unsubscribe = subscribeManagedSpeech(() => states.push(getManagedSpeechSnapshot()))

    try {
      await playManagedSpeech(
        { audioBase64: Buffer.from("one").toString("base64"), mimeType: "audio/wav" },
        { onStopped: firstStopped },
      )
      expect(getManagedSpeechSnapshot()).toBe(true)

      await playManagedSpeech({
        audioBase64: Buffer.from("two").toString("base64"),
        mimeType: "audio/wav",
      })
      expect(firstStopped).toHaveBeenCalledOnce()
      expect(states).toEqual([true, false, true])

      stopManagedSpeech()
      expect(getManagedSpeechSnapshot()).toBe(false)
      expect(states).toEqual([true, false, true, false])
    } finally {
      unsubscribe()
      stopManagedSpeech()
      vi.unstubAllGlobals()
    }
  })
})

describe("microphone failure states", () => {
  it("gives platform-specific permission recovery", () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" })
    expect(toMicrophoneError(denied, "Win32").message).toContain("Windows Settings")
    expect(toMicrophoneError(denied, "MacIntel").message).toContain("System Settings")
  })

  it("distinguishes missing and busy microphones", () => {
    const missing = Object.assign(new Error("missing"), { name: "NotFoundError" })
    const busy = Object.assign(new Error("busy"), { name: "NotReadableError" })
    expect(toMicrophoneError(missing, "MacIntel").message).toContain("No microphone found")
    expect(toMicrophoneError(busy, "MacIntel").message).toContain("another application")
  })
})

class FakeAudio {
  playbackRate = 1
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  play = vi.fn(async () => undefined)
  pause = vi.fn()
  removeAttribute = vi.fn()

  constructor(public src: string) {}
}
