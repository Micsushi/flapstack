// Stage 2 Track B — usage credential storage (app side).
//
// Provider API keys and the Discord webhook URL are credentials. They are
// encrypted with Electron safeStorage and written to a separate file from the
// non-secret usage settings. On macOS they live in the user Keychain so the
// app and its LaunchAgent daemon can both read them. Values are never logged.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const secretsFileName = "usage-secrets.json"
const KEYCHAIN_SERVICE = "dev.flapstack.usage"

type SafeStorage = {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

function getSafeStorage(): SafeStorage | null {
  try {
    const electron = require("electron") as { safeStorage?: SafeStorage }
    return electron.safeStorage ?? null
  } catch {
    return null
  }
}

function readRaw(): Record<string, string> {
  const path = getSecretsPath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>
  } catch {
    return {}
  }
}

function writeRaw(data: Record<string, string>): void {
  const path = getSecretsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2))
}

/** Store (or clear when value is null) an encrypted secret by key. */
export function setUsageSecret(key: string, value: string | null): void {
  if (process.platform === "darwin") {
    if (setKeychainSecret(key, value)) return
  }
  const data = readRaw()
  if (value == null || value === "") {
    delete data[key]
    writeRaw(data)
    return
  }
  const safe = getSafeStorage()
  if (safe?.isEncryptionAvailable()) {
    data[key] = "enc:" + safe.encryptString(value).toString("base64")
  } else {
    // Fall back to plaintext with an explicit marker so we know it's unprotected.
    data[key] = "plain:" + value
  }
  writeRaw(data)
}

/** Read a secret by key, decrypting as needed. Returns null when unset. */
export function getUsageSecret(key: string): string | null {
  if (process.platform === "darwin") {
    const keychainValue = getKeychainSecret(key)
    if (keychainValue != null) return keychainValue
  }
  const stored = readRaw()[key]
  if (!stored) return null
  if (stored.startsWith("plain:")) return stored.slice("plain:".length)
  if (stored.startsWith("enc:")) {
    const safe = getSafeStorage()
    if (!safe?.isEncryptionAvailable()) return null
    try {
      return safe.decryptString(Buffer.from(stored.slice("enc:".length), "base64"))
    } catch {
      return null
    }
  }
  return null
}

/** True when a secret is present (used by settings UI without exposing value). */
export function hasUsageSecret(key: string): boolean {
  return process.platform === "darwin"
    ? getKeychainSecret(key) != null || Boolean(readRaw()[key])
    : Boolean(readRaw()[key])
}

/** macOS Keychain is readable by the app and its user LaunchAgent daemon,
 * unlike Electron safeStorage. The JSON file remains a backwards-compatible
 * fallback for existing installs and non-macOS platforms. */
function keychainAccount(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url")
}

function getKeychainSecret(key: string): string | null {
  const result = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", keychainAccount(key), "-w"],
    { encoding: "utf8" },
  )
  return result.status === 0 ? result.stdout.trim() || null : null
}

function setKeychainSecret(key: string, value: string | null): boolean {
  const account = keychainAccount(key)
  if (value == null || value === "") {
    spawnSync(
      "/usr/bin/security",
      ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account],
      {
        encoding: "utf8",
      },
    )
    return true
  }
  const result = spawnSync(
    "/usr/bin/security",
    ["add-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w", value, "-U"],
    { encoding: "utf8" },
  )
  return result.status === 0
}

function getSecretsPath(): string {
  const overrideDir = process.env.FLAPSTACK_CONFIG_DIR
  if (overrideDir) return join(overrideDir, secretsFileName)
  return join(getElectronUserDataPath(), "data", secretsFileName)
}

function getElectronUserDataPath(): string {
  try {
    const electron = require("electron") as { app?: { getPath(name: string): string } }
    const userDataPath = electron.app?.getPath("userData")
    if (userDataPath) return userDataPath
  } catch {
    // tests
  }
  return join(process.cwd(), ".flapstack")
}
