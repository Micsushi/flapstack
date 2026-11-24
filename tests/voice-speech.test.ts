import { describe, expect, it, vi } from "vitest"
import { resolveSpeechText } from "../src/main/lib/speech/speech-text"
import { getKokoroChunks, synthesizeKokoroChunks } from "../src/main/lib/speech/tts-kokoro"
import { verifyWhisperBinary } from "../src/main/lib/speech/stt-whisper-cpp"
import { speakWithTtsFallback } from "../src/main/lib/speech/tts-fallback"
import {
  getManagedSpeechSnapshot,
  getSpeechCursor,
  getSpeechStartTime,
  playManagedSpeech,
  stopManagedSpeech,
  subscribeManagedSpeech,
} from "../src/renderer/lib/speech-playback"
import { buildMessageSpeechRequest } from "../src/renderer/lib/message-speech-request"
import type { TtsAdapter } from "../src/main/lib/speech/types"
import { SpeechRequestOwnership } from "../src/main/lib/speech/request-ownership"

describe("speakable filter", () => {
  it("treats an explicit empty or filtered Spoken section as authoritative", () => {
    expect(resolveSpeechText("Spoken:\n\nDisplayed:\nSecret details")).toBeNull()
    expect(
      resolveSpeechText("Spoken:\n```ts\nconst secret = true\n```\nDisplayed:\nDetails"),
    ).toBeNull()
    expect(resolveSpeechText("No explicit section here.")).toContain("No explicit section")
  })
})

describe("whole reply and streamed Kokoro read-back", () => {
  it("publishes the first playable WAV before the next sentence is synthesized", async () => {
    const calls: string[] = []
    const chunks = getKokoroChunks("First. Second.", 8)
    expect(chunks).toEqual(["First.", "Second."])
    const model = {
      async generate(text: string) {
        calls.push(text)
        return { audio: new Float32Array(240), sampling_rate: 24000 }
      },
    }
    await synthesizeKokoroChunks(model, chunks, "af_heart", 1, {
      onChunk(chunk) {
        const wav = Buffer.from(chunk.audioBase64, "base64")
        expect(wav.toString("ascii", 0, 4)).toBe("RIFF")
        expect(wav.toString("ascii", 8, 12)).toBe("WAVE")
        expect(wav.readUInt32LE(24)).toBe(24000)
        expect(wav.readUInt32LE(40)).toBe(wav.length - 44)
        calls.push("wav")
      },
    })
    expect(calls).toEqual(["First.", "wav", "Second.", "wav"])
  })
})

describe("local Whisper audio preparation", () => {
  it("rejects an arbitrary executable as a Whisper engine", async () => {
    await expect(verifyWhisperBinary(process.execPath)).resolves.toBe(false)
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

  it("hard-splits a single overly long sentence", () => {
    const chunks = getKokoroChunks("word ".repeat(200), 100)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.length <= 100)).toBe(true)
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

  it("resumes partial audio but restarts completed audio", () => {
    expect(getSpeechStartTime({ currentTime: 4.5, duration: 10 })).toBe(4.5)
    expect(getSpeechStartTime({ currentTime: 9.9, duration: 10 })).toBe(0)
    expect(getSpeechStartTime({ currentTime: 10, duration: 10 })).toBe(0)
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
