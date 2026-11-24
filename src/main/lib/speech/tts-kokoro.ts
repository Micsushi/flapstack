import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { assertSpeechTextWithinLimit } from "./speech-text"
import type { SpeechAdapterAvailability, TtsAdapter, TtsInput, TtsResult, TtsVoice } from "./types"

const require = createRequire(import.meta.url)

// Offline Kokoro neural TTS. System voices are a separate, explicit selection.
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
let activeProcess: Electron.UtilityProcess | undefined

export const kokoroTtsAdapter: TtsAdapter = {
  id: "kokoro",
  label: "Kokoro Offline",
  kind: "local",
  offline: true,
  platform: "all",

  async isAvailable(): Promise<SpeechAdapterAvailability> {
    try {
      require.resolve("@huggingface/transformers")
      require.resolve("kokoro-js")
    } catch {
      return {
        available: false,
        status: "not-configured",
        reason: "Kokoro runtime is not installed. Repair the app installation to use Kokoro.",
      }
    }
    // The model downloads on first synthesis, then runs locally.
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
    assertSpeechTextWithinLimit(text)

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

// Only one inference uses the model at a time. Playback gets the next sentence
// ahead of background reply preparation, including when it joins an existing job.
const waiting: { interactive?: () => boolean; run: () => void }[] = []
let synthesizing = false
function scheduleKokoroSentence<T>(
  interactive: (() => boolean) | undefined,
  generate: () => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    waiting.push({
      interactive,
      run() {
        synthesizing = true
        Promise.resolve()
          .then(generate)
          .then(resolve, reject)
          .finally(() => {
            synthesizing = false
            nextSentence()
          })
      },
    })
    nextSentence()
  })
}
function nextSentence() {
  if (synthesizing || !waiting.length) return
  const next = Math.max(
    0,
    waiting.findIndex((item) => item.interactive?.()),
  )
  waiting.splice(next, 1)[0]!.run()
}

type KokoroAudio = Awaited<ReturnType<KokoroModel["generate"]>>
let opening: { text: string; voice: string; audio: Promise<KokoroAudio> } | undefined
let preparingOpening = false

/** Keep only the latest first sentence in memory. Never play it or create a history entry. */
export async function prepareKokoroOpening(text: string, requestedVoice: string | null) {
  const chunk = getKokoroChunks(text.replace(/\s+/g, " ").trim())[0]
  if (!chunk || !/[.!?]$/.test(chunk) || preparingOpening) return
  const voice = requestedVoice || DEFAULT_KOKORO_VOICE
  if (opening?.text === chunk && opening.voice === voice) return
  if (
    !loadPromise &&
    !existsSync(path.join(getSpeechDataDir(), "kokoro", MODEL_ID, "onnx", "model_quantized.onnx"))
  )
    return
  preparingOpening = true
  const audio = loadModel(true).then((model) =>
    scheduleKokoroSentence(undefined, () => model.generate(chunk, { voice, speed: 1 })),
  )
  opening = { text: chunk, voice, audio }
  try {
    await audio
  } catch {
    if (opening?.audio === audio) opening = undefined
  } finally {
    preparingOpening = false
  }
}

