import { inspectSafeStorageBackend } from "./safe-storage-backend"

const CHROMIUM_ENCRYPTED_PREFIXES = ["v10", "v11"]

export type ClaudeCredentialSafeStorage = {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

function decodeCanonicalBase64(encoded: string): Buffer {
  const normalized = encoded.trim()
  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)
  ) {
    throw new Error("Claude credential is not canonical base64")
  }
  const decoded = Buffer.from(normalized, "base64")
  if (decoded.toString("base64") !== normalized) {
    throw new Error("Claude credential is not canonical base64")
  }
  return decoded
}

export function decodePlaintextClaudeToken(encoded: string): string {
  const decoded = decodeCanonicalBase64(encoded)
  const prefix = decoded.subarray(0, 3).toString("ascii")

  if (CHROMIUM_ENCRYPTED_PREFIXES.includes(prefix)) {
    throw new Error("Claude credential is encrypted but secure storage is unavailable")
  }

  const token = decoded.toString("utf8")
  if (
    !/^sk-ant-[A-Za-z0-9._-]+$/.test(token) ||
    /[\x00-\x20\x7f]/.test(token) ||
    Buffer.from(token, "utf8").compare(decoded) !== 0
  ) {
    throw new Error("Claude credential is not a recognized legacy plaintext token")
  }

  return token
}

export function encryptClaudeCredential(
  token: string,
  safeStorage: ClaudeCredentialSafeStorage,
): string {
  if (!inspectSafeStorageBackend(safeStorage).available) {
    throw new Error(
      "Secure credential storage is unavailable; the Claude credential was not stored",
    )
  }
  return safeStorage.encryptString(token).toString("base64")
}

/**
 * Read an existing credential and upgrade the old base64-plaintext format.
 *
 * The migration callback must durably replace the legacy row. Its failure is
 * intentionally propagated so plaintext is never returned while it remains
 * stored in the database.
 */
export function decryptClaudeCredential(
  encoded: string,
  safeStorage: ClaudeCredentialSafeStorage,
  migrateLegacy: (encrypted: string) => void,
): string {
  if (!inspectSafeStorageBackend(safeStorage).available) {
    throw new Error("Secure credential storage is unavailable; reconnect Claude to repair it")
  }

  const encrypted = decodeCanonicalBase64(encoded)
  try {
    return safeStorage.decryptString(encrypted)
  } catch {
    const legacyToken = decodePlaintextClaudeToken(encoded)
    const migrated = safeStorage.encryptString(legacyToken).toString("base64")
    migrateLegacy(migrated)
    return legacyToken
  }
}
