import { createHash, randomUUID } from "node:crypto"
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

const require = createRequire(import.meta.url)
const STORE_SCHEMA_VERSION = 1
const STORE_FILE_NAME = "credentials.v1.json"
const WEAK_BACKENDS = new Set(["basic_text", "plaintext", "unknown"])

type StoredCredential = {
  ciphertext: string
  fingerprint: string
  updatedAt: number
  encryptionBackend: string
  metadata?: CredentialMetadata
}

type CredentialStoreFile = {
  schemaVersion: typeof STORE_SCHEMA_VERSION
  credentials: Partial<Record<CredentialId, StoredCredential>>
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
}

function emptyStore(): CredentialStoreFile {
  return { schemaVersion: STORE_SCHEMA_VERSION, credentials: {} }
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
    if (!(CREDENTIAL_IDS as readonly string[]).includes(id) || !isStoredCredential(value)) {
      throw new Error("Invalid credential store entry")
    }
  }
  return parsed as CredentialStoreFile
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
        const safeStorage = electron.safeStorage
        if (!safeStorage?.isEncryptionAvailable()) {
          return {
            available: false,
            backend: "unavailable",
            warning:
              "Secure OS credential encryption is unavailable. The credential is session-only.",
          }
        }
        const backend =
          safeStorage.getSelectedStorageBackend?.() ||
          (process.platform === "darwin"
            ? "keychain"
            : process.platform === "win32"
              ? "dpapi"
              : "os-keyring")
        if (WEAK_BACKENDS.has(backend)) {
          return {
            available: false,
            backend,
            warning: `The OS credential backend (${backend}) is not strong enough. The credential is session-only.`,
          }
        }
        return { available: true, backend }
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
  private readonly sessionCredentials = new Map<CredentialId, SessionCredential>()

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

    if (!inspected.available) {
      return this.setSessionOnly(id, secret, fingerprint, updatedAt, metadata, inspected.warning)
    }

    try {
      const ciphertext = this.encryption.encrypt(secret)
      const verified = this.encryption.decrypt(ciphertext)
      if (verified !== secret) throw new Error("Encrypted credential verification failed")
      const store = this.readStoreStrict()
      store.credentials[id] = {
        ciphertext: ciphertext.toString("base64"),
        fingerprint,
        updatedAt,
        encryptionBackend: inspected.backend,
        ...(metadata ? { metadata } : {}),
      }
      this.writeStoreAtomic(store)
      this.sessionCredentials.delete(id)
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
      const result = this.setSessionOnly(id, secret, fingerprint, updatedAt, metadata, warning)
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

  resolve(id: CredentialId): string | null {
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
      const configured = this.resolve(id) !== null
      return {
        id,
        configured,
        persistence: "encrypted",
        source: "encrypted-store",
        fingerprint: stored.fingerprint,
        updatedAt: stored.updatedAt,
        encryptionBackend: stored.encryptionBackend,
        ...(stored.metadata ? { metadata: stored.metadata } : {}),
        ...(!configured
          ? { warning: "The encrypted credential could not be decrypted. Replace or remove it." }
          : {}),
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

  remove(id: CredentialId): CredentialStatus {
    const store = this.readStoreStrict()
    this.sessionCredentials.delete(id)
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
    let fd: number | null = null
    try {
      fd = openSync(tempPath, "wx", 0o600)
      writeFileSync(fd, `${JSON.stringify(store, null, 2)}\n`, "utf8")
      fsyncSync(fd)
      closeSync(fd)
      fd = null
      renameSync(tempPath, this.storePath)
      chmodSync(this.storePath, 0o600)
      const dirFd = openSync(this.storageDir, "r")
      try {
        fsyncSync(dirFd)
      } finally {
        closeSync(dirFd)
      }
    } finally {
      if (fd !== null) closeSync(fd)
      if (existsSync(tempPath)) unlinkSync(tempPath)
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
