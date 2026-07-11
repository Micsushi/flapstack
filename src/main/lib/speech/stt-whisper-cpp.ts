import { execFile as execFileCallback } from "node:child_process"
import { createHash } from "node:crypto"
import {
  createWriteStream,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { getVoiceSettings } from "./settings"
import { cleanTranscribedText } from "./stt-cloud"
import type { SpeechAdapterAvailability, SttAdapter, SttInput, SttResult } from "./types"

// whisper.cpp `base` multilingual model (S2.0 decision: download-on-first-use).
// Kept out of the installer so the download stays small; the model lands in the
// app data dir on first dictation with visible progress + an honest failure state.
const MODEL_REVISION = "80da2d8bfee42b0e836fc3a9890373e5defc00a6"
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}/ggml-base.bin`
const MODEL_FILE = "ggml-base.bin"
const MODEL_SHA256 = "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000
// Sanity floor so a truncated/HTML error response is never mistaken for a model.
const MIN_MODEL_BYTES = 100 * 1024 * 1024

export type SttModelDownloadState =
  | { status: "absent" }
  | { status: "downloading"; receivedBytes: number; totalBytes: number | null; percent: number }
  | { status: "present"; sizeBytes: number }
  | { status: "error"; message: string }

let downloadState: SttModelDownloadState = { status: "absent" }
let activeDownload: Promise<string> | null = null
let verifiedModel: { path: string; size: number; mtimeMs: number; digest: string } | null = null
let verifyingModel: {
  path: string
  size: number
  mtimeMs: number
  promise: Promise<string>
} | null = null
const downloadProgressListeners = new Set<(state: SttModelDownloadState) => void>()
const verifiedBinaries = new Map<string, { mtimeMs: number; valid: boolean }>()

export const whisperCppAdapter: SttAdapter = {
  id: "local-whisper",
  label: "Local Whisper",
  kind: "local",
  supportsStreaming: false,
  offline: true,

  async isAvailable(): Promise<SpeechAdapterAvailability> {
    const binary = await findWorkingWhisperBinary()
    if (!binary) {
      return {
        available: false,
        status: "not-configured",
        missingDependency: "engine",
        reason:
          "whisper.cpp binary not found. Set WHISPER_CPP_BIN or add whisper-cli to resources/bin.",
      }
    }
    if (!findFfmpegBinary()) {
      return {
        available: false,
        status: "not-configured",
        missingDependency: "audio-converter",
        reason:
          "ffmpeg is required for browser-recorded audio. Install ffmpeg or add it to resources/bin.",
      }
    }
    const modelValidation = await validateModelFile(getModelPath())
    if (!modelValidation.valid) {
      const detail =
        downloadState.status === "downloading"
          ? ` Downloading (${downloadState.percent}%).`
          : downloadState.status === "error"
            ? ` Last attempt failed: ${downloadState.message}`
            : ""
      return {
        available: false,
        status: "not-configured",
        missingDependency: "model",
        reason: `${modelValidation.reason || "Local Whisper base model is not downloaded yet."}${detail}`,
      }
    }
    return { available: true, status: "available" }
  },

  async canAutoProvision() {
    // Runtime tools must already be installed. Only the model can be downloaded
    // atomically by transcribe() on first use.
    return Boolean((await findWorkingWhisperBinary()) && findFfmpegBinary())
  },

  async transcribe(input: SttInput): Promise<SttResult> {
    const binary = await findWorkingWhisperBinary()
    if (!binary) throw new Error("whisper.cpp binary not found. Set WHISPER_CPP_BIN.")
    const modelPath = await ensureModel()
    const dir = mkdtempSync(path.join(os.tmpdir(), "flapstack-stt-"))
    const audioPath = path.join(dir, `audio.${input.format}`)
    const wavPath = path.join(dir, "audio.wav")
    const outputBase = path.join(dir, "transcript")
    try {
      const fs = await import("node:fs")
      fs.writeFileSync(audioPath, input.audioBuffer)
      const inputPath = await convertToWhisperAudio(audioPath, wavPath, input.format)
      const args = ["-m", modelPath, "-f", inputPath, "-otxt", "-of", outputBase]
      if (input.language) args.push("-l", input.language)
      await execFileAsync(binary, args, { timeout: 180000 })
      const textPath = `${outputBase}.txt`
      const text = existsSync(textPath) ? fs.readFileSync(textPath, "utf8") : ""
      return { text: cleanTranscribedText(text), adapterId: whisperCppAdapter.id }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
}

export function getModelPath() {
  return path.join(getSpeechDataDir(), "models", MODEL_FILE)
}

export function getWhisperModelDescriptor() {
  return { url: MODEL_URL, revision: MODEL_REVISION, sha256: MODEL_SHA256 }
}

/**
 * Current status of the local Whisper model, used by the settings UI to render
 * an honest download/absent/present/error state (V2/V9).
 */
export async function getSttModelStatus(): Promise<SttModelDownloadState> {
  const modelPath = getModelPath()
  const validation = await validateModelFile(modelPath)
  if (validation.valid) {
    // A completed download supersedes a stale in-memory error/absent value.
    if (downloadState.status !== "present") {
      downloadState = { status: "present", sizeBytes: statSync(modelPath).size }
    }
    return downloadState
  }
  if (downloadState.status === "present") downloadState = { status: "absent" }
  return downloadState
}

/**
 * Ensure the model exists locally, downloading on first use. Multiple callers
 * share one in-flight download. Throws an actionable error on failure.
 */
export async function ensureModel(
  onProgress?: (state: SttModelDownloadState) => void,
): Promise<string> {
  const modelPath = getModelPath()
  const validation = await validateModelFile(modelPath)
  if (validation.valid) {
    downloadState = { status: "present", sizeBytes: statSync(modelPath).size }
    return modelPath
  }
  if (existsSync(modelPath)) rmSync(modelPath, { force: true })
  if (onProgress) {
    downloadProgressListeners.add(onProgress)
    onProgress(downloadState)
  }
  if (!activeDownload)
    activeDownload = downloadModel(modelPath).finally(() => {
      activeDownload = null
    })
  return activeDownload.finally(() => {
    if (onProgress) downloadProgressListeners.delete(onProgress)
  })
}

async function downloadModel(modelPath: string): Promise<string> {
  mkdirSync(path.dirname(modelPath), { recursive: true })
  const tmpPath = `${modelPath}.download`
  const setState = (state: SttModelDownloadState) => {
    downloadState = state
    for (const listener of downloadProgressListeners) listener(state)
  }
  setState({ status: "downloading", receivedBytes: 0, totalBytes: null, percent: 0 })

  let totalTimer: ReturnType<typeof setTimeout> | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const controller = new AbortController()
    totalTimer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
    totalTimer.unref?.()
    const response = await fetch(MODEL_URL, { signal: controller.signal })
    if (!response.ok || !response.body) {
      throw new Error(`Model download failed (HTTP ${response.status}).`)
    }
    const totalBytes = Number(response.headers.get("content-length")) || null
    let receivedBytes = 0
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_TIMEOUT_MS)
      idleTimer.unref?.()
    }
    resetIdleTimer()

    await new Promise<void>((resolve, reject) => {
      const fileStream = createWriteStream(tmpPath)
      const reader = response.body!.getReader()
      const pump = async () => {
        try {
          for (;;) {
            const { done, value } = await raceAbort(reader.read(), controller.signal)
            if (done) break
            if (!value) continue
            resetIdleTimer()
            receivedBytes += value.byteLength
            if (!fileStream.write(Buffer.from(value))) {
              await new Promise<void>((resolve) => fileStream.once("drain", () => resolve()))
            }
            const percent = totalBytes ? Math.floor((receivedBytes / totalBytes) * 100) : 0
            setState({ status: "downloading", receivedBytes, totalBytes, percent })
          }
          fileStream.end(() => resolve())
        } catch (error) {
          fileStream.destroy()
          reject(error)
        }
      }
      fileStream.on("error", reject)
      void pump()
    })
    clearTimeout(totalTimer)
    if (idleTimer) clearTimeout(idleTimer)

    const size = statSync(tmpPath).size
    if (size < MIN_MODEL_BYTES) {
      throw new Error(`Downloaded model looks truncated (${size} bytes). Try again.`)
    }
    const digest = await sha256File(tmpPath)
    if (digest !== MODEL_SHA256) {
      throw new Error(`Downloaded model checksum mismatch (${digest}).`)
    }
    renameSync(tmpPath, modelPath)
    setState({ status: "present", sizeBytes: size })
    return modelPath
  } catch (error) {
    rmSync(tmpPath, { force: true })
    const message = error instanceof Error ? error.message : String(error)
    setState({ status: "error", message })
    throw new Error(
      `Local Whisper model download failed: ${message}. Check your connection and retry, or add ${MODEL_FILE} to ${path.dirname(modelPath)} manually.`,
    )
  } finally {
    if (totalTimer) clearTimeout(totalTimer)
    if (idleTimer) clearTimeout(idleTimer)
  }
}

export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Download aborted"))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("Download timed out"))
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort))
  })
}

async function validateModelFile(modelPath: string): Promise<{ valid: boolean; reason?: string }> {
  if (!existsSync(modelPath)) return { valid: false }
  const size = statSync(modelPath).size
  if (size < MIN_MODEL_BYTES) return { valid: false, reason: "Local Whisper model is truncated." }
  return (await sha256File(modelPath)) === MODEL_SHA256
    ? { valid: true }
    : { valid: false, reason: "Local Whisper model failed its integrity check." }
}

async function sha256File(filePath: string): Promise<string> {
  const stat = statSync(filePath)
  if (
    verifiedModel?.path === filePath &&
    verifiedModel.size === stat.size &&
    verifiedModel.mtimeMs === stat.mtimeMs
  ) {
    return verifiedModel.digest
  }
  if (
    verifyingModel?.path === filePath &&
    verifyingModel.size === stat.size &&
    verifyingModel.mtimeMs === stat.mtimeMs
  ) {
    return verifyingModel.promise
  }
  const promise = new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(hash.digest("hex")))
  })
  verifyingModel = { path: filePath, size: stat.size, mtimeMs: stat.mtimeMs, promise }
  const digest = await promise
  verifyingModel = null
  verifiedModel = { path: filePath, size: stat.size, mtimeMs: stat.mtimeMs, digest }
  return digest
}

export async function verifyWhisperBinary(binaryPath: string): Promise<boolean> {
  try {
    const info = statSync(binaryPath)
    const cached = verifiedBinaries.get(binaryPath)
    if (cached?.mtimeMs === info.mtimeMs) return cached.valid
    const output = await execFileCapture(binaryPath, ["--help"], { timeout: 5_000 })
    const valid = /whisper(?:\.cpp|-cli)|usage:/i.test(output)
    verifiedBinaries.set(binaryPath, { mtimeMs: info.mtimeMs, valid })
    return valid
  } catch {
    return false
  }
}

async function findWorkingWhisperBinary(): Promise<string | null> {
  const binary = findWhisperBinary()
  return binary && (await verifyWhisperBinary(binary)) ? binary : null
}

function findWhisperBinary() {
  const configuredPath = getVoiceSettings().whisperCppBinPath
  if (configuredPath && existsSync(configuredPath)) return configuredPath
  const fromEnv = process.env.WHISPER_CPP_BIN
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const names =
    process.platform === "win32" ? ["whisper-cli.exe", "main.exe"] : ["whisper-cli", "main"]
  for (const name of names) {
    const candidates = [
      path.join(process.resourcesPath || "", "bin", name),
      path.join(process.cwd(), "resources", "bin", `${process.platform}-${process.arch}`, name),
      path.join(process.cwd(), "resources", "bin", name),
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`,
    ]
    const found = candidates.find((candidate) => candidate && existsSync(candidate))
    if (found) return found
  }
  return findOnPath(names)
}

