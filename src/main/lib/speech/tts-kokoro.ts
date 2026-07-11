import os from "node:os"
import path from "node:path"
import type { SpeechAdapterAvailability, TtsAdapter, TtsInput, TtsResult, TtsVoice } from "./types"

// Offline Kokoro neural TTS (S2.0: default TTS, system voice is the fallback).
// Ported from agent-hotline's native-kokoro-tts. kokoro-js downloads the ONNX
// model on first use via @huggingface/transformers and caches it in the app
// speech dir, so no API key and no bundled model in the installer.
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX"
const DEFAULT_KOKORO_VOICE = "af_heart"
const DEFAULT_SAMPLE_RATE = 24000
const MAX_CHARS_PER_CHUNK = 300
const KOKORO_CHUNK_GAP_SEC = 0.08

// kokoro-js has no Node type surface here; keep the shape we rely on local.
export type KokoroModel = {
  voices?: Record<string, unknown>
  generate(
    text: string,
    options: { voice: string; speed: number },
  ): Promise<{
    audio?: Float32Array
    data?: Float32Array
    sampling_rate?: number
    sampleRate?: number
  }>
}

let loadPromise: Promise<KokoroModel> | null = null
let runtimeMissingReason: string | null = null

export const kokoroTtsAdapter: TtsAdapter = {
  id: "kokoro",
  label: "Kokoro Offline",
  kind: "local",
  offline: true,
  platform: "all",

  async isAvailable(): Promise<SpeechAdapterAvailability> {
    const runtime = await tryResolveRuntime()
    if (!runtime) {
      return {
        available: false,
        status: "not-configured",
        reason:
          runtimeMissingReason ??
          "Kokoro runtime is not installed. Native OS voice fallback is available.",
      }
    }
    // The model itself downloads on first speak; report available and let the
    // first synthesis fetch it (with the system voice as an automatic fallback).
    return { available: true, status: "available" }
  },

  async listVoices(): Promise<TtsVoice[]> {
    return [
      { id: "af_heart", label: "Heart (US, female)", language: "en-US" },
      { id: "af_bella", label: "Bella (US, female)", language: "en-US" },
      { id: "af_nicole", label: "Nicole (US, female)", language: "en-US" },
      { id: "am_adam", label: "Adam (US, male)", language: "en-US" },
      { id: "am_michael", label: "Michael (US, male)", language: "en-US" },
      { id: "bf_emma", label: "Emma (UK, female)", language: "en-GB" },
      { id: "bm_george", label: "George (UK, male)", language: "en-GB" },
    ]
  },

  async speak(input: TtsInput): Promise<TtsResult> {
    const text = String(input.text || "")
      .replace(/\s+/g, " ")
      .trim()
    if (!text) throw new Error("Text is required for speech.")

    const model = await loadModel()
    const voices = model.voices ? Object.keys(model.voices) : []
    const requested = input.voiceId || DEFAULT_KOKORO_VOICE
    const voice =
      voices.length === 0 || voices.includes(requested) ? requested : DEFAULT_KOKORO_VOICE
    const speed = clamp(input.rate ?? 1, 0.25, 4)

    const chunks = getKokoroChunks(text, MAX_CHARS_PER_CHUNK)
    const { buffers, sampleRate } = await synthesizeKokoroChunks(model, chunks, voice, speed, input)

    const gapSamples = Math.round(sampleRate * KOKORO_CHUNK_GAP_SEC)
    const merged = concatFloat32(buffers, gapSamples)
    const wavBuffer = encodeWav(merged, sampleRate)
    return {
      audioBase64: wavBuffer.toString("base64"),
      mimeType: "audio/wav",
      adapterId: kokoroTtsAdapter.id,
      voiceId: voice,
    }
  },

  async stop() {
    // Kokoro synthesis is a single awaited call per utterance with no separate
    // playback process to kill; the renderer stops the <audio> element. Nothing
    // to cancel here.
  },
}

function assertRequestActive(input: Pick<TtsInput, "shouldContinue">): void {
  if (input.shouldContinue?.() === false) throw new Error("Speech request was cancelled.")
}

