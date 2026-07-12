/**
 * Provider credential storage for OpenCode-backed harnesses (Track E - E3).
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
import {
  getUsageSecret,
  getUsageSecretAsync,
  setUsageSecret,
  setUsageSecretAsync,
} from "../../usage/secrets"
import type { OpencodeProviderId } from "./contract"

const require = createRequire(import.meta.url)
const credentialsFileName = "opencode-provider-credentials.json"
const providerKeyCache = new Map<OpencodeProviderId, string>()
const persistedProviderKeys = new Set<OpencodeProviderId>()

/** Legacy key used by the short-lived direct-Keychain implementation. */
function legacyProviderSecretKey(provider: OpencodeProviderId): string {
  return `opencode.${provider}.api_key`
}

function usageProviderSecretKey(provider: OpencodeProviderId): string {
  return `${provider}.api_key`
}

type StoredCredential = {
  /** Base64 of an Electron safeStorage-encrypted key. */
  value: string
  encrypted: boolean
  /** The key exists only in memory and must not trigger legacy migration. */
  sessionOnly?: boolean
  /** Optional per-provider base URL override (NanoGPT self-host / proxies). */
  baseUrl?: string
  updatedAt: number
}

type CredentialsFile = Partial<Record<OpencodeProviderId, StoredCredential>>

export type ProviderCredentialStatus = {
  provider: OpencodeProviderId
  configured: boolean
  sessionOnly?: boolean
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
    // Unable to decrypt (e.g. moved machines) - treat as not configured.
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
  providerKeyCache.set(provider, trimmed)
  persistedProviderKeys.add(provider)
  if (process.env.NODE_ENV !== "test") {
    try {
      setUsageSecret(usageProviderSecretKey(provider), trimmed)
    } catch {
      console.warn(`[OpencodeSidecar] ${provider} background usage key could not be stored`)
    }
  }
}

export async function setProviderKeyAsync(
  provider: OpencodeProviderId,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const trimmed = apiKey.trim()
  if (!trimmed) throw new Error("API key cannot be empty")
  if (process.env.NODE_ENV === "test") {
    setProviderKey(provider, trimmed, baseUrl)
    return
  }
  providerKeyCache.set(provider, trimmed)
  try {
    const file = readCredentialsFile()
    const encrypted = encryptValue(trimmed)
    file[provider] = {
      ...encrypted,
      ...(baseUrl?.trim() ? { baseUrl: baseUrl.trim() } : {}),
      updatedAt: Date.now(),
    }
    writeCredentialsFile(file)
    persistedProviderKeys.add(provider)
  } catch {
    persistedProviderKeys.delete(provider)
    const file = readCredentialsFile()
    file[provider] = {
      value: "",
      encrypted: true,
      sessionOnly: true,
      ...(baseUrl?.trim() ? { baseUrl: baseUrl.trim() } : {}),
      updatedAt: Date.now(),
    }
    writeCredentialsFile(file)
    console.warn(`[OpencodeSidecar] ${provider} key is available for this app session only`)
  }
  try {
    await setUsageSecretAsync(usageProviderSecretKey(provider), trimmed)
  } catch {
    console.warn(`[OpencodeSidecar] ${provider} background usage key could not be stored`)
  }
}

/** Returns the decrypted key, or null when not configured / undecryptable. */
export function getProviderKey(provider: OpencodeProviderId): string | null {
  const cached = providerKeyCache.get(provider)
  if (cached) return cached

  const stored = readCredentialsFile()[provider]
  if (stored) {
    const decrypted = decryptValue(stored)
    if (decrypted) return decrypted
  }

  // Migrate credentials saved by the short-lived direct-Keychain implementation.
  const legacyCredential =
    stored?.value === "" && stored.sessionOnly !== true
      ? getUsageSecret(legacyProviderSecretKey(provider))
      : null
  if (legacyCredential) {
    try {
      setProviderKey(provider, legacyCredential, stored?.baseUrl)
    } catch {
      providerKeyCache.set(provider, legacyCredential)
    }
    return legacyCredential
  }

  // Development-only fallback: `scripts/dev.mjs` loads ignored `.env.local`.
  // Production keeps using encrypted Electron safeStorage credentials.
  const envKey = `FLAPSTACK_${provider.toUpperCase()}_API_KEY`
  return process.env[envKey]?.trim() || null
}

export async function getProviderKeyAsync(provider: OpencodeProviderId): Promise<string | null> {
  const cached = providerKeyCache.get(provider)
  if (cached) return cached
  if (process.env.NODE_ENV === "test") return getProviderKey(provider)
  const stored = readCredentialsFile()[provider]
  if (stored) {
    const decrypted = decryptValue(stored)
    if (decrypted) {
      providerKeyCache.set(provider, decrypted)
      persistedProviderKeys.add(provider)
      return decrypted
    }
  }
  const legacyCredential =
    stored?.value === "" && stored.sessionOnly !== true
      ? await getUsageSecretAsync(legacyProviderSecretKey(provider))
      : null
  if (legacyCredential) {
    try {
      await setProviderKeyAsync(provider, legacyCredential, stored?.baseUrl)
    } catch {
      providerKeyCache.set(provider, legacyCredential)
    }
    return legacyCredential
  }
  const envKey = `FLAPSTACK_${provider.toUpperCase()}_API_KEY`
  return process.env[envKey]?.trim() || null
}

export function getProviderBaseUrl(provider: OpencodeProviderId): string | undefined {
  return readCredentialsFile()[provider]?.baseUrl
}

export function clearProviderKey(provider: OpencodeProviderId): void {
  providerKeyCache.delete(provider)
  persistedProviderKeys.delete(provider)
  if (process.env.NODE_ENV !== "test") {
    try {
      setUsageSecret(legacyProviderSecretKey(provider), null)
      setUsageSecret(usageProviderSecretKey(provider), null)
    } catch {
      // Local encrypted storage remains independently clearable.
    }
  }
  const file = readCredentialsFile()
  if (file[provider]) {
    delete file[provider]
    writeCredentialsFile(file)
  }
}

export async function clearProviderKeyAsync(provider: OpencodeProviderId): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    try {
      await setUsageSecretAsync(legacyProviderSecretKey(provider), null)
      await setUsageSecretAsync(usageProviderSecretKey(provider), null)
    } catch {
      // Local encrypted storage remains independently clearable.
    }
  }
  providerKeyCache.delete(provider)
  persistedProviderKeys.delete(provider)
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

export async function getCredentialStatusAsync(
  provider: OpencodeProviderId,
): Promise<ProviderCredentialStatus> {
  const stored = readCredentialsFile()[provider]
  return {
    provider,
    configured: (await getProviderKeyAsync(provider)) !== null,
    ...(providerKeyCache.has(provider) && !persistedProviderKeys.has(provider)
      ? { sessionOnly: true }
      : {}),
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
