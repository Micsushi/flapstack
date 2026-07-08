import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { defaultVoiceSettings, type VoiceSettings } from "./types"

const require = createRequire(import.meta.url)
const configFileName = "voice-settings.json"

export function getVoiceSettings(): VoiceSettings {
  const configPath = getVoiceSettingsPath()
  if (!existsSync(configPath)) return defaultVoiceSettings

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as Partial<VoiceSettings>
    return normalizeVoiceSettings(raw)
  } catch (error) {
    console.warn("[Speech] Failed to read voice settings:", error)
    return defaultVoiceSettings
  }
}

export function setVoiceSettings(settings: Partial<VoiceSettings>): VoiceSettings {
  const next = normalizeVoiceSettings({ ...getVoiceSettings(), ...settings })
  const configPath = getVoiceSettingsPath()
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify(next, null, 2))
  return next
}

export function normalizeVoiceSettings(raw: Partial<VoiceSettings>): VoiceSettings {
  return {
    sttAdapterId:
      typeof raw.sttAdapterId === "string" ? raw.sttAdapterId : defaultVoiceSettings.sttAdapterId,
    ttsAdapterId:
      typeof raw.ttsAdapterId === "string" ? raw.ttsAdapterId : defaultVoiceSettings.ttsAdapterId,
    voiceId: typeof raw.voiceId === "string" ? raw.voiceId : null,
    rate:
      typeof raw.rate === "number" && Number.isFinite(raw.rate)
        ? clamp(raw.rate, 0.5, 2)
        : defaultVoiceSettings.rate,
    autoReadAloud: raw.autoReadAloud ?? defaultVoiceSettings.autoReadAloud,
    preferOffline: raw.preferOffline ?? defaultVoiceSettings.preferOffline,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function getVoiceSettingsPath(): string {
  const overrideDir = process.env.FLAPSTACK_CONFIG_DIR
  if (overrideDir) return join(overrideDir, configFileName)
  return join(getElectronUserDataPath(), "data", configFileName)
}

function getElectronUserDataPath(): string {
  try {
    const electron = require("electron") as { app?: { getPath(name: string): string } }
    const userDataPath = electron.app?.getPath("userData")
    if (userDataPath) return userDataPath
  } catch {
    // Tests can import settings helpers outside Electron.
  }
  return join(process.cwd(), ".flapstack")
}
