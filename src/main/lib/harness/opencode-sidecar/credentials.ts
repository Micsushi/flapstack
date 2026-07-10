/**
 * Provider credential storage for OpenCode-backed harnesses (Track E — E3).
 *
 * Keys are stored encrypted with Electron `safeStorage` in a local JSON file
 * (no hosted sync). We deliberately avoid a DB migration here: the file lives
 * next to `permissions.json` under the Flapstack config dir. Raw keys are never
 * written to logs, manifests, or reusable docs.
 *
 * Scaffolding stage: read/write/clear + presence checks are real; they are the
 * source of truth the launcher/config will read from once wired.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import type { OpencodeProviderId } from "./contract"

const require = createRequire(import.meta.url)
const credentialsFileName = "opencode-provider-credentials.json"

type StoredCredential = {
  /** Base64 of an Electron safeStorage-encrypted key. */
  value: string
  encrypted: boolean
  /** Optional per-provider base URL override (NanoGPT self-host / proxies). */
  baseUrl?: string
  updatedAt: number
}

type CredentialsFile = Partial<Record<OpencodeProviderId, StoredCredential>>

export type ProviderCredentialStatus = {
  provider: OpencodeProviderId
  configured: boolean
  baseUrl?: string
  updatedAt?: number
}

function encryptValue(value: string): { value: string; encrypted: boolean } {
  try {
    const { safeStorage } = require("electron") as {
      safeStorage?: {
        isEncryptionAvailable(): boolean
        encryptString(v: string): Buffer
      }
    }
    if (safeStorage?.isEncryptionAvailable()) {
      return { value: safeStorage.encryptString(value).toString("base64"), encrypted: true }
    }
  } catch {
    // Unit tests exercise file behavior without loading Electron.
  }
  if (process.env.NODE_ENV === "test") return { value, encrypted: false }
  throw new Error("OS keychain encryption is unavailable; API keys cannot be stored securely.")
}

function decryptValue(stored: StoredCredential): string | null {
  if (!stored.encrypted) return stored.value
  try {
    const { safeStorage } = require("electron") as {
      safeStorage?: { decryptString(buffer: Buffer): string }
    }
    if (safeStorage) {
      return safeStorage.decryptString(Buffer.from(stored.value, "base64"))
    }
  } catch {
    // Unable to decrypt (e.g. moved machines) — treat as not configured.
  }
  return null
}

export function setProviderKey(
  provider: OpencodeProviderId,
  apiKey: string,
  baseUrl?: string,
): void {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    throw new Error("API key cannot be empty")
  }
  const file = readCredentialsFile()
  const { value, encrypted } = encryptValue(trimmed)
  file[provider] = {
    value,
    encrypted,
    ...(baseUrl?.trim() ? { baseUrl: baseUrl.trim() } : {}),
    updatedAt: Date.now(),
  }
  writeCredentialsFile(file)
}

/** Returns the decrypted key, or null when not configured / undecryptable. */
export function getProviderKey(provider: OpencodeProviderId): string | null {
  const stored = readCredentialsFile()[provider]
  if (stored) {
    const decrypted = decryptValue(stored)
    if (decrypted) return decrypted
  }

  // Development-only fallback: `scripts/dev.mjs` loads ignored `.env.local`.
  // Production keeps using encrypted Electron safeStorage credentials.
  const envKey = `FLAPSTACK_${provider.toUpperCase()}_API_KEY`
  return process.env[envKey]?.trim() || null
}

export function getProviderBaseUrl(provider: OpencodeProviderId): string | undefined {
  return readCredentialsFile()[provider]?.baseUrl
}

export function clearProviderKey(provider: OpencodeProviderId): void {
  const file = readCredentialsFile()
  if (file[provider]) {
    delete file[provider]
    writeCredentialsFile(file)
  }
}

export function hasProviderKey(provider: OpencodeProviderId): boolean {
  return getProviderKey(provider) !== null
}

export function getCredentialStatus(provider: OpencodeProviderId): ProviderCredentialStatus {
  const stored = readCredentialsFile()[provider]
  return {
    provider,
    configured: hasProviderKey(provider),
    ...(stored?.baseUrl ? { baseUrl: stored.baseUrl } : {}),
    ...(stored?.updatedAt ? { updatedAt: stored.updatedAt } : {}),
  }
}

function readCredentialsFile(): CredentialsFile {
  const path = getCredentialsPath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CredentialsFile
  } catch (error) {
    console.warn("[OpencodeSidecar] Failed to read provider credentials:", error)
    return {}
  }
}

function writeCredentialsFile(file: CredentialsFile): void {
  const path = getCredentialsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(file, null, 2), { mode: 0o600 })
}

function getCredentialsPath(): string {
  return join(getOpencodeStorageDir(), credentialsFileName)
}

export function getOpencodeStorageDir(): string {
  const overrideDir = process.env.FLAPSTACK_CONFIG_DIR
  if (overrideDir) {
    return overrideDir
  }
  return join(getElectronUserDataPath(), "data")
}

function getElectronUserDataPath(): string {
  try {
    const electron = require("electron") as { app?: { getPath(name: string): string } }
    const userDataPath = electron.app?.getPath("userData")
    if (userDataPath) return userDataPath
  } catch {
    // Unit tests import the pure helpers outside Electron.
  }
  return join(process.cwd(), ".flapstack")
}
