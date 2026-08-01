import { app } from "electron"
import { createHash } from "node:crypto"
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import readline from "node:readline"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { SpeechAdapterAvailability, SttAdapter } from "./types"
import { getVoiceSettings } from "./settings"

export const PARAKEET_MODEL = {
  id: "parakeet-unified-en-q8",
  label: "Parakeet Unified EN 0.6B Q8 (live, recommended)",
  file: "parakeet-unified-en-0.6b-Q8_0.gguf",
  sizeBytes: 731_357_568,
  sha256: "4b50b6dd862bf6e346929aaf4f5eaacec003bfa3f56462d6c874b41ef2f38795",
  url: "https://huggingface.co/handy-computer/parakeet-unified-en-0.6b-gguf/resolve/main/parakeet-unified-en-0.6b-Q8_0.gguf",
  license: "NVIDIA-Open-Model-License",
  source: "https://huggingface.co/nvidia/parakeet-unified-en-0.6b",
  licenseUrl:
    "https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/",
} as const

export type ParakeetModelStatus =
  | { status: "absent" }
  | { status: "downloading"; receivedBytes: number; totalBytes: number | null; percent: number }
  | { status: "present"; sizeBytes: number }
  | { status: "error"; message: string }

let modelStatus: ParakeetModelStatus = { status: "absent" }
let activeDownload: Promise<string> | null = null
let validatedModel: { size: number; mtimeMs: number; valid: boolean } | null = null

function speechDataDir() {
  return path.join(app.getPath("userData"), "speech")
}

export function getParakeetModelPath() {
  return path.join(speechDataDir(), "models", PARAKEET_MODEL.file)
}

function sidecarCandidates() {
  const name = process.platform === "win32" ? "flapstack-stt-sidecar.exe" : "flapstack-stt-sidecar"
  return [
    process.env.FLAPSTACK_STT_SIDECAR,
    app.isPackaged ? path.join(process.resourcesPath, "bin", name) : null,
    path.join(process.cwd(), "native", "stt-sidecar", "target", "release", name),
    path.join(process.cwd(), "resources", "bin", `${process.platform}-${process.arch}`, name),
  ].filter((value): value is string => Boolean(value))
}

export function findParakeetSidecar() {
  return sidecarCandidates().find((candidate) => existsSync(candidate)) ?? null
}

async function sha256(file: string) {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(file)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}

async function* readResponseBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  let completed = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        completed = true
        return
      }
      if (value) yield value
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function validModel() {
  const file = getParakeetModelPath()
  if (!existsSync(file)) return false
  const stat = statSync(file)
  if (validatedModel?.size === stat.size && validatedModel.mtimeMs === stat.mtimeMs)
    return validatedModel.valid
  if (stat.size !== PARAKEET_MODEL.sizeBytes) return false
  const valid = (await sha256(file)) === PARAKEET_MODEL.sha256
  validatedModel = { size: stat.size, mtimeMs: stat.mtimeMs, valid }
  return valid
}

export async function getParakeetModelStatus(): Promise<ParakeetModelStatus> {
  if (modelStatus.status === "downloading" || modelStatus.status === "error") return modelStatus
  if (await validModel())
    return (modelStatus = { status: "present", sizeBytes: PARAKEET_MODEL.sizeBytes })
  return (modelStatus = { status: "absent" })
}

export function ensureParakeetModel() {
  if (activeDownload) return activeDownload
  activeDownload = downloadParakeetModel().finally(() => {
    activeDownload = null
  })
  return activeDownload
}

