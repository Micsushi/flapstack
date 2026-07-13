/** Secure provider credential adapter for OpenCode-backed harnesses. */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import type { CredentialId } from "../../../../shared/credential-types"
import { getCredentialService } from "../../credential-service"
import {
  getUsageSecret,
  getUsageSecretAsync,
  setUsageSecret,
  setUsageSecretAsync,
} from "../../usage/secrets"
import type { OpencodeProviderId } from "./contract"

const require = createRequire(import.meta.url)
const legacyCredentialsFileName = "opencode-provider-credentials.json"
const settingsFileName = "opencode-provider-settings.json"
const daemonWarnings = new Map<OpencodeProviderId, string>()

type ProviderSettings = Partial<Record<OpencodeProviderId, { baseUrl?: string }>>

type LegacyStoredCredential = {
  value: string
  encrypted: boolean
  sessionOnly?: boolean
  baseUrl?: string
}

type LegacyCredentialsFile = Partial<Record<OpencodeProviderId, LegacyStoredCredential>>

export type ProviderCredentialStatus = {
  provider: OpencodeProviderId
  configured: boolean
  sessionOnly?: boolean
  source?: "encrypted-store" | "session-memory" | "environment"
  baseUrl?: string
  updatedAt?: number
  fingerprint?: string
  warning?: string
}

function credentialId(provider: OpencodeProviderId): CredentialId {
  return `${provider}.api-key` as CredentialId
}

function legacyProviderSecretKey(provider: OpencodeProviderId): string {
  return `opencode.${provider}.api_key`
}

function usageProviderSecretKey(provider: OpencodeProviderId): string {
  return `${provider}.api_key`
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    chmodSync(path, 0o600)
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch {
    return fallback
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tempPath = `${path}.${process.pid}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  chmodSync(tempPath, 0o600)
  renameSync(tempPath, path)
  chmodSync(path, 0o600)
}

function settingsPath(): string {
  return join(getOpencodeStorageDir(), settingsFileName)
}

function readSettings(): ProviderSettings {
  return readJson(settingsPath(), {})
}

function setBaseUrl(provider: OpencodeProviderId, baseUrl?: string): void {
  if (!baseUrl?.trim() && !existsSync(settingsPath())) return
  const settings = readSettings()
  const normalized = baseUrl?.trim()
  if (normalized) settings[provider] = { baseUrl: normalized }
  else delete settings[provider]
  writeJsonAtomic(settingsPath(), settings)
}

function decryptLegacy(stored: LegacyStoredCredential): string | null {
  if (stored.sessionOnly || !stored.value) return null
  if (!stored.encrypted) return process.env.NODE_ENV === "test" ? stored.value : null
  try {
    const electron = require("electron") as {
      safeStorage?: { decryptString(value: Buffer): string }
    }
    return electron.safeStorage?.decryptString(Buffer.from(stored.value, "base64")) ?? null
  } catch {
    return null
  }
}

function migrateLegacyFile(provider: OpencodeProviderId): string | null {
  const path = join(getOpencodeStorageDir(), legacyCredentialsFileName)
  const file = readJson<LegacyCredentialsFile>(path, {})
  const stored = file[provider]
  if (!stored) return null
  if (stored.baseUrl && !getProviderBaseUrl(provider)) setBaseUrl(provider, stored.baseUrl)
  const secret = decryptLegacy(stored)
  if (!secret) return null
  const result = getCredentialService().set(credentialId(provider), secret, {
    metadata: stored.baseUrl ? { baseUrl: stored.baseUrl } : undefined,
    requirePersistence: true,
  })
  if (result.acknowledged) {
    delete file[provider]
    writeJsonAtomic(path, file)
  }
  return secret
}

function clearLegacyFileProvider(provider: OpencodeProviderId): void {
  const path = join(getOpencodeStorageDir(), legacyCredentialsFileName)
  if (!existsSync(path)) return
  let file: LegacyCredentialsFile
  try {
    chmodSync(path, 0o600)
    file = JSON.parse(readFileSync(path, "utf8")) as LegacyCredentialsFile
  } catch (error) {
    throw new Error(
      `Could not clear the legacy ${provider} credential store: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!file[provider]) return
  delete file[provider]
  writeJsonAtomic(path, file)
}

function setMainProviderKey(provider: OpencodeProviderId, apiKey: string, baseUrl?: string): void {
  const result = getCredentialService().set(credentialId(provider), apiKey, {
    metadata: baseUrl?.trim() ? { baseUrl: baseUrl.trim() } : undefined,
  })
  setBaseUrl(provider, baseUrl)
  if (result.persistence === "session") console.warn(`[Credentials] ${provider} is session-only`)
}

export function setProviderKey(
  provider: OpencodeProviderId,
  apiKey: string,
  baseUrl?: string,
): void {
  setMainProviderKey(provider, apiKey, baseUrl)
  if (process.env.NODE_ENV !== "test") {
    try {
      setUsageSecret(usageProviderSecretKey(provider), apiKey.trim())
      daemonWarnings.delete(provider)
    } catch {
      daemonWarnings.set(
        provider,
        "The app can use this credential, but the background usage daemon cannot access it. Unlock the OS credential store and retry.",
      )
      console.warn(`[Credentials] ${provider} background usage access is unavailable`)
    }
  }
}