export async function synthesizeKokoroChunks(
  model: KokoroModel,
  chunks: string[],
  voice: string,
  speed: number,
  input: Pick<TtsInput, "shouldContinue" | "onChunk" | "interactive">,
): Promise<{ buffers: Float32Array[]; sampleRate: number }> {
  const buffers: Float32Array[] = []
  let sampleRate = DEFAULT_SAMPLE_RATE
  for (const chunk of chunks) {
    assertRequestActive(input)
    const cached =
      !buffers.length && speed === 1 && opening?.voice === voice && opening.text === chunk
        ? opening.audio
        : undefined
    const generate = () =>
      scheduleKokoroSentence(input.interactive, () => {
        assertRequestActive(input)
        return model.generate(chunk, { voice, speed })
      })
    const audio = await (cached ? cached.catch(generate) : generate())
    assertRequestActive(input)
    const samples = audio.audio || audio.data
    if (!samples || typeof samples.length !== "number") {
      throw new Error("Kokoro generated audio without PCM samples.")
    }
    sampleRate = Number(audio.sampling_rate || audio.sampleRate) || DEFAULT_SAMPLE_RATE
    buffers.push(samples)
    if (input.onChunk) {
      const gap = buffers.length < chunks.length ? Math.round(sampleRate * KOKORO_CHUNK_GAP_SEC) : 0
      const pcm = gap ? new Float32Array(samples.length + gap) : samples
      if (gap) pcm.set(samples)
      input.onChunk({
        audioBase64: encodeWav(pcm, sampleRate).toString("base64"),
        mimeType: "audio/wav",
        duration: pcm.length / sampleRate,
      })
    }
  }
  return { buffers, sampleRate }
}

let warmScheduled = false
export function warmCachedKokoro() {
  if (warmScheduled || loadPromise) return
  const cached = path.join(getSpeechDataDir(), "kokoro", MODEL_ID, "onnx", "model_quantized.onnx")
  if (!existsSync(cached)) return
  warmScheduled = true
  setTimeout(() => void loadModel(true).catch(() => {}), 1200).unref()
}

async function loadModel(cachedOnly = false): Promise<KokoroModel> {
  if (loadPromise) return loadPromise
  const pending = startSynthesisProcess(cachedOnly)
  loadPromise = pending
  void pending.catch(() => {
    if (loadPromise === pending) loadPromise = null
  })
  return pending
}

async function startSynthesisProcess(cachedOnly: boolean): Promise<KokoroModel> {
  const { app, utilityProcess } = require("electron") as typeof import("electron")
  const child = utilityProcess.fork(
    path.join(app.getAppPath(), "out/main/kokoro-synthesis.js"),
    [],
    {
      stdio: "ignore",
      serviceName: "Flapstack speech synthesis",
    },
  )
  activeProcess = child
  const close = () => {
    child.kill()
  }
  app.once("will-quit", close)
  type Reply = { voices?: string[]; audio?: Float32Array; sampling_rate?: number }
  let waiting: { id: number; resolve(value: Reply): void; reject(error: Error): void } | undefined
  let sequence = 0
  let exited = false
  child.on("exit", () => {
    exited = true
    app.removeListener("will-quit", close)
    if (activeProcess === child) {
      activeProcess = undefined
      loadPromise = null
    }
    waiting?.reject(new Error("The Kokoro speech process stopped. Play the reply again."))
    waiting = undefined
  })
  child.on("message", (message: { id: number; result?: Reply; error?: string }) => {
    const request = waiting
    if (!request || request.id !== message.id) return
    waiting = undefined
    if (message.result) request.resolve(message.result)
    else request.reject(new Error(message.error || "Kokoro synthesis failed."))
  })
  // The existing sentence scheduler issues one inference at a time across all replies.
  const request = (payload: Record<string, unknown>) =>
    new Promise<Reply>((resolve, reject) => {
      if (exited || waiting) return reject(new Error("The Kokoro speech process is unavailable."))
      const id = ++sequence
      waiting = { id, resolve, reject }
      const send = () => {
        try {
          child.postMessage({ ...payload, id })
        } catch (error) {
          waiting = undefined
          reject(error)
        }
      }
      if (child.pid) send()
      else child.once("spawn", send)
    })
  try {
    const loaded = await request({
      kind: "load",
      modelId: MODEL_ID,
      cacheDir: path.join(getSpeechDataDir(), "kokoro"),
      cachedOnly,
    })
    return {
      voices: Object.fromEntries((loaded.voices ?? []).map((name) => [name, true])),
      generate: (text, options) => request({ kind: "sentence", text, ...options }),
    }
  } catch (error) {
    close()
    throw error
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
