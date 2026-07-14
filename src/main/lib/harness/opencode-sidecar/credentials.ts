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
const providerOperations = new Map<OpencodeProviderId, Promise<void>>()
const providerGenerations = new Map<OpencodeProviderId, number>()
const providerMutationRevisions = new Map<OpencodeProviderId, number>()
// Desired records invocation order; applied is the last main-store mutation
// that completed. Failed requests roll desired back to applied before any
// older async OS-store completion can reconcile.
const providerDesiredMutations = new Map<OpencodeProviderId, ProviderMutation>()
const providerAppliedMutations = new Map<OpencodeProviderId, ProviderMutation>()

type ProviderSettings = Partial<
  Record<OpencodeProviderId, { baseUrl?: string; legacyRetired?: true }>
>

type ProviderMutation = {
  revision: number
  apiKey: string | null
  baseUrl?: string
}

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

function generation(provider: OpencodeProviderId): number {
  return providerGenerations.get(provider) ?? 0
}

function bumpGeneration(provider: OpencodeProviderId): void {
  providerGenerations.set(provider, generation(provider) + 1)
}

function beginMutation(
  provider: OpencodeProviderId,
  apiKey: string | null,
  baseUrl?: string,
): ProviderMutation {
  const mutation = {
    revision: (providerMutationRevisions.get(provider) ?? 0) + 1,
    apiKey: apiKey?.trim() || null,
    ...(baseUrl?.trim() ? { baseUrl: baseUrl.trim() } : {}),
  }
  providerMutationRevisions.set(provider, mutation.revision)
  providerDesiredMutations.set(provider, mutation)
  return mutation
}

function isCurrentMutation(provider: OpencodeProviderId, mutation: ProviderMutation): boolean {
  return providerDesiredMutations.get(provider)?.revision === mutation.revision
}

function applyAndCommitMainMutation(
  provider: OpencodeProviderId,
  mutation: ProviderMutation,
): void {
  try {
    applyMainMutation(provider, mutation)
    providerAppliedMutations.set(provider, mutation)
  } catch (error) {
    if (isCurrentMutation(provider, mutation)) {
      const applied = providerAppliedMutations.get(provider)
      if (applied) providerDesiredMutations.set(provider, applied)
      else providerDesiredMutations.delete(provider)
    }
    throw error
  }
}

function serializeProviderOperation<T>(
  provider: OpencodeProviderId,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = providerOperations.get(provider) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  const tracked = result.then(
    () => undefined,
    () => undefined,
  )
  providerOperations.set(provider, tracked)
  return result.finally(() => {
    if (providerOperations.get(provider) === tracked) providerOperations.delete(provider)
  })
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
  const legacyRetired = settings[provider]?.legacyRetired
  if (normalized || legacyRetired) {
    settings[provider] = {
      ...(normalized ? { baseUrl: normalized } : {}),
      ...(legacyRetired ? { legacyRetired } : {}),
    }
  } else delete settings[provider]
  writeJsonAtomic(settingsPath(), settings)
}

function setRetiredProviderSettings(provider: OpencodeProviderId, baseUrl?: string): void {
  const settings = readSettings()
  const normalized = baseUrl?.trim()
  settings[provider] = {
    ...(normalized ? { baseUrl: normalized } : {}),
    legacyRetired: true,
  }
  writeJsonAtomic(settingsPath(), settings)
}

function retireLegacyProvider(provider: OpencodeProviderId): void {
  const legacyPath = join(getOpencodeStorageDir(), legacyCredentialsFileName)
  if (process.env.NODE_ENV === "test" && !existsSync(settingsPath()) && !existsSync(legacyPath)) {
    // Unit tests that do not own an isolated profile must not create repo-local
    // app data. Dedicated production-mode migration tests cover the tombstone.
    return
  }
  const settings = readSettings()
  settings[provider] = { ...settings[provider], legacyRetired: true }
  writeJsonAtomic(settingsPath(), settings)
}

function isLegacyProviderRetired(provider: OpencodeProviderId): boolean {
  return readSettings()[provider]?.legacyRetired === true
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
  if (isLegacyProviderRetired(provider)) return null
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
    retireLegacyProvider(provider)
    delete file[provider]
    writeJsonAtomic(path, file)
    if (process.env.NODE_ENV !== "test") {
      try {
        setUsageSecret(legacyProviderSecretKey(provider), null)
      } catch {
        // The durable tombstone prevents this stale source from being imported.
      }
    }
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
  if (result.persistence === "session") console.warn(`[Credentials] ${provider} is session-only`)
}

