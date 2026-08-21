import { createHash, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import {
  CREDENTIAL_IDS,
  type CredentialId,
  type CredentialMetadata,
  type CredentialStatus,
  type CredentialWriteAcknowledgement,
} from "../../shared/credential-types"
import { inspectSafeStorageBackend } from "./safe-storage-backend"

const require = createRequire(import.meta.url)
const STORE_SCHEMA_VERSION = 1
const STORE_FILE_NAME = "credentials.v1.json"
const LEGACY_SOURCE_CREDENTIAL_IDS = new Set<CredentialId>([
  "codex.api-key",
  "openai.voice-api-key",
  "claude.custom-api-token",
])

type StoredCredential = {
  ciphertext: string
  fingerprint: string
  updatedAt: number
  encryptionBackend: string
  metadata?: CredentialMetadata
}

type CredentialStoreFile = {
  schemaVersion: typeof STORE_SCHEMA_VERSION
  credentials: Record<string, StoredCredential>
  retiredLegacySources?: CredentialId[]
}

type SessionCredential = {
  secret: string
  fingerprint: string
  updatedAt: number
  metadata?: CredentialMetadata
  warning: string
}

export type CredentialEncryption = {
  inspect(): { available: boolean; backend: string; warning?: string }
  encrypt(secret: string): Buffer
  decrypt(ciphertext: Buffer): string
}

export type CredentialServiceOptions = {
  storageDir?: string
  encryption?: CredentialEncryption
  now?: () => number
}

export type CredentialSetOptions = {
  metadata?: CredentialMetadata
  requirePersistence?: boolean
  legacyMigration?: boolean
}

function emptyStore(): CredentialStoreFile {
  return { schemaVersion: STORE_SCHEMA_VERSION, credentials: {}, retiredLegacySources: [] }
}

export function credentialFingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 12)
}

function sanitizeMetadata(metadata?: CredentialMetadata): CredentialMetadata | undefined {
  if (!metadata) return undefined
  const model = metadata.model?.trim()
  let baseUrl = metadata.baseUrl?.trim()
  if (baseUrl) {
    const parsed = new URL(baseUrl)
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("Credential metadata contains an unsafe base URL")
    }
    baseUrl = parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "" : "/")
  }
  if (!model && !baseUrl) return undefined
  return {
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  }
}

function isStoredCredential(value: unknown): value is StoredCredential {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  return (
    typeof item.ciphertext === "string" &&
    item.ciphertext.length > 0 &&
    typeof item.fingerprint === "string" &&
    /^[a-f0-9]{12}$/.test(item.fingerprint) &&
    typeof item.updatedAt === "number" &&
    Number.isFinite(item.updatedAt) &&
    typeof item.encryptionBackend === "string"
  )
}

function parseStore(raw: string): CredentialStoreFile {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  if (parsed.schemaVersion !== STORE_SCHEMA_VERSION || !parsed.credentials) {
    throw new Error("Unsupported credential store schema")
  }
  const credentials = parsed.credentials as Record<string, unknown>
  for (const [id, value] of Object.entries(credentials)) {
    if (
      (!(CREDENTIAL_IDS as readonly string[]).includes(id) && !/^mcp\.[a-f0-9]{64}$/.test(id)) ||
      !isStoredCredential(value)
    ) {
      throw new Error("Invalid credential store entry")
    }
  }
  if (
    parsed.retiredLegacySources !== undefined &&
    (!Array.isArray(parsed.retiredLegacySources) ||
      parsed.retiredLegacySources.some(
        (id) => typeof id !== "string" || !(CREDENTIAL_IDS as readonly string[]).includes(id),
      ))
  ) {
    throw new Error("Invalid retired legacy credential source inventory")
  }
  return parsed as CredentialStoreFile
}

function retireLegacySourceInStore(store: CredentialStoreFile, id: CredentialId): boolean {
  if (!LEGACY_SOURCE_CREDENTIAL_IDS.has(id)) return false
  const retired = new Set(store.retiredLegacySources ?? [])
  if (retired.has(id)) return false
  retired.add(id)
  store.retiredLegacySources = [...retired]
  return true
}

function defaultStorageDir(): string {
  if (process.env.FLAPSTACK_CONFIG_DIR) return process.env.FLAPSTACK_CONFIG_DIR
  try {
    const electron = require("electron") as { app?: { getPath(name: string): string } }
    const userData = electron.app?.getPath("userData")
    if (userData) return join(userData, "data")
  } catch {
    // Tests and node-only processes may not load Electron.
  }
  return join(process.cwd(), ".flapstack", "data")
}

