// Stage 2 Track B - usage credential storage (app side).
//
// Provider API keys and the Discord webhook URL are credentials. They are
// encrypted with Electron safeStorage and written to a separate file from the
// non-secret usage settings. On macOS they live in the user Keychain so the
// app and its LaunchAgent daemon can both read them. Values are never logged.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFile, spawn, spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { basename, dirname, join } from "node:path"
import { inspectSafeStorageBackend } from "../safe-storage-backend"

const require = createRequire(import.meta.url)
const secretsFileName = "usage-secrets.json"
const KEYCHAIN_SERVICE = "dev.flapstack.usage"
const WINDOWS_CREDENTIAL_PREFIX = "dev.flapstack.usage"

function sanitizeNamespace(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Keep production credentials stable while isolating Dev/Preview profiles and
 * disposable evidence runs from each other. The daemon receives the resolved
 * namespace through its native service definition. */
export function getUsageCredentialNamespace(): string | null {
  const explicit = process.env.FLAPSTACK_USAGE_SECRET_NAMESPACE
  if (explicit) return sanitizeNamespace(explicit) || null
  try {
    const electron = require("electron") as { app?: { getPath(name: string): string } }
    const profile = electron.app?.getPath("userData")
    if (!profile) return null
    const name = basename(profile)
    if (name === "Flapstack") return null
    return sanitizeNamespace(name) || null
  } catch {
    return null
  }
}

function credentialService(): string {
  const namespace = getUsageCredentialNamespace()
  return namespace ? `${KEYCHAIN_SERVICE}.${namespace}` : KEYCHAIN_SERVICE
}

type SafeStorage = {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
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
  if (clearing && process.platform === "darwin") {
    const keychainCleared = setKeychainSecret(key, null)
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
    throw new Error(
      "macOS login Keychain is locked or denied access. Unlock it in Keychain Access, then retry.",
    )
  }

  if (process.platform === "win32") {
    if (setWindowsCredential(key, clearing ? null : value!)) {
      clearRawSecret(key)
      return
    }
    throw new Error("Unable to store the usage credential in Windows Credential Manager")
  }

  if (process.platform === "linux") {
    if (setLinuxSecret(key, clearing ? null : value!)) {
      clearRawSecret(key)
      return
    }
    throw new Error(
      "Unable to store the usage credential in Secret Service. Install secret-tool and unlock your login keyring.",
    )
  }

  throw new Error("Secure credential storage is unavailable; the credential was not stored")
}

function decodeLegacyRawSecret(stored: string): string | null {
  if (stored.startsWith("plain:")) {
    const plaintext = stored.slice("plain:".length)
    return plaintext && !/[\x00-\x1f\x7f]/.test(plaintext) ? plaintext : null
  }
  if (!stored.startsWith("enc:")) return null

  const safe = getSafeStorage()
  if (!safe || !inspectSafeStorageBackend(safe).available) return null
  try {
    const plaintext = safe.decryptString(Buffer.from(stored.slice("enc:".length), "base64"))
    return plaintext && !/[\x00-\x1f\x7f]/.test(plaintext) ? plaintext : null
  } catch {
    return null
  }
}

function setNativeUsageSecret(key: string, value: string): boolean {
  if (process.platform === "darwin") return setKeychainSecret(key, value)
  if (process.platform === "win32") return setWindowsCredential(key, value)
  if (process.platform === "linux") return setLinuxSecret(key, value)
  return false
}

/** Read a secret by key, decrypting as needed. Returns null when unset. */
export function getUsageSecret(key: string): string | null {
  if (process.platform === "darwin") {
    const keychainValue = getKeychainSecret(key)
    if (keychainValue != null) {
      clearRawSecret(key)
      return keychainValue
    }
  }
  if (process.platform === "win32") {
    const value = getWindowsCredential(key)
    if (value != null) {
      clearRawSecret(key)
      return value
    }
  }
  if (process.platform === "linux") {
    const value = getLinuxSecret(key)
    if (value != null) {
      clearRawSecret(key)
      return value
    }
  }
  const stored = readRaw()[key]
  if (!stored) return null
  const legacyValue = decodeLegacyRawSecret(stored)
  if (legacyValue == null || !setNativeUsageSecret(key, legacyValue)) return null
  clearRawSecret(key)
  return legacyValue
}

/** True when a secret is present (used by settings UI without exposing value). */
export function hasUsageSecret(key: string): boolean {
  return getUsageSecret(key) != null
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
    ["find-generic-password", "-s", credentialService(), "-a", keychainAccount(key), "-w"],
    { encoding: "utf8", windowsHide: true },
  )
  return result.status === 0 ? result.stdout.trim() || null : null
}

function setKeychainSecret(key: string, value: string | null): boolean {
  const account = keychainAccount(key)
  if (value == null || value === "") {
    const result = spawnSync(
      "/usr/bin/security",
      ["delete-generic-password", "-s", credentialService(), "-a", account],
      {
        encoding: "utf8",
        windowsHide: true,
      },
    )
    // macOS `security` exits 44 for errSecItemNotFound. Other failures (for
    // example denied Keychain access) must remain visible to the caller.
    return result.status === 0 || result.status === 44
  }
  const result = spawnSync(
    "/usr/bin/security",
    ["add-generic-password", "-s", credentialService(), "-a", account, "-U", "-w"],
    {
      encoding: "utf8",
      input: `${value}\n${value}\n`,
      timeout: 10_000,
      windowsHide: true,
    },
  )
  return result.status === 0
}