export async function synthesizeKokoroChunks(
  model: KokoroModel,
  chunks: string[],
  voice: string,
  speed: number,
  input: Pick<TtsInput, "shouldContinue">,
): Promise<{ buffers: Float32Array[]; sampleRate: number }> {
  const buffers: Float32Array[] = []
  let sampleRate = DEFAULT_SAMPLE_RATE
  for (const chunk of chunks) {
    assertRequestActive(input)
    const audio = await model.generate(chunk, { voice, speed })
    assertRequestActive(input)
    const samples = audio.audio || audio.data
    if (!samples || typeof samples.length !== "number") {
      throw new Error("Kokoro generated audio without PCM samples.")
    }
    sampleRate = Number(audio.sampling_rate || audio.sampleRate) || DEFAULT_SAMPLE_RATE
    buffers.push(samples)
  }
  return { buffers, sampleRate }
}

async function loadModel(): Promise<KokoroModel> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const runtime = await tryResolveRuntime()
    if (!runtime) {
      throw new Error(
        runtimeMissingReason ??
          "Kokoro runtime is not installed. Native OS voice fallback is available.",
      )
    }
    const { transformers, kokoro } = runtime
    // Cache the ONNX model + voices under the app speech dir instead of the
    // process CWD so repeated runs reuse the first download.
    transformers.env.cacheDir = path.join(getSpeechDataDir(), "kokoro")
    const model = (await kokoro.KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "cpu",
    })) as KokoroModel
    return model
  })().catch((error) => {
    loadPromise = null
    throw error
  })
  return loadPromise
}

type KokoroRuntime = {
  transformers: { env: { cacheDir?: string; allowLocalModels?: boolean; localModelPath?: string } }
  kokoro: { KokoroTTS: { from_pretrained: (id: string, options: unknown) => Promise<unknown> } }
}

async function tryResolveRuntime(): Promise<KokoroRuntime | null> {
  try {
    const transformers =
      (await import("@huggingface/transformers")) as KokoroRuntime["transformers"]
    const kokoro = (await import("kokoro-js")) as unknown as KokoroRuntime["kokoro"]
    runtimeMissingReason = null
    return { transformers, kokoro }
  } catch (error) {
    runtimeMissingReason =
      "Kokoro runtime (kokoro-js/@huggingface/transformers) is not installed. Run npm install."
    if (process.env.FLAPSTACK_DEBUG_SPEECH) {
      console.warn("[Speech] Kokoro runtime unavailable:", error)
    }
    return null
  }
}

function getSpeechDataDir() {
  return process.env.FLAPSTACK_SPEECH_DIR || path.join(os.homedir(), ".flapstack", "speech")
}

export function getKokoroChunks(text: string, maxChars = MAX_CHARS_PER_CHUNK): string[] {
  const sentences = String(text || "").match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [String(text || "")]
  const chunks: string[] = []
  for (const raw of sentences) {
    let sentence = raw.trim()
    if (!sentence) continue
    while (sentence.length > maxChars) {
      let cut = sentence.lastIndexOf(" ", maxChars)
      if (cut <= 0) cut = maxChars
      chunks.push(sentence.slice(0, cut).trim())
      sentence = sentence.slice(cut).trim()
    }
    if (sentence) chunks.push(sentence)
  }
  return chunks.length > 0 ? chunks : [String(text || "").trim()]
}

function concatFloat32(buffers: Float32Array[], gapSamples: number): Float32Array {
  const total =
    buffers.reduce((sum, buffer) => sum + buffer.length, 0) +
    gapSamples * Math.max(0, buffers.length - 1)
  const merged = new Float32Array(total)
  let offset = 0
  for (let i = 0; i < buffers.length; i += 1) {
    merged.set(buffers[i]!, offset)
    offset += buffers[i]!.length
    if (i < buffers.length - 1) offset += gapSamples
  }
  return merged
}

export function encodeWav(samples: Float32Array, sampleRate = DEFAULT_SAMPLE_RATE): Buffer {
  const bytesPerSample = 2
  const dataBytes = samples.length * bytesPerSample
  const buffer = Buffer.alloc(44 + dataBytes)

  buffer.write("RIFF", 0, "ascii")
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write("WAVE", 8, "ascii")
  buffer.write("fmt ", 12, "ascii")
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28)
  buffer.writeUInt16LE(bytesPerSample, 32)
  buffer.writeUInt16LE(8 * bytesPerSample, 34)
  buffer.write("data", 36, "ascii")
  buffer.writeUInt32LE(dataBytes, 40)

  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, Number(samples[i]) || 0))
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * bytesPerSample)
  }
  return buffer
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