export function secureCredentialFile(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
  options: {
    identity?: string
    runner?: typeof execFileSync
  } = {},
): void {
  if (platform !== "win32") {
    chmodSync(filePath, 0o600)
    return
  }
  const identity =
    options.identity ?? [process.env.USERDOMAIN, process.env.USERNAME].filter(Boolean).join("\\")
  if (!identity) throw new Error("Could not determine the current Windows identity")
  const runner = options.runner ?? execFileSync
  runner("icacls.exe", [filePath, "/inheritance:r", "/grant:r", `${identity}:(F)`], {
    stdio: "ignore",
    windowsHide: true,
  })
}

function defaultEncryption(): CredentialEncryption {
  return {
    inspect() {
      try {
        const electron = require("electron") as {
          safeStorage?: {
            isEncryptionAvailable(): boolean
            getSelectedStorageBackend?(): string
          }
        }
        return inspectSafeStorageBackend(electron.safeStorage)
      } catch {
        return {
          available: false,
          backend: "unavailable",
          warning:
            "Secure OS credential encryption is unavailable. The credential is session-only.",
        }
      }
    },
    encrypt(secret) {
      const electron = require("electron") as {
        safeStorage: { encryptString(value: string): Buffer }
      }
      return electron.safeStorage.encryptString(secret)
    },
    decrypt(ciphertext) {
      const electron = require("electron") as {
        safeStorage: { decryptString(value: Buffer): string }
      }
      return electron.safeStorage.decryptString(ciphertext)
    },
  }
}

export class CredentialService {
  private readonly storageDir: string
  private readonly encryption: CredentialEncryption
  private readonly now: () => number
  private readonly sessionCredentials = new Map<string, SessionCredential>()
  private readonly resolutionWarnings = new Map<string, string>()

  constructor(options: CredentialServiceOptions = {}) {
    this.storageDir = options.storageDir ?? defaultStorageDir()
    this.encryption = options.encryption ?? defaultEncryption()
    this.now = options.now ?? Date.now
  }

  get storePath(): string {
    return join(this.storageDir, STORE_FILE_NAME)
  }

  set(
    id: CredentialId,
    rawSecret: string,
    options: CredentialSetOptions = {},
  ): CredentialWriteAcknowledgement {
    const secret = rawSecret.trim()
    if (!secret) throw new Error("Credential cannot be empty")
    const fingerprint = credentialFingerprint(secret)
    const updatedAt = this.now()
    const metadata = sanitizeMetadata(options.metadata)
    const inspected = this.encryption.inspect()
    const retireLegacySource = !options.legacyMigration && LEGACY_SOURCE_CREDENTIAL_IDS.has(id)

    if (!inspected.available) {
      return this.setSessionOnlyAfterDurableRetirement(
        id,
        secret,
        fingerprint,
        updatedAt,
        metadata,
        inspected.warning,
        retireLegacySource,
      )
    }

    try {
      const ciphertext = this.encryption.encrypt(secret)
      const verified = this.encryption.decrypt(ciphertext)
      if (verified !== secret) throw new Error("Encrypted credential verification failed")
      const store = this.readStoreStrict()
      if (retireLegacySource) retireLegacySourceInStore(store, id)
      store.credentials[id] = {
        ciphertext: ciphertext.toString("base64"),
        fingerprint,
        updatedAt,
        encryptionBackend: inspected.backend,
        ...(metadata ? { metadata } : {}),
      }
      this.writeStoreAtomic(store)
      this.sessionCredentials.delete(id)
      this.resolutionWarnings.delete(id)
      return {
        id,
        configured: true,
        persistence: "encrypted",
        source: "encrypted-store",
        fingerprint,
        updatedAt,
        encryptionBackend: inspected.backend,
        ...(metadata ? { metadata } : {}),
        acknowledged: true,
      }
    } catch {
      const warning =
        process.platform === "darwin"
          ? "macOS Keychain encryption failed or access was denied. The credential is session-only; unlock Keychain Access and retry to persist it."
          : "Secure credential persistence failed. The credential is session-only; retry after restoring the OS credential backend."
      const result = this.setSessionOnlyAfterDurableRetirement(
        id,
        secret,
        fingerprint,
        updatedAt,
        metadata,
        warning,
        retireLegacySource,
      )
      if (options.requirePersistence) return { ...result, acknowledged: false }
      return result
    }
  }

  private setSessionOnly(
    id: CredentialId,
    secret: string,
    fingerprint: string,
    updatedAt: number,
    metadata: CredentialMetadata | undefined,
    warning = "Secure credential persistence is unavailable. The credential is session-only.",
  ): CredentialWriteAcknowledgement {
    this.sessionCredentials.set(id, { secret, fingerprint, updatedAt, metadata, warning })
    this.resolutionWarnings.delete(id)
    return {
      id,
      configured: true,
      persistence: "session",
      source: "session-memory",
      fingerprint,
      updatedAt,
      encryptionBackend: null,
      ...(metadata ? { metadata } : {}),
      warning,
      acknowledged: false,
    }
  }

