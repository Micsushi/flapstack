import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { safeStorage } from "electron"
import { inspectSafeStorageBackend } from "./lib/safe-storage-backend"

export interface AuthUser {
  id: string
  email: string
  name: string | null
  imageUrl: string | null
  username: string | null
}

export interface AuthData {
  token: string
  refreshToken: string
  expiresAt: string
  user: AuthUser
}

/**
 * Storage for desktop authentication tokens
 * Uses Electron's safeStorage API to encrypt sensitive data using OS keychain
 * Fails closed when encryption is unavailable; desktop tokens are never
 * persisted or consumed from plaintext storage.
 */
export class AuthStore {
  private filePath: string

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, "auth.dat") // .dat for encrypted data
  }

  /**
   * Check if encryption is available on this system
   */
  private isEncryptionAvailable(): boolean {
    return inspectSafeStorageBackend(safeStorage).available
  }

  /**
   * Save authentication data using the OS credential backend.
   */
  save(data: AuthData): void {
    try {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      const jsonData = JSON.stringify(data)

      if (this.isEncryptionAvailable()) {
        // Encrypt using OS keychain (macOS Keychain, Windows DPAPI, Linux Secret Service)
        const encrypted = safeStorage.encryptString(jsonData)
        writeFileSync(this.filePath, encrypted)
      } else {
        throw new Error("Secure OS encryption is unavailable; authentication data was not saved")
      }
    } catch (error) {
      console.error("Failed to save auth data:", error)
      throw error
    }
  }

  /**
   * Load authentication data (decrypts if encrypted)
   */
  load(): AuthData | null {
    try {
      // Try encrypted file first
      if (existsSync(this.filePath) && this.isEncryptionAvailable()) {
        const encrypted = readFileSync(this.filePath)
        const decrypted = safeStorage.decryptString(encrypted)
        const data = JSON.parse(decrypted) as AuthData
        this.removeLegacyPlaintextFiles()
        return data
      }

      // Fallback: try unencrypted file (for migration or when encryption unavailable)
      const fallbackPath = this.filePath + ".json"
      if (existsSync(fallbackPath)) {
        if (!this.isEncryptionAvailable()) {
          console.warn(
            "Legacy plaintext authentication data is present but secure OS encryption is unavailable",
          )
          return null
        }
        const content = readFileSync(fallbackPath, "utf-8")
        const data = JSON.parse(content)

        this.save(data)
        this.removeLegacyPlaintextFiles()

        return data
      }

      // Legacy: check for old auth.json file and migrate
      const legacyPath = join(dirname(this.filePath), "auth.json")
      if (existsSync(legacyPath)) {
        if (!this.isEncryptionAvailable()) {
          console.warn(
            "Legacy plaintext authentication data is present but secure OS encryption is unavailable",
          )
          return null
        }
        const content = readFileSync(legacyPath, "utf-8")
        const data = JSON.parse(content)

        // Migrate to encrypted storage
        this.save(data)
        this.removeLegacyPlaintextFiles()
        console.log("Migrated auth data from plaintext to encrypted storage")

        return data
      }

      return null
    } catch (error) {
      console.error("Failed to load auth data:", error)
      return null
    }
  }

  private removeLegacyPlaintextFiles(): void {
    const failures: Error[] = []
    for (const credentialPath of [
      this.filePath + ".json",
      join(dirname(this.filePath), "auth.json"),
    ]) {
      try {
        this.removeCredentialFile(credentialPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue
        failures.push(
          new Error(`Could not remove legacy plaintext credential file ${credentialPath}`, {
            cause: error,
          }),
        )
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Encrypted authentication data is available, but legacy plaintext cleanup failed",
      )
    }
  }

  /**
   * Clear all stored authentication data (both encrypted and fallback files)
   */
  clear(): void {
    const paths = [
      this.filePath,
      this.filePath + ".json",
      join(dirname(this.filePath), "auth.json"),
    ]
    const failures: Error[] = []
    for (const credentialPath of paths) {
      try {
        this.removeCredentialFile(credentialPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue
        failures.push(
          new Error(`Could not remove ${credentialPath}`, {
            cause: error,
          }),
        )
      }
    }
    if (failures.length > 0) {
      const error = new AggregateError(failures, "Failed to clear all stored authentication data")
      console.error("Failed to clear auth data:", error)
      throw error
    }
  }

  protected removeCredentialFile(credentialPath: string): void {
    unlinkSync(credentialPath)
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    const data = this.load()
    if (!data) return false

    // Check if token is expired
    const expiresAt = new Date(data.expiresAt).getTime()
    return expiresAt > Date.now()
  }

  /**
   * Get current user if authenticated
   */
  getUser(): AuthUser | null {
    const data = this.load()
    return data?.user ?? null
  }

  /**
   * Get current token if valid
   */
  getToken(): string | null {
    const data = this.load()
    if (!data) return null

    const expiresAt = new Date(data.expiresAt).getTime()
    if (expiresAt <= Date.now()) return null

    return data.token
  }

  /**
   * Get refresh token
   */
  getRefreshToken(): string | null {
    const data = this.load()
    return data?.refreshToken ?? null
  }

  /**
   * Check if token needs refresh (expires in less than 5 minutes)
   */
  needsRefresh(): boolean {
    const data = this.load()
    if (!data) return false

    const expiresAt = new Date(data.expiresAt).getTime()
    const fiveMinutes = 5 * 60 * 1000
    return expiresAt - Date.now() < fiveMinutes
  }

  /**
   * Update user data (e.g., after profile update)
   */
  updateUser(updates: Partial<AuthUser>): AuthUser | null {
    const data = this.load()
    if (!data) return null

    data.user = { ...data.user, ...updates }
    this.save(data)
    return data.user
  }
}
