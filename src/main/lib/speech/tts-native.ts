import { execFile as execFileCallback, type ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { SpeechAdapterAvailability, TtsAdapter, TtsInput, TtsResult, TtsVoice } from "./types"

function execFileAsync(
  command: string,
  args: string[],
  options: { timeout?: number; input?: string } = {},
  requestScopeId?: string,
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const { input, ...execOptions } = options
    const child = execFileCallback(command, args, execOptions, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
    activeChildren.set(child, requestScopeId)
    child.on("exit", () => activeChildren.delete(child))
    if (input !== undefined) {
      // Keep arbitrary/large prose out of argv: avoids option-looking text and
      // the OS argument-size limit. `say` reads stdin when no message arg exists.
      child.stdin?.on("error", () => {})
      child.stdin?.end(input)
    }
  })
}

const activeChildren = new Map<ChildProcess, string | undefined>()

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

  async stop(requestScopeId?: string) {
    for (const [child, owner] of Array.from(activeChildren)) {
      if (requestScopeId === undefined || owner === requestScopeId) child.kill()
    }
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
    const sayArgs = buildMacosSayArgs(voiceId, rate, aiffPath)
    await execFileAsync("say", sayArgs, { timeout: 120000, input: text }, input.requestScopeId)
    await execFileAsync(
      "afconvert",
      ["-f", "WAVE", "-d", "LEI16@24000", aiffPath, wavPath],
      {
        timeout: 30000,
      },
      input.requestScopeId,
    )
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

export function buildMacosSayArgs(
  voiceId: string | undefined,
  rate: number,
  outputPath: string,
): string[] {
  return voiceId
    ? ["-v", voiceId, "-r", String(rate), "-o", outputPath]
    : ["-r", String(rate), "-o", outputPath]
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
    input.voiceId ? `$s.SelectVoice('${input.voiceId.replace(/'/g, "''")}');` : "",
    `$s.SetOutputToWaveFile('${wavPath.replace(/'/g, "''")}');`,
    `$s.Speak('${text.replace(/'/g, "''")}');`,
    "$s.Dispose();",
  ].join(" ")

  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", ps],
      { timeout: 120000 },
      input.requestScopeId,
    )
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