  private setSessionOnlyAfterDurableRetirement(
    id: CredentialId,
    secret: string,
    fingerprint: string,
    updatedAt: number,
    metadata: CredentialMetadata | undefined,
    warning?: string,
    retireLegacySource = false,
  ): CredentialWriteAcknowledgement {
    const store = this.readStoreStrict()
    let storeChanged = retireLegacySource ? retireLegacySourceInStore(store, id) : false
    if (store.credentials[id]) {
      delete store.credentials[id]
      storeChanged = true
    }
    if (storeChanged) {
      try {
        this.writeStoreAtomic(store)
      } catch {
        throw new Error(
          "Credential replacement was rejected because the prior durable value could not be retired.",
        )
      }
    }
    return this.setSessionOnly(id, secret, fingerprint, updatedAt, metadata, warning)
  }

  isLegacySourceRetired(id: CredentialId): boolean {
    return (this.readStoreStrict().retiredLegacySources ?? []).includes(id)
  }

  retireLegacySource(id: CredentialId): void {
    const store = this.readStoreStrict()
    if (retireLegacySourceInStore(store, id)) this.writeStoreAtomic(store)
  }

  resolve(id: CredentialId): string | null {
    const session = this.sessionCredentials.get(id)
    if (session) {
      this.resolutionWarnings.delete(id)
      return session.secret
    }
    try {
      const stored = this.readStoreStrict().credentials[id]
      if (!stored) {
        this.resolutionWarnings.delete(id)
        return null
      }
      const secret = this.encryption.decrypt(Buffer.from(stored.ciphertext, "base64"))
      if (credentialFingerprint(secret) !== stored.fingerprint) {
        this.resolutionWarnings.set(
          id,
          "The encrypted credential failed integrity verification. Replace or remove it.",
        )
        return null
      }
      this.resolutionWarnings.delete(id)
      return secret
    } catch {
      this.resolutionWarnings.set(
        id,
        "The encrypted credential could not be decrypted. Replace or remove it before retrying.",
      )
      return null
    }
  }

  status(id: CredentialId): CredentialStatus {
    const session = this.sessionCredentials.get(id)
    if (session) {
      return {
        id,
        configured: true,
        persistence: "session",
        source: "session-memory",
        fingerprint: session.fingerprint,
        updatedAt: session.updatedAt,
        encryptionBackend: null,
        ...(session.metadata ? { metadata: session.metadata } : {}),
        warning: session.warning,
      }
    }
    try {
      const stored = this.readStoreStrict().credentials[id]
      if (!stored) return this.emptyStatus(id)
      return {
        id,
        // Status polling is metadata-only. Decrypting here can prompt for a
        // locked OS keychain; actual credential consumers validate on resolve.
        configured: true,
        persistence: "encrypted",
        source: "encrypted-store",
        fingerprint: stored.fingerprint,
        updatedAt: stored.updatedAt,
        encryptionBackend: stored.encryptionBackend,
        ...(stored.metadata ? { metadata: stored.metadata } : {}),
        ...(this.resolutionWarnings.get(id) ? { warning: this.resolutionWarnings.get(id) } : {}),
      }
    } catch {
      return {
        ...this.emptyStatus(id),
        warning:
          "The encrypted credential store is unreadable. No data was changed; restore or remove the damaged file before retrying.",
      }
    }
  }

  listStatuses(): CredentialStatus[] {
    return CREDENTIAL_IDS.map((id) => this.status(id))
  }

  setOpaque(
    id: string,
    rawSecret: string,
    options: { requirePersistence?: boolean } = {},
  ): { persistence: "encrypted" | "session" } {
    if (!/^mcp\.[a-f0-9]{64}$/.test(id)) throw new Error("Invalid opaque credential identifier")
    const secret = rawSecret.trim()
    if (!secret) throw new Error("Credential cannot be empty")
    const fingerprint = credentialFingerprint(secret)
    const updatedAt = this.now()
    const inspected = this.encryption.inspect()
    if (inspected.available) {
      try {
        const ciphertext = this.encryption.encrypt(secret)
        if (this.encryption.decrypt(ciphertext) !== secret) {
          throw new Error("Encrypted credential verification failed")
        }
        const store = this.readStoreStrict()
        store.credentials[id] = {
          ciphertext: ciphertext.toString("base64"),
          fingerprint,
          updatedAt,
          encryptionBackend: inspected.backend,
        }
        this.writeStoreAtomic(store)
        this.sessionCredentials.delete(id)
        return { persistence: "encrypted" }
      } catch {
        if (options.requirePersistence) return { persistence: "session" }
        // Fall through to session-only storage if the OS backend fails.
      }
    }
    if (options.requirePersistence) return { persistence: "session" }
    const store = this.readStoreStrict()
    if (store.credentials[id]) {
      delete store.credentials[id]
      try {
        this.writeStoreAtomic(store)
      } catch {
        throw new Error(
          "Credential replacement was rejected because the prior durable value could not be retired.",
        )
      }
    }
    this.sessionCredentials.set(id, {
      secret,
      fingerprint,
      updatedAt,
      warning: inspected.warning ?? "Secure credential persistence is unavailable.",
    })
    return { persistence: "session" }
  }

