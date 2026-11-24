import { createRequire } from "node:module"
import type { KokoroModel } from "./lib/speech/tts-kokoro"

const require = createRequire(import.meta.url)
const port = process.parentPort
let model: KokoroModel | undefined

type Request =
  | { id: number; kind: "load"; modelId: string; cacheDir: string; cachedOnly: boolean }
  | { id: number; kind: "sentence"; text: string; voice: string; speed: number }

async function handle(request: Request) {
  if (request.kind === "load") {
    const { env, StyleTextToSpeech2Model, AutoTokenizer } = require("@huggingface/transformers")
    const { KokoroTTS } = require("kokoro-js")
    env.cacheDir = request.cacheDir
    const local = { local_files_only: request.cachedOnly }
    const [network, tokenizer] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(request.modelId, {
        ...local,
        dtype: "q8",
        device: "cpu",
      }),
      AutoTokenizer.from_pretrained(request.modelId, local),
    ])
    model = new KokoroTTS(network, tokenizer) as KokoroModel
    return { voices: Object.keys(model.voices ?? {}) }
  }
  if (!model) throw new Error("The Kokoro model is not loaded.")
  const audio = await model.generate(request.text, { voice: request.voice, speed: request.speed })
  return {
    audio: audio.audio ?? audio.data,
    sampling_rate: audio.sampling_rate ?? audio.sampleRate,
  }
}

port.on("message", ({ data }: { data: Request }) => {
  void handle(data).then(
    (result) => port.postMessage({ id: data.id, result }),
    (error) =>
      port.postMessage({
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      }),
  )
})
