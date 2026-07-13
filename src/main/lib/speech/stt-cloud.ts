import { execSync } from "node:child_process"
import os from "node:os"
import type { SttAdapter, SttInput, SttResult } from "./types"

const MAX_AUDIO_SIZE = 25 * 1024 * 1024
const API_TIMEOUT_MS = 30000

let cachedOpenAIKey: string | null | undefined = undefined
let userConfiguredOpenAIKey: string | null = null

export function setUserOpenAIKey(key: string | null): void {
  userConfiguredOpenAIKey = key?.trim() || null
  cachedOpenAIKey = undefined
}

export function clearOpenAIKeyCache(): void {
  cachedOpenAIKey = undefined
}

export function getOpenAIApiKey(): string | null {
  if (userConfiguredOpenAIKey && userConfiguredOpenAIKey.startsWith("sk-"))
    return userConfiguredOpenAIKey
  if (cachedOpenAIKey !== undefined) return cachedOpenAIKey

  const viteKey = (import.meta.env as Record<string, string | undefined>).MAIN_VITE_OPENAI_API_KEY
  const envKey = viteKey || process.env.OPENAI_API_KEY
  if (envKey) {
    cachedOpenAIKey = envKey
    return cachedOpenAIKey
  }

  // Packaged builds don't inherit the user's interactive shell env, so the key
  // may only exist in their shell rc. Read it via a login shell as a last resort.
  cachedOpenAIKey = readOpenAIKeyFromShell()
  return cachedOpenAIKey
}

function readOpenAIKeyFromShell(): string | null {
  try {
    const shell = process.env.SHELL || "/bin/zsh"
    const result = execSync(`${shell} -ilc 'echo $OPENAI_API_KEY'`, {
      encoding: "utf8",
      timeout: 5000,
      env: {
        HOME: os.homedir(),
        USER: os.userInfo().username,
        SHELL: shell,
      } as unknown as NodeJS.ProcessEnv,
    })
    const key = result.trim()
    if (key && key !== "$OPENAI_API_KEY" && key.startsWith("sk-")) return key
  } catch (error) {
    console.error("[speech] Failed to read OPENAI_API_KEY from shell:", error)
  }
  return null
}

export const cloudWhisperAdapter: SttAdapter = {
  id: "openai-whisper",
  label: "OpenAI Whisper",
  kind: "cloud",
  supportsStreaming: false,
  offline: false,

  async isAvailable() {
    return getOpenAIApiKey()
      ? { available: true, status: "available" as const }
      : {
          available: false,
          status: "not-configured" as const,
          reason: "Add an OpenAI API key in Settings > Voice or set OPENAI_API_KEY.",
        }
  },

  async transcribe(input: SttInput): Promise<SttResult> {
    const text = await transcribeWithWhisper(input)
    return { text, adapterId: cloudWhisperAdapter.id }
  },
}

async function transcribeWithWhisper({ audioBuffer, format, language }: SttInput): Promise<string> {
  const key = getOpenAIApiKey()
  if (!key) throw new Error("OpenAI API key not configured.")
  if (audioBuffer.length > MAX_AUDIO_SIZE) {
    throw new Error(
      `Audio too large (${Math.round(audioBuffer.length / 1024 / 1024)}MB). Maximum is 25MB.`,
    )
  }

  const formData = new FormData()
  formData.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)], { type: `audio/${format}` }),
    `audio.${format}`,
  )
  formData.append("model", "whisper-1")
  formData.append("response_format", "text")
  if (language) formData.append("language", language)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: formData,
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 401) throw new Error("Invalid OpenAI API key.")
      if (response.status === 429) throw new Error("OpenAI rate limit exceeded.")
      if (response.status >= 500) throw new Error("OpenAI service temporarily unavailable.")
      throw new Error(`Transcription failed (${response.status}).`)
    }
    return cleanTranscribedText(await response.text())
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error("Transcription timed out.")
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export function cleanTranscribedText(text: string): string {
  return text
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "")
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/\t+/g, " ")
    .replace(/ +/g, " ")
    .trim()
}