async function downloadParakeetModel() {
  if (await validModel()) {
    writeModelNotice()
    return getParakeetModelPath()
  }
  const destination = getParakeetModelPath()
  const temporary = `${destination}.download`
  mkdirSync(path.dirname(destination), { recursive: true })
  rmSync(temporary, { force: true })
  modelStatus = { status: "downloading", receivedBytes: 0, totalBytes: null, percent: 0 }
  try {
    const response = await fetch(PARAKEET_MODEL.url, { redirect: "follow" })
    if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status})`)
    const totalBytes = Number(response.headers.get("content-length")) || PARAKEET_MODEL.sizeBytes
    let receivedBytes = 0
    const progress = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.byteLength
        modelStatus = {
          status: "downloading",
          receivedBytes,
          totalBytes,
          percent: Math.min(100, Math.floor((receivedBytes / totalBytes) * 100)),
        }
        callback(null, chunk)
      },
    })
    await pipeline(
      Readable.from(readResponseBody(response.body)),
      progress,
      createWriteStream(temporary),
    )
    if (statSync(temporary).size !== PARAKEET_MODEL.sizeBytes)
      throw new Error("Downloaded model size is invalid")
    if ((await sha256(temporary)) !== PARAKEET_MODEL.sha256)
      throw new Error("Downloaded model checksum is invalid")
    renameSync(temporary, destination)
    writeModelNotice()
    validatedModel = null
    modelStatus = { status: "present", sizeBytes: PARAKEET_MODEL.sizeBytes }
    return destination
  } catch (error) {
    rmSync(temporary, { force: true })
    const message = error instanceof Error ? error.message : String(error)
    modelStatus = { status: "error", message }
    throw new Error(`Parakeet model download failed: ${message}`)
  }
}

function writeModelNotice() {
  const noticePath = path.join(path.dirname(getParakeetModelPath()), "PARAKEET-MODEL-LICENSE.txt")
  writeFileSync(
    noticePath,
    [
      `Model: ${PARAKEET_MODEL.label}`,
      `Source: ${PARAKEET_MODEL.source}`,
      `Terms: ${PARAKEET_MODEL.license}`,
      `License: ${PARAKEET_MODEL.licenseUrl}`,
      "",
    ].join("\n"),
  )
}

type SidecarResponse = {
  id: number
  ok: boolean
  committed?: string
  tentative?: string
  final_text?: string
  error?: string
}

class StreamingSidecar {
  private child: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (value: SidecarResponse) => void; reject: (error: Error) => void }
  >()
  private loadedPath: string | null = null
  private unloadTimer: ReturnType<typeof setTimeout> | null = null
  private streamActive = false

  private async launch() {
    if (this.child && !this.child.killed) return
    const executable = findParakeetSidecar()
    if (!executable) throw new Error("Parakeet streaming sidecar is not prepared")
    const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] })
    this.child = child
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const response = JSON.parse(line) as SidecarResponse
        const pending = this.pending.get(response.id)
        if (!pending) return
        this.pending.delete(response.id)
        response.ok
          ? pending.resolve(response)
          : pending.reject(new Error(response.error || "Streaming STT failed"))
      } catch (error) {
        console.warn("[Parakeet] Invalid sidecar response", error)
      }
    })
    child.stderr.on("data", (chunk) => console.warn(`[Parakeet] ${String(chunk).trim()}`))
    child.once("exit", () => {
      this.child = null
      this.loadedPath = null
      this.streamActive = false
      if (this.unloadTimer) clearTimeout(this.unloadTimer)
      this.unloadTimer = null
      for (const pending of this.pending.values())
        pending.reject(new Error("Streaming STT sidecar exited"))
      this.pending.clear()
    })
  }

  private async request(command: string, payload: Record<string, unknown> = {}) {
    await this.launch()
    const id = this.nextId++
    return await new Promise<SidecarResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child!.stdin.write(`${JSON.stringify({ command, id, ...payload })}\n`)
    })
  }

  async load() {
    const modelPath = await ensureParakeetModel()
    if (this.loadedPath === modelPath) return
    await this.request("load", { model_path: modelPath })
    this.loadedPath = modelPath
    this.scheduleUnload()
  }

  async start() {
    if (this.unloadTimer) clearTimeout(this.unloadTimer)
    this.unloadTimer = null
    await this.load()
    if (this.unloadTimer) clearTimeout(this.unloadTimer)
    this.unloadTimer = null
    try {
      await this.request("start")
      this.streamActive = true
    } catch (error) {
      this.scheduleUnload()
      throw error
    }
  }
  async feed(pcm: Buffer) {
    return await this.request("feed", { pcm_base64: pcm.toString("base64") })
  }
  async finalize() {
    try {
      return await this.request("finalize")
    } finally {
      this.streamActive = false
      this.scheduleUnload()
    }
  }
  async cancel() {
    try {
      if (this.child) await this.request("cancel").catch(() => {})
    } finally {
      this.streamActive = false
      this.scheduleUnload()
    }
  }

  rescheduleIdleUnload() {
    if (this.loadedPath && !this.streamActive) this.scheduleUnload()
  }

  private scheduleUnload() {
    if (this.unloadTimer) clearTimeout(this.unloadTimer)
    this.unloadTimer = setTimeout(() => {
      if (this.streamActive) return
      void this.request("unload")
        .then(() => {
          this.loadedPath = null
        })
        .catch(() => {})
    }, getVoiceSettings().sttModelUnloadMinutes * 60_000)
    this.unloadTimer.unref?.()
  }
}

export const parakeetSidecar = new StreamingSidecar()

export const parakeetStreamingAdapter: SttAdapter = {
  id: "local-parakeet",
  label: "Local Parakeet (live)",
  kind: "local",
  supportsStreaming: true,
  offline: true,
  supportsVocabularyHints: false,
  async isAvailable(): Promise<SpeechAdapterAvailability> {
    if (!findParakeetSidecar())
      return {
        available: false,
        status: "not-configured",
        missingDependency: "engine",
        reason: "Parakeet streaming sidecar is not prepared.",
      }
    if (!(await validModel()))
      return {
        available: false,
        status: "not-configured",
        missingDependency: "model",
        reason: "Parakeet live model is not downloaded yet.",
      }
    await parakeetSidecar.load()
    return { available: true, status: "available", reason: "Warm local streaming is ready." }
  },
  async canAutoProvision() {
    return Boolean(findParakeetSidecar())
  },
  async transcribe() {
    throw new Error("Parakeet uses the streaming dictation API")
  },
}