  resolveOpaque(id: string): string | null {
    if (!/^mcp\.[a-f0-9]{64}$/.test(id)) return null
    const session = this.sessionCredentials.get(id)
    if (session) return session.secret
    try {
      const stored = this.readStoreStrict().credentials[id]
      if (!stored) return null
      const secret = this.encryption.decrypt(Buffer.from(stored.ciphertext, "base64"))
      return credentialFingerprint(secret) === stored.fingerprint ? secret : null
    } catch {
      return null
    }
  }

  removeOpaque(id: string): void {
    if (!/^mcp\.[a-f0-9]{64}$/.test(id)) return
    this.sessionCredentials.delete(id)
    const store = this.readStoreStrict()
    if (store.credentials[id]) {
      delete store.credentials[id]
      this.writeStoreAtomic(store)
    }
  }

  remove(id: CredentialId): CredentialStatus {
    const store = this.readStoreStrict()
    this.sessionCredentials.delete(id)
    this.resolutionWarnings.delete(id)
    if (store.credentials[id]) {
      delete store.credentials[id]
      this.writeStoreAtomic(store)
    }
    return this.emptyStatus(id)
  }

  private emptyStatus(id: CredentialId): CredentialStatus {
    return {
      id,
      configured: false,
      persistence: null,
      source: null,
      fingerprint: null,
      updatedAt: null,
      encryptionBackend: null,
    }
  }

  private readStoreStrict(): CredentialStoreFile {
    if (!existsSync(this.storePath)) return emptyStore()
    return parseStore(readFileSync(this.storePath, "utf8"))
  }

  private writeStoreAtomic(store: CredentialStoreFile): void {
    mkdirSync(this.storageDir, { recursive: true, mode: 0o700 })
    const tempPath = `${this.storePath}.${randomUUID()}.tmp`
    const backupPath = `${this.storePath}.${randomUUID()}.bak`
    let fd: number | null = null
    let backupMoved = false
    try {
      fd = openSync(tempPath, "wx", 0o600)
      writeFileSync(fd, `${JSON.stringify(store, null, 2)}\n`, "utf8")
      fsyncSync(fd)
      closeSync(fd)
      fd = null
      if (process.platform === "win32" && existsSync(this.storePath)) {
        renameSync(this.storePath, backupPath)
        backupMoved = true
      }
      try {
        renameSync(tempPath, this.storePath)
      } catch (error) {
        if (backupMoved && !existsSync(this.storePath)) renameSync(backupPath, this.storePath)
        backupMoved = false
        throw error
      }
      secureCredentialFile(this.storePath)
      if (backupMoved) {
        unlinkSync(backupPath)
        backupMoved = false
      }
      if (process.platform !== "win32") {
        const dirFd = openSync(this.storageDir, "r")
        try {
          fsyncSync(dirFd)
        } finally {
          closeSync(dirFd)
        }
      }
    } finally {
      if (fd !== null) closeSync(fd)
      if (existsSync(tempPath)) unlinkSync(tempPath)
      // An ACL failure after publication is a failed credential write, not partial success.
      // Restore the previous store so callers never observe data whose Windows ACLs were
      // not proven secure; the original icacls error still propagates to explain the rollback.
      if (backupMoved && existsSync(backupPath)) {
        if (existsSync(this.storePath)) unlinkSync(this.storePath)
        renameSync(backupPath, this.storePath)
        backupMoved = false
      }
      if (existsSync(backupPath)) unlinkSync(backupPath)
    }
  }
}

let defaultCredentialService: CredentialService | null = null

export function getCredentialService(): CredentialService {
  defaultCredentialService ??= new CredentialService()
  return defaultCredentialService
}

export function resetCredentialServiceForTests(): void {
  defaultCredentialService = null
}

export function setCredentialServiceForTests(service: CredentialService): void {
  defaultCredentialService = service
}