export async function setProviderKeyAsync(
  provider: OpencodeProviderId,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  setMainProviderKey(provider, apiKey, baseUrl)
  if (process.env.NODE_ENV !== "test") {
    try {
      await setUsageSecretAsync(usageProviderSecretKey(provider), apiKey.trim())
      daemonWarnings.delete(provider)
    } catch {
      daemonWarnings.set(
        provider,
        "The app can use this credential, but the background usage daemon cannot access it. Unlock the OS credential store and retry.",
      )
      console.warn(`[Credentials] ${provider} daemon access is unavailable`)
    }
  }
}

export function getProviderKey(provider: OpencodeProviderId): string | null {
  const serviceValue = getCredentialService().resolve(credentialId(provider))
  if (serviceValue) return serviceValue
  const legacyFileValue = migrateLegacyFile(provider)
  if (legacyFileValue) return legacyFileValue
  const legacyKeychainValue = getUsageSecret(legacyProviderSecretKey(provider))
  if (legacyKeychainValue) {
    getCredentialService().set(credentialId(provider), legacyKeychainValue, {
      metadata: getProviderBaseUrl(provider)
        ? { baseUrl: getProviderBaseUrl(provider) }
        : undefined,
    })
    return legacyKeychainValue
  }
  const envKey = `FLAPSTACK_${provider.toUpperCase()}_API_KEY`
  return process.env[envKey]?.trim() || null
}

export async function getProviderKeyAsync(provider: OpencodeProviderId): Promise<string | null> {
  const serviceValue = getCredentialService().resolve(credentialId(provider))
  if (serviceValue) return serviceValue
  const legacyFileValue = migrateLegacyFile(provider)
  if (legacyFileValue) return legacyFileValue
  const legacyKeychainValue = await getUsageSecretAsync(legacyProviderSecretKey(provider))
  if (legacyKeychainValue) {
    getCredentialService().set(credentialId(provider), legacyKeychainValue, {
      metadata: getProviderBaseUrl(provider)
        ? { baseUrl: getProviderBaseUrl(provider) }
        : undefined,
    })
    return legacyKeychainValue
  }
  const envKey = `FLAPSTACK_${provider.toUpperCase()}_API_KEY`
  return process.env[envKey]?.trim() || null
}

export function getProviderBaseUrl(provider: OpencodeProviderId): string | undefined {
  return readSettings()[provider]?.baseUrl
}

export function clearProviderKey(provider: OpencodeProviderId): void {
  // Clear every legacy durable source before the current store. A crash can
  // then leave the credential still configured, but can never resurrect a
  // credential that the current store already removed.
  clearLegacyFileProvider(provider)
  if (process.env.NODE_ENV !== "test") {
    setUsageSecret(legacyProviderSecretKey(provider), null)
    setUsageSecret(usageProviderSecretKey(provider), null)
  }
  setBaseUrl(provider)
  getCredentialService().remove(credentialId(provider))
  daemonWarnings.delete(provider)
}

export async function clearProviderKeyAsync(provider: OpencodeProviderId): Promise<void> {
  clearLegacyFileProvider(provider)
  if (process.env.NODE_ENV !== "test") {
    await Promise.all([
      setUsageSecretAsync(legacyProviderSecretKey(provider), null),
      setUsageSecretAsync(usageProviderSecretKey(provider), null),
    ])
  }
  setBaseUrl(provider)
  getCredentialService().remove(credentialId(provider))
  daemonWarnings.delete(provider)
}

export function hasProviderKey(provider: OpencodeProviderId): boolean {
  return getProviderKey(provider) !== null
}

export function getCredentialStatus(provider: OpencodeProviderId): ProviderCredentialStatus {
  let status = getCredentialService().status(credentialId(provider))
  if (!status.configured) getProviderKey(provider)
  status = getCredentialService().status(credentialId(provider))
  const environmentConfigured = Boolean(
    process.env[`FLAPSTACK_${provider.toUpperCase()}_API_KEY`]?.trim(),
  )
  const configured = status.configured || environmentConfigured
  return {
    provider,
    configured,
    ...(status.persistence === "session" ? { sessionOnly: true } : {}),
    ...(status.source
      ? { source: status.source }
      : environmentConfigured
        ? { source: "environment" as const }
        : {}),
    ...(getProviderBaseUrl(provider) ? { baseUrl: getProviderBaseUrl(provider) } : {}),
    ...(status.updatedAt ? { updatedAt: status.updatedAt } : {}),
    ...(status.fingerprint ? { fingerprint: status.fingerprint } : {}),
    ...(status.warning || daemonWarnings.get(provider)
      ? { warning: status.warning || daemonWarnings.get(provider) }
      : {}),
  }
}

export async function getCredentialStatusAsync(
  provider: OpencodeProviderId,
): Promise<ProviderCredentialStatus> {
  await getProviderKeyAsync(provider)
  return getCredentialStatus(provider)
}

export function getOpencodeStorageDir(): string {
  if (process.env.FLAPSTACK_CONFIG_DIR) return process.env.FLAPSTACK_CONFIG_DIR
  try {
    const electron = require("electron") as { app?: { getPath(name: string): string } }
    const userDataPath = electron.app?.getPath("userData")
    if (userDataPath) return join(userDataPath, "data")
  } catch {
    // Node-only tests do not load Electron.
  }
  return join(process.cwd(), ".flapstack", "data")
}
