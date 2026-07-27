const STRONG_SAFE_STORAGE_BACKENDS = new Set([
  "dpapi",
  "keychain",
  "gnome_libsecret",
  "kwallet",
  "kwallet5",
  "kwallet6",
])

export type SafeStorageBackendProvider = {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
}

export type SafeStorageBackendInspection = {
  available: boolean
  backend: string
  warning?: string
}

export function inspectSafeStorageBackend(
  safeStorage: SafeStorageBackendProvider | null | undefined,
  platform: NodeJS.Platform = process.platform,
): SafeStorageBackendInspection {
  try {
    if (!safeStorage?.isEncryptionAvailable()) {
      return unavailable("unavailable")
    }
    const selected = safeStorage.getSelectedStorageBackend?.().trim().toLowerCase()
    const backend =
      selected || (platform === "darwin" ? "keychain" : platform === "win32" ? "dpapi" : "unknown")
    if (!STRONG_SAFE_STORAGE_BACKENDS.has(backend)) {
      return unavailable(backend)
    }
    return { available: true, backend }
  } catch {
    return unavailable("unknown")
  }
}

function unavailable(backend: string): SafeStorageBackendInspection {
  return {
    available: false,
    backend,
    warning:
      backend === "unavailable"
        ? "Secure OS credential encryption is unavailable. The credential is session-only."
        : `The OS credential backend (${backend}) is unavailable or not strong enough. The credential is session-only.`,
  }
}