function retireLegacyFileSource(provider: OpencodeProviderId): void {
  // Write the durable tombstone before best-effort physical deletion. A locked
  // Keychain or damaged legacy file must never resurrect an accepted replacement.
  retireLegacyProvider(provider)
  try {
    clearLegacyFileProvider(provider)
  } catch (error) {
    console.warn(`[Credentials] Could not physically remove legacy ${provider} file`, error)
  }
}

function daemonWarning(apiKey: string | null): string {
  return apiKey
    ? "The app can use this credential, but the background usage daemon cannot access it. Unlock the OS credential store and retry."
    : "The app credential was removed, but background secure-storage cleanup failed. Unlock the OS credential store and retry."
}

function writeDaemonCredentialSync(provider: OpencodeProviderId, apiKey: string | null): void {
  let failed = false
  try {
    setUsageSecret(legacyProviderSecretKey(provider), null)
  } catch {
    failed = true
  }
  try {
    setUsageSecret(usageProviderSecretKey(provider), apiKey)
  } catch {
    failed = true
  }
  if (failed) {
    daemonWarnings.set(provider, daemonWarning(apiKey))
    console.warn(`[Credentials] ${provider} daemon credential update is unavailable`)
  } else {
    daemonWarnings.delete(provider)
  }
}

async function writeDaemonCredentialAsync(
  provider: OpencodeProviderId,
  mutation: ProviderMutation,
): Promise<void> {
  let failed = false
  try {
    await setUsageSecretAsync(legacyProviderSecretKey(provider), null)
  } catch {
    failed = true
  }
  try {
    await setUsageSecretAsync(usageProviderSecretKey(provider), mutation.apiKey)
  } catch {
    failed = true
  }
  if (failed) {
    daemonWarnings.set(provider, daemonWarning(mutation.apiKey))
    console.warn(`[Credentials] ${provider} daemon credential update is unavailable`)
  } else {
    daemonWarnings.delete(provider)
  }
}

async function reconcileLatestDaemonCredential(provider: OpencodeProviderId): Promise<void> {
  while (true) {
    const applied = providerAppliedMutations.get(provider)
    if (!applied) return
    await writeDaemonCredentialAsync(provider, applied)
    if (providerAppliedMutations.get(provider)?.revision === applied.revision) return
  }
}

