import { describe, expect, it, vi } from "vitest"
import {
  resolveSttAdapter,
  resolveAvailableSttAdapter,
  resolveTtsAdapter,
  resolveSupportedTtsVoiceId,
  resolveTtsVoiceId,
  sttAdapterImplementations,
  sttAdapters,
  ttsAdapters,
} from "../src/main/lib/speech/registry"
import { normalizeVoiceSettings } from "../src/main/lib/speech/settings"
import { extractSpokenSection, filterSpeakableText } from "../src/main/lib/speech/speakable-filter"
import { createFallbackSpokenSummary } from "../src/main/lib/speech/spoken-summary"
import {
  assertSpeechTextWithinLimit,
  MAX_SPEECH_TEXT_CHARACTERS,
  resolveSpeechText,
} from "../src/main/lib/speech/speech-text"
import {
  encodeWav,
  getKokoroChunks,
  synthesizeKokoroChunks,
} from "../src/main/lib/speech/tts-kokoro"
import {
  buildMacosSayArgs,
  buildWindowsSpeechScript,
  parseWindowsVoices,
  resolveWindowsPowerShellPath,
} from "../src/main/lib/speech/tts-native"
import {
  getWhisperModelDescriptor,
  raceAbort,
  requiresAudioConversion,
  verifyWhisperBinary,
} from "../src/main/lib/speech/stt-whisper-cpp"
import { encodePcmWav, resampleMono } from "../src/renderer/lib/hooks/use-voice-recording"
import { PARAKEET_MODEL } from "../src/main/lib/speech/stt-parakeet-streaming"
import { speakWithTtsFallback } from "../src/main/lib/speech/tts-fallback"
import { toMicrophoneError } from "../src/renderer/lib/hooks/use-voice-recording"
import {
  extendSpeechRangeThroughPunctuation,
  getManagedSpeechSnapshot,
  getSpeechCursor,
  getSpeechDisplayTokens,
  getSpeechPlaybackPosition,
  getSpeechStartTime,
  playManagedSpeech,
  setSpeechPlaybackPosition,
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
    expect(sttAdapters.map((a) => a.id)).toEqual(["local-parakeet", "local-whisper"])
    expect(ttsAdapters.map((a) => a.id)).toEqual(["kokoro", "native-os"])
  })

  it("falls back to the local adapter for an obsolete cloud selection", () => {
    const adapter = resolveSttAdapter({ sttAdapterId: "openai-whisper", preferOffline: true })
    expect(adapter.id).toBe("local-parakeet")
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
    expect(adapter.id).toBe("local-parakeet")
  })

  it("falls back to the first TTS adapter for an unknown id", () => {
    const adapter = resolveTtsAdapter({ ttsAdapterId: "nope" })
    expect(adapter.id).toBe("kokoro")
  })

  it("drops a Kokoro voice when availability resolves to Native", () => {
    expect(resolveTtsVoiceId("kokoro", "native-os", "af_heart")).toBeNull()
    expect(resolveTtsVoiceId("native-os", "native-os", "Samantha")).toBe("Samantha")
  })

  it("drops a persisted voice that the active adapter does not expose", () => {
    expect(resolveSupportedTtsVoiceId("missing", [{ id: "available" }])).toBeNull()
    expect(resolveSupportedTtsVoiceId("available", [{ id: "available" }])).toBe("available")
  })
})

