import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { secureCredentialFile } from "../credential-service"
import {
  MOBILE_BRIDGE_DEFAULT_PORT,
  type MobileBridgeSettings,
  type MobileBridgeSettingsStore,
} from "./types"

const require = createRequire(import.meta.url)
const SETTINGS_FILE = "mobile-bridge-settings.json"

export const defaultMobileBridgeSettings: MobileBridgeSettings = {
  version: 1,
  enabled: false,
  bindAddress: null,
  port: MOBILE_BRIDGE_DEFAULT_PORT,
}

export function normalizeMobileBridgeSettings(raw: unknown): MobileBridgeSettings {
  if (!raw || typeof raw !== "object") return { ...defaultMobileBridgeSettings }
  const value = raw as Partial<MobileBridgeSettings>
  return {
    version: 1,
    enabled: value.enabled === true,
    bindAddress:
      typeof value.bindAddress === "string" && value.bindAddress.trim()
        ? value.bindAddress.trim()
        : null,
    port:
      typeof value.port === "number" &&
      Number.isInteger(value.port) &&
      value.port >= 1024 &&
      value.port <= 65_535
        ? value.port
        : MOBILE_BRIDGE_DEFAULT_PORT,
  }
}

export class FileMobileBridgeSettingsStore implements MobileBridgeSettingsStore {
  constructor(private readonly path = defaultMobileBridgeSettingsPath()) {}

  read(): MobileBridgeSettings {
    if (!existsSync(this.path)) return { ...defaultMobileBridgeSettings }
    try {
      return normalizeMobileBridgeSettings(JSON.parse(readFileSync(this.path, "utf8")))
    } catch {
      return { ...defaultMobileBridgeSettings }
    }
  }

  write(settings: MobileBridgeSettings): void {
    const normalized = normalizeMobileBridgeSettings(settings)
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const tempPath = `${this.path}.${randomUUID()}.tmp`
    let fd: number | null = null
    try {
      fd = openSync(tempPath, "wx", 0o600)
      writeFileSync(fd, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
      fsyncSync(fd)
      closeSync(fd)
      fd = null
      secureCredentialFile(tempPath)
      renameSync(tempPath, this.path)
    } finally {
      if (fd !== null) closeSync(fd)
      rmSync(tempPath, { force: true })
    }
  }
}

export function defaultMobileBridgeDataDir(): string {
  if (process.env.FLAPSTACK_CONFIG_DIR) return process.env.FLAPSTACK_CONFIG_DIR
  try {
    const electron = require("electron") as { app?: { getPath(name: string): string } }
    const userData = electron.app?.getPath("userData")
    if (userData) return join(userData, "data")
  } catch {
    // Headless services and tests do not require Electron.
  }
  return join(process.cwd(), ".flapstack", "data")
}

function defaultMobileBridgeSettingsPath(): string {
  return join(defaultMobileBridgeDataDir(), SETTINGS_FILE)
}