function applyMainMutation(provider: OpencodeProviderId, mutation: ProviderMutation): void {
  bumpGeneration(provider)
  if (mutation.apiKey) {
    const previousSettings = readSettings()
    // Persist the retirement marker before accepting the replacement. A crash
    // can then lose a session-only replacement, but cannot revive stale legacy data.
    setRetiredProviderSettings(provider, mutation.baseUrl)
    try {
      setMainProviderKey(provider, mutation.apiKey, mutation.baseUrl)
    } catch (error) {
      try {
        writeJsonAtomic(settingsPath(), previousSettings)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Could not set or roll back the ${provider} credential`,
        )
      }
      throw error
    }
    retireLegacyFileSource(provider)
    return
  }

  // Clear every legacy durable source before the current store. A crash can
  // then leave the credential still configured, but cannot resurrect legacy data.
  retireLegacyProvider(provider)
  clearLegacyFileProvider(provider)
  setBaseUrl(provider)
  getCredentialService().remove(credentialId(provider))
}

export function setProviderKey(
  provider: OpencodeProviderId,
  apiKey: string,
  baseUrl?: string,
): void {
  const mutation = beginMutation(provider, apiKey, baseUrl)
  applyAndCommitMainMutation(provider, mutation)
  if (process.env.NODE_ENV !== "test") {
    writeDaemonCredentialSync(provider, mutation.apiKey)
  }
}

export async function setProviderKeyAsync(
  provider: OpencodeProviderId,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const mutation = beginMutation(provider, apiKey, baseUrl)
  return serializeProviderOperation(provider, async () => {
    if (!isCurrentMutation(provider, mutation)) return
    try {
      applyAndCommitMainMutation(provider, mutation)
    } catch (error) {
      if (process.env.NODE_ENV !== "test") await reconcileLatestDaemonCredential(provider)
      throw error
    }
    if (process.env.NODE_ENV !== "test") {
      await writeDaemonCredentialAsync(provider, mutation)
      if (!isCurrentMutation(provider, mutation)) await reconcileLatestDaemonCredential(provider)
    }
  })
}

export function getProviderKey(provider: OpencodeProviderId): string | null {
  const serviceValue = getCredentialService().resolve(credentialId(provider))
  if (serviceValue) return serviceValue
  const legacyFileValue = migrateLegacyFile(provider)
  if (legacyFileValue) return legacyFileValue
  const legacyKeychainValue = isLegacyProviderRetired(provider)
    ? null
    : getUsageSecret(legacyProviderSecretKey(provider))
  if (legacyKeychainValue) {
    const result = getCredentialService().set(credentialId(provider), legacyKeychainValue, {
      metadata: getProviderBaseUrl(provider)
        ? { baseUrl: getProviderBaseUrl(provider) }
        : undefined,
      requirePersistence: true,
    })
    if (result.acknowledged) {
      retireLegacyFileSource(provider)
      if (process.env.NODE_ENV !== "test") {
        try {
          setUsageSecret(legacyProviderSecretKey(provider), null)
        } catch {
          // The durable tombstone prevents this stale source from being imported.
        }
      }
    }
    return legacyKeychainValue
  }
  const envKey = `FLAPSTACK_${provider.toUpperCase()}_API_KEY`
  return process.env[envKey]?.trim() || null
}

export async function getProviderKeyAsync(provider: OpencodeProviderId): Promise<string | null> {
  return serializeProviderOperation(provider, async () => {
    const serviceValue = getCredentialService().resolve(credentialId(provider))
    if (serviceValue) return serviceValue
    const legacyFileValue = migrateLegacyFile(provider)
    if (legacyFileValue) return legacyFileValue
    const readGeneration = generation(provider)
    const legacyKeychainValue = isLegacyProviderRetired(provider)
      ? null
      : await getUsageSecretAsync(legacyProviderSecretKey(provider))
    if (generation(provider) !== readGeneration) {
      return (
        getCredentialService().resolve(credentialId(provider)) ??
        process.env[`FLAPSTACK_${provider.toUpperCase()}_API_KEY`]?.trim() ??
        null
      )
    }
    if (legacyKeychainValue) {
      const result = getCredentialService().set(credentialId(provider), legacyKeychainValue, {
        metadata: getProviderBaseUrl(provider)
          ? { baseUrl: getProviderBaseUrl(provider) }
          : undefined,
        requirePersistence: true,
      })
      if (result.acknowledged) {
        retireLegacyFileSource(provider)
        if (process.env.NODE_ENV !== "test") {
          try {
            await setUsageSecretAsync(legacyProviderSecretKey(provider), null)
          } catch {
            // The durable tombstone prevents this stale source from being imported.
          }
        }
      }
      return legacyKeychainValue
    }
    const envKey = `FLAPSTACK_${provider.toUpperCase()}_API_KEY`
    return process.env[envKey]?.trim() || null
  })
}

export function getProviderBaseUrl(provider: OpencodeProviderId): string | undefined {
  return readSettings()[provider]?.baseUrl
}

export function clearProviderKey(provider: OpencodeProviderId): void {
  const mutation = beginMutation(provider, null)
  applyAndCommitMainMutation(provider, mutation)
  if (process.env.NODE_ENV !== "test") {
    writeDaemonCredentialSync(provider, null)
  }
}

export async function clearProviderKeyAsync(provider: OpencodeProviderId): Promise<void> {
  const mutation = beginMutation(provider, null)
  return serializeProviderOperation(provider, async () => {
    if (!isCurrentMutation(provider, mutation)) return
    try {
      applyAndCommitMainMutation(provider, mutation)
    } catch (error) {
      if (process.env.NODE_ENV !== "test") await reconcileLatestDaemonCredential(provider)
      throw error
    }
    if (process.env.NODE_ENV !== "test") {
      await writeDaemonCredentialAsync(provider, mutation)
      if (!isCurrentMutation(provider, mutation)) await reconcileLatestDaemonCredential(provider)
    }
  })
}

export function hasProviderKey(provider: OpencodeProviderId): boolean {
  return getProviderKey(provider) !== null
}

export function getCredentialStatus(provider: OpencodeProviderId): ProviderCredentialStatus {
  const status = getCredentialService().status(credentialId(provider))
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
  return serializeProviderOperation(provider, async () => getCredentialStatus(provider))
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