describe("voice settings normalization", () => {
  it("clamps the rate into the supported range", () => {
    expect(normalizeVoiceSettings({ rate: 9 }).rate).toBe(2)
    expect(normalizeVoiceSettings({ rate: 0.1 }).rate).toBe(0.5)
  })

  it("applies defaults for missing / invalid fields", () => {
    const settings = normalizeVoiceSettings({})
    expect(settings.sttAdapterId).toBe("local-parakeet")
    expect(settings.voiceSettingsVersion).toBe(2)
    expect(settings.parakeetModelId).toBe("parakeet-unified-en-q8")
    expect(settings.retainDictationAudio).toBe(true)
    expect(settings.sttModelUnloadMinutes).toBe(5)
    expect(settings.ttsAdapterId).toBe("kokoro")
    expect(settings.preferOffline).toBe(true)
    expect(settings.whisperModelId).toBe("base")
    expect(settings.whisperCppBinPath).toBeNull()
  })

  it("normalizes obsolete adapter ids to visible supported defaults", () => {
    const settings = normalizeVoiceSettings({
      voiceSettingsVersion: 2,
      sttAdapterId: "openai-whisper",
      ttsAdapterId: "cloud-tts",
    })
    expect(settings.sttAdapterId).toBe("local-parakeet")
    expect(settings.ttsAdapterId).toBe("kokoro")
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

  it("keeps separate voice choices for each TTS provider", () => {
    const settings = normalizeVoiceSettings({
      voiceByTtsAdapterId: { kokoro: "af_heart", "native-os": "Samantha" },
    })
    expect(settings.voiceByTtsAdapterId).toEqual({
      kokoro: "af_heart",
      "native-os": "Samantha",
    })
  })
})

describe("native voice helpers", () => {
  it("resolves Windows PowerShell from the system directory without PATH search", () => {
    expect(
      resolveWindowsPowerShellPath({
        systemRoot: "D:\\Windows",
        processArch: "x64",
        nativeArchitecture: undefined,
      }),
    ).toBe("D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
    expect(
      resolveWindowsPowerShellPath({
        systemRoot: "C:\\Windows",
        processArch: "ia32",
        nativeArchitecture: "AMD64",
      }),
    ).toBe("C:\\Windows\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe")
  })

  it("rejects untrusted relative Windows system roots", () => {
    expect(() =>
      resolveWindowsPowerShellPath({
        systemRoot: "Windows",
        processArch: "x64",
        nativeArchitecture: undefined,
      }),
    ).toThrow(/absolute Windows system root/i)
  })

  it("keeps Windows speech text out of the PowerShell command line", () => {
    const secretLikeText = "Speak sk-private-token without exposing it"
    const script = buildWindowsSpeechScript("Voice ' One", 2, "C:\\Audio's\\speech.wav")

    expect(script).toContain("[Console]::In.ReadToEnd()")
    expect(script).toContain("$s.Speak($text)")
    expect(script).not.toContain(secretLikeText)
    expect(script).toContain("Voice '' One")
    expect(script).toContain("C:\\Audio''s\\speech.wav")
  })

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

describe("speech synthesis limits", () => {
  it("accepts the maximum bounded speech text and rejects one character more", () => {
    expect(() => assertSpeechTextWithinLimit("a".repeat(MAX_SPEECH_TEXT_CHARACTERS))).not.toThrow()
    expect(() => assertSpeechTextWithinLimit("a".repeat(MAX_SPEECH_TEXT_CHARACTERS + 1))).toThrow(
      `Speech text exceeds the ${MAX_SPEECH_TEXT_CHARACTERS} character limit.`,
    )
    expect(() => resolveSpeechText("", "a".repeat(MAX_SPEECH_TEXT_CHARACTERS + 1))).toThrow(
      `Speech text exceeds the ${MAX_SPEECH_TEXT_CHARACTERS} character limit.`,
    )
  })
})

describe("local Whisper audio preparation", () => {
  it("pins the Handy-compatible Parakeet streaming model", () => {
    expect(PARAKEET_MODEL.file).toBe("parakeet-unified-en-0.6b-Q8_0.gguf")
    expect(PARAKEET_MODEL.sizeBytes).toBe(731_357_568)
    expect(PARAKEET_MODEL.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(PARAKEET_MODEL.license).toBe("NVIDIA-Open-Model-License")
  })

  it("resamples live microphone frames to 16 kHz mono PCM", () => {
    const result = resampleMono(new Float32Array(4_800).fill(0.25), 48_000, 16_000)
    expect(result).toHaveLength(1_600)
    expect(result[800]).toBeCloseTo(0.25)
  })

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

describe("renderer speech playback", () => {
  it("maps audio progress to cumulative, punctuation-weighted reading progress", () => {
    expect(getSpeechCursor("one two three four", 5, 10)).toMatchObject({ count: 3 })
    expect(getSpeechCursor("one, extraordinarily long. two", 5, 10).current).toBe("extraordinarily")
    expect(getSpeechCursor("one two", 0, 10)).toMatchObject({ current: "", count: 0 })
    expect(getSpeechCursor("one two", 10, 10)).toMatchObject({
      current: "two",
      count: 2,
      wordProgress: 1,
    })
    expect(getSpeechCursor("one two", 1, 10).wordProgress).toBeGreaterThan(0)
  })

  it("keeps each message position when another message plays", () => {
    setSpeechPlaybackPosition("message-one", {
      currentTime: 4.5,
      duration: 10,
      spokenText: "one message",
    })
    setSpeechPlaybackPosition("message-two", {
      currentTime: 2,
      duration: 8,
      spokenText: "another message",
    })
    expect(getSpeechPlaybackPosition("message-one")).toMatchObject({ currentTime: 4.5 })
    expect(getSpeechPlaybackPosition("message-two")).toMatchObject({ currentTime: 2 })
  })

  it("resumes partial audio but restarts completed audio", () => {
    expect(getSpeechStartTime({ currentTime: 4.5, duration: 10 })).toBe(4.5)
    expect(getSpeechStartTime({ currentTime: 9.9, duration: 10 })).toBe(0)
    expect(getSpeechStartTime({ currentTime: 10, duration: 10 })).toBe(0)
  })

  it("maps spoken contractions and word substitutions back to displayed text", () => {
    expect(getSpeechDisplayTokens("I'm ready, so I'll start.", 5)).toEqual([
      "i",
      "am",
      "ready",
      "so",
      "i",
      "will",
      "start",
    ])
    expect(getSpeechDisplayTokens("Use about so but start stop", 6)).toEqual([
      "use",
      "about",
      "so",
      "but",
      "start",
      "stop",
    ])
  })

  it("extends completed spoken words through attached punctuation", () => {
    expect(extendSpeechRangeThroughPunctuation("ready. Next", 5)).toBe(6)
    expect(extendSpeechRangeThroughPunctuation("done?!", 4)).toBe(6)
    expect(extendSpeechRangeThroughPunctuation("word next", 4)).toBe(4)
  })

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
  currentTime = 0
  duration = 10
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  play = vi.fn(async () => undefined)
  pause = vi.fn()
  removeAttribute = vi.fn()

  constructor(public src: string) {}
}
