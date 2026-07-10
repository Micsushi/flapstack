import { execFile as execFileCallback, type ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { SpeechAdapterAvailability, TtsAdapter, TtsInput, TtsResult, TtsVoice } from "./types"

function execFileAsync(command: string, args: string[], options: { timeout?: number } = {}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFileCallback(command, args, options, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
    activeChildren.add(child)
    child.on("exit", () => activeChildren.delete(child))
  })
}

const activeChildren = new Set<ChildProcess>()

export const nativeTtsAdapter: TtsAdapter = {
  id: "native-os",
  label: "Native OS Voice",
  kind: "os",
  offline: true,
  platform: "all",

  async isAvailable(): Promise<SpeechAdapterAvailability> {
    if (process.platform === "darwin")
      return { available: commandExists("/usr/bin/say"), status: "available" }
    if (process.platform === "win32") return { available: true, status: "available" }
    return {
      available: false,
      status: "unavailable",
      reason: "Native TTS is implemented for macOS and Windows in this stage.",
    }
  },

  async listVoices(): Promise<TtsVoice[]> {
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync("say", ["-v", "?"], { timeout: 5000 })
      return parseMacosVoices(stdout)
    }
    if (process.platform === "win32") {
      return listWindowsVoices()
    }
    return []
  },

  async speak(input: TtsInput): Promise<TtsResult> {
    if (process.platform === "darwin") return speakMacos(input)
    if (process.platform === "win32") return speakWindows(input)
    throw new Error("Native TTS is not available on this platform.")
  },

  async stop() {
    for (const child of Array.from(activeChildren)) child.kill()
  },
}

function commandExists(command: string) {
  return existsSync(command)
}

async function speakMacos(input: TtsInput): Promise<TtsResult> {
  const text = normalizeText(input.text)
  if (!text) throw new Error("Text is required for speech.")

  const dir = mkdtempSync(path.join(os.tmpdir(), "flapstack-tts-"))
  const aiffPath = path.join(dir, "speech.aiff")
  const wavPath = path.join(dir, "speech.wav")
  const voiceId = input.voiceId || (await getPreferredMacosVoice()) || undefined
  const rate = Math.round(175 * clamp(input.rate ?? 1, 0.5, 2))

  try {
    const sayArgs = voiceId
      ? ["-v", voiceId, "-r", String(rate), "-o", aiffPath, text]
      : ["-r", String(rate), "-o", aiffPath, text]
    await execFileAsync("say", sayArgs, { timeout: 120000 })
    await execFileAsync("afconvert", ["-f", "WAVE", "-d", "LEI16@24000", aiffPath, wavPath], {
      timeout: 30000,
    })
    return {
      audioBase64: readFileSync(wavPath).toString("base64"),
      mimeType: "audio/wav",
      adapterId: nativeTtsAdapter.id,
      voiceId,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function speakWindows(input: TtsInput): Promise<TtsResult> {
  const text = normalizeText(input.text)
  if (!text) throw new Error("Text is required for speech.")

  const dir = mkdtempSync(path.join(os.tmpdir(), "flapstack-tts-"))
  const wavPath = path.join(dir, "speech.wav")
  const ps = [
    "Add-Type -AssemblyName System.Speech;",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    `$s.Rate = ${Math.round((clamp(input.rate ?? 1, 0.5, 2) - 1) * 5)};`,
    `$s.SetOutputToWaveFile('${wavPath.replace(/'/g, "''")}');`,
    `$s.Speak('${text.replace(/'/g, "''")}');`,
    "$s.Dispose();",
  ].join(" ")

  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", ps], { timeout: 120000 })
    return {
      audioBase64: readFileSync(wavPath).toString("base64"),
      mimeType: "audio/wav",
      adapterId: nativeTtsAdapter.id,
      voiceId: input.voiceId || "default",
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function parseMacosVoices(stdout: string): TtsVoice[] {
  const voices: TtsVoice[] = []
  stdout.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^(.+?)\s+([a-z]{2}(?:_[A-Z0-9]+)?)\s+#\s*(.*)$/)
    if (!match) return
    voices.push({
      id: match[1]!.trim(),
      label: `${match[1]!.trim()} (${match[2]!.trim()})`,
      language: match[2]!.trim(),
    })
  })
  return voices
}

async function listWindowsVoices(): Promise<TtsVoice[]> {
  const script = [
    "Add-Type -AssemblyName System.Speech;",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    "$voices = $s.GetInstalledVoices() | ForEach-Object { [PSCustomObject]@{ id = $_.VoiceInfo.Name; label = $_.VoiceInfo.Name; language = $_.VoiceInfo.Culture.Name } };",
    "$s.Dispose();",
    "$voices | ConvertTo-Json -Compress;",
  ].join(" ")
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
    timeout: 5000,
  })
  return parseWindowsVoices(stdout)
}

export function parseWindowsVoices(stdout: string): TtsVoice[] {
  try {
    const parsed = JSON.parse(stdout.trim()) as
      | { id?: string; label?: string; language?: string }
      | Array<{ id?: string; label?: string; language?: string }>
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    const voices = rows
      .filter((voice) => typeof voice.id === "string" && voice.id.trim())
      .map((voice) => ({
        id: voice.id!.trim(),
        label: voice.label?.trim() || voice.id!.trim(),
        language: voice.language?.trim() || undefined,
      }))
    return voices.length ? voices : [{ id: "default", label: "Windows default voice" }]
  } catch {
    return [{ id: "default", label: "Windows default voice" }]
  }
}

async function getPreferredMacosVoice() {
  try {
    const voices = await nativeTtsAdapter.listVoices()
    return (
      voices.find((voice) => /Alex|Samantha|Ava/i.test(voice.id))?.id ||
      voices.find((voice) => /English|en_/i.test(`${voice.id} ${voice.language ?? ""}`))?.id ||
      null
    )
  } catch {
    return null
  }
}

function normalizeText(text: string) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
