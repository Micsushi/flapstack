import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const configFileName = "runtime-activity-fixture-settings.json"

export type RuntimeActivityFixtureSettings = {
  enabled: boolean
}

export const defaultRuntimeActivityFixtureSettings: RuntimeActivityFixtureSettings = {
  enabled: false,
}

export function isRuntimeActivityFixtureAvailable(isPackaged: boolean, isDev: boolean): boolean {
  return !isPackaged && isDev
}

export function getRuntimeActivityFixtureSettings(): RuntimeActivityFixtureSettings {
  const configPath = getRuntimeActivityFixtureSettingsPath()
  if (!existsSync(configPath)) return defaultRuntimeActivityFixtureSettings

  try {
    return normalizeRuntimeActivityFixtureSettings(
      JSON.parse(readFileSync(configPath, "utf8")) as Partial<RuntimeActivityFixtureSettings>,
    )
  } catch (error) {
    console.warn("[Runtime activity fixtures] Failed to read settings:", error)
    return defaultRuntimeActivityFixtureSettings
  }
}

export function setRuntimeActivityFixtureSettings(
  patch: Partial<RuntimeActivityFixtureSettings>,
): RuntimeActivityFixtureSettings {
  const next = normalizeRuntimeActivityFixtureSettings({
    ...getRuntimeActivityFixtureSettings(),
    ...patch,
  })
  const configPath = getRuntimeActivityFixtureSettingsPath()
  mkdirSync(dirname(configPath), { recursive: true })
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempPath, JSON.stringify(next, null, 2))
  renameSync(tempPath, configPath)
  return next
}

export function normalizeRuntimeActivityFixtureSettings(
  raw: Partial<RuntimeActivityFixtureSettings>,
): RuntimeActivityFixtureSettings {
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : false,
  }
}

function getRuntimeActivityFixtureSettingsPath(): string {
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
