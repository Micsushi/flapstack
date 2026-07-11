// Stage 2 Track B — usage credential storage (app side).
//
// Provider API keys and the Discord webhook URL are credentials. They are
// encrypted with Electron safeStorage and written to a separate file from the
// non-secret usage settings. On macOS they live in the user Keychain so the
// app and its LaunchAgent daemon can both read them. Values are never logged.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
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
    // Repair permissive modes from older builds before reading legacy values.
    chmodSync(path, 0o600)
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>
  } catch {
    return {}
  }
}

function writeRaw(data: Record<string, string>): void {
  const path = getSecretsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 })
  // `mode` only applies when creating a file; enforce it for existing files too.
  chmodSync(path, 0o600)
}

function clearRawSecret(key: string): void {
  const data = readRaw()
  if (!(key in data)) return
  delete data[key]
  writeRaw(data)
}

/** Store (or clear when value is null) an encrypted secret by key. */
export function setUsageSecret(key: string, value: string | null): void {
  const clearing = value == null || value === ""
  if (clearing) {
    const keychainCleared = process.platform !== "darwin" || setKeychainSecret(key, null)
    // Always remove the legacy file copy. Otherwise a successful Keychain
    // delete can reveal an older fallback value on the next read.
    clearRawSecret(key)
    if (!keychainCleared) {
      throw new Error("Unable to clear the usage credential from macOS Keychain")
    }
    return
  }

  if (process.platform === "darwin") {
    if (setKeychainSecret(key, value)) {
      clearRawSecret(key)
      return
    }
    // The closed-app LaunchAgent runs with ELECTRON_RUN_AS_NODE and cannot
    // decrypt Electron safeStorage. Never claim a daemon credential is stored
    // when Keychain rejected it.
    throw new Error("Unable to store the usage credential in macOS Keychain")
  }

  const data = readRaw()
  const safe = getSafeStorage()
  if (safe?.isEncryptionAvailable()) {
    data[key] = "enc:" + safe.encryptString(value).toString("base64")
  } else {
    throw new Error("Secure credential storage is unavailable; the credential was not stored")
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
    const result = spawnSync(
      "/usr/bin/security",
      ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account],
      {
        encoding: "utf8",
      },
    )
    // macOS `security` exits 44 for errSecItemNotFound. Other failures (for
    // example denied Keychain access) must remain visible to the caller.
    return result.status === 0 || result.status === 44
  }
  const result = spawnSync(
    "/usr/bin/security",
    ["add-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-U", "-w"],
    { encoding: "utf8", input: `${value}\n` },
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