export function getUsageSecretAsync(key: string): Promise<string | null> {
  if (process.platform !== "darwin") return Promise.resolve(getUsageSecret(key))
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-s", credentialService(), "-a", keychainAccount(key), "-w"],
      { encoding: "utf8", timeout: 10_000, windowsHide: true },
      (error, stdout) => {
        const value = error ? null : stdout.trim() || null
        resolve(value ?? getUsageSecret(key))
      },
    )
  })
}

export function setUsageSecretAsync(key: string, value: string | null): Promise<void> {
  if (process.platform !== "darwin") {
    setUsageSecret(key, value)
    return Promise.resolve()
  }
  const account = keychainAccount(key)
  const args = value
    ? ["add-generic-password", "-s", credentialService(), "-a", account, "-U", "-w"]
    : ["delete-generic-password", "-s", credentialService(), "-a", account]
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/security", args, {
      stdio: [value ? "pipe" : "ignore", "ignore", "ignore"],
      timeout: 10_000,
      windowsHide: true,
    })
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (!error) {
        clearRawSecret(key)
        resolve()
        return
      }
      reject(
        new Error(
          "macOS login Keychain is locked or denied access. Unlock it in Keychain Access, then retry.",
        ),
      )
    }
    child.once("error", finish)
    child.once("close", (code) => {
      if (code === 0 || (!value && code === 44)) finish()
      else finish(new Error(`security exited with code ${code ?? "unknown"}`))
    })
    if (value) child.stdin?.end(`${value}\n${value}\n`)
  })
}

function linuxSecretArgs(key: string): string[] {
  return ["service", credentialService(), "account", keychainAccount(key)]
}

function getLinuxSecret(key: string): string | null {
  const result = spawnSync("secret-tool", ["lookup", ...linuxSecretArgs(key)], {
    encoding: "utf8",
    windowsHide: true,
  })
  return result.status === 0 ? result.stdout.replace(/\r?\n$/, "") || null : null
}

function setLinuxSecret(key: string, value: string | null): boolean {
  const args = linuxSecretArgs(key)
  if (value == null || value === "") {
    const result = spawnSync("secret-tool", ["clear", ...args], {
      encoding: "utf8",
      windowsHide: true,
    })
    return result.status === 0 || result.status === 1
  }
  const result = spawnSync(
    "secret-tool",
    ["store", "--label=Flapstack usage credential", ...args],
    { encoding: "utf8", input: value, windowsHide: true },
  )
  return result.status === 0
}

function windowsCredentialTarget(key: string): string {
  const namespace = getUsageCredentialNamespace()
  return `${WINDOWS_CREDENTIAL_PREFIX}${namespace ? `.${namespace}` : ""}/${keychainAccount(key)}`
}

function runWindowsCredentialScript(
  operation: "read" | "write" | "delete",
  key: string,
  value = "",
) {
  const script = buildWindowsCredentialScript(
    operation,
    windowsCredentialTarget(key),
    Buffer.from(value, "utf8").toString("base64"),
  )
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  return spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { encoding: "utf8", windowsHide: true },
  )
}

function getWindowsCredential(key: string): string | null {
  const result = runWindowsCredentialScript("read", key)
  if (result.status !== 0) return null
  try {
    return Buffer.from(result.stdout.trim(), "base64").toString("utf8") || null
  } catch {
    return null
  }
}

function setWindowsCredential(key: string, value: string | null): boolean {
  const result = runWindowsCredentialScript(value ? "write" : "delete", key, value ?? "")
  return result.status === 0
}

export function buildWindowsCredentialScript(
  operation: "read" | "write" | "delete",
  target: string,
  valueBase64: string,
): string {
  const operationCode =
    operation === "read"
      ? "$pointer = [IntPtr]::Zero; if (-not [CredNative]::CredRead($target, 1, 0, [ref]$pointer)) { exit 1 }; try { $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][CredNative+CREDENTIAL]); $bytes = New-Object byte[] $credential.CredentialBlobSize; [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length); [Convert]::ToBase64String($bytes) } finally { [CredNative]::CredFree($pointer) }"
      : operation === "delete"
        ? "if (-not [CredNative]::CredDelete($target, 1, 0)) { $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error(); if ($errorCode -ne 1168) { exit 1 } }"
        : "$bytes = [Convert]::FromBase64String($valueBase64); $blob = [Runtime.InteropServices.Marshal]::AllocCoTaskMem($bytes.Length); try { [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length); $credential = New-Object CredNative+CREDENTIAL; $credential.Type = 1; $credential.TargetName = $target; $credential.CredentialBlobSize = $bytes.Length; $credential.CredentialBlob = $blob; $credential.Persist = 2; $credential.UserName = [Environment]::UserName; if (-not [CredNative]::CredWrite([ref]$credential, 0)) { exit 1 } } finally { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($blob) }"
  return `$target = '${target.replace(/'/g, "''")}'
$valueBase64 = '${valueBase64}'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class CredNative {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
    public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
  [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr buffer);
}
'@
${operationCode}
`
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