async function convertToWhisperAudio(
  audioPath: string,
  wavPath: string,
  format: SttInput["format"],
) {
  // whisper.cpp accepts WAV/MP3/FLAC/OGG directly. Chromium records WebM and
  // Safari records M4A, so normalize those two formats before invoking it.
  if (!requiresAudioConversion(format)) return audioPath
  const ffmpeg = findFfmpegBinary()
  if (!ffmpeg) {
    throw new Error(
      "ffmpeg is required to transcribe browser-recorded audio. Install ffmpeg or add it to resources/bin.",
    )
  }
  await execFileAsync(ffmpeg, ["-y", "-i", audioPath, "-ar", "16000", "-ac", "1", wavPath], {
    timeout: 30000,
  })
  return wavPath
}

export function requiresAudioConversion(format: SttInput["format"]) {
  return format === "webm" || format === "m4a"
}

function findFfmpegBinary() {
  const names = process.platform === "win32" ? ["ffmpeg.exe"] : ["ffmpeg"]
  for (const name of names) {
    const candidates = [
      path.join(process.resourcesPath || "", "bin", name),
      path.join(process.cwd(), "resources", "bin", `${process.platform}-${process.arch}`, name),
      path.join(process.cwd(), "resources", "bin", name),
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`,
    ]
    const found = candidates.find((candidate) => candidate && existsSync(candidate))
    if (found) return found
  }
  return findOnPath(names)
}

function findOnPath(names: string[]) {
  const directories = (process.env.PATH || "").split(path.delimiter).filter(Boolean)
  for (const directory of directories) {
    for (const name of names) {
      const candidate = path.join(directory, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function getSpeechDataDir() {
  return process.env.FLAPSTACK_SPEECH_DIR || path.join(os.homedir(), ".flapstack", "speech")
}

function execFileAsync(command: string, args: string[], options: { timeout?: number } = {}) {
  return new Promise<void>((resolve, reject) => {
    execFileCallback(command, args, options, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function execFileCapture(command: string, args: string[], options: { timeout?: number } = {}) {
  return new Promise<string>((resolve, reject) => {
    execFileCallback(command, args, options, (error, stdout, stderr) => {
      const output = `${stdout || ""}\n${stderr || ""}`
      if (error && !output.trim()) reject(error)
      else resolve(output)
    })
  })
}
