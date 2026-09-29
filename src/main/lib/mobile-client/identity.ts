import { app, safeStorage } from "electron"
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { inspectSafeStorageBackend } from "../safe-storage-backend"
import { secureCredentialFile } from "../credential-service"
import { randomUUID } from "node:crypto"

export const identitySchema = z
  .object({
    endpoint: z.string(),
    fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    label: z.string().min(1).max(120),
    deviceId: z.string().min(1).max(200),
    privateKey: z.string().max(8192),
  })
  .strict()
export type RemoteIdentity = z.infer<typeof identitySchema>
// CredentialService's opaque IDs are explicitly MCP-only. Keep this signing
// identity separate from provider/MCP credential settings and their DTOs.
export class RemoteIdentityStore {
  private path() {
    return join(app.getPath("userData"), "remote-computer-identity.enc")
  }
  load(): RemoteIdentity | null {
    if (!inspectSafeStorageBackend(safeStorage).available || !existsSync(this.path())) return null
    try {
      return identitySchema.parse(JSON.parse(safeStorage.decryptString(readFileSync(this.path()))))
    } catch {
      return null
    }
  }
  save(identity: RemoteIdentity): "encrypted" {
    if (!inspectSafeStorageBackend(safeStorage).available)
      throw new Error(
        "Protected storage is unavailable. Pairing was not saved; retry when OS credential storage is available.",
      )
    const plaintext = JSON.stringify(identitySchema.parse(identity))
    const encrypted = safeStorage.encryptString(plaintext)
    if (safeStorage.decryptString(encrypted) !== plaintext)
      throw new Error("Protected identity verification failed.")
    const temporary = this.path() + `.${randomUUID()}.tmp`
    writeFileSync(temporary, encrypted, { mode: 0o600, flag: "wx" })
    secureCredentialFile(temporary)
    renameSync(temporary, this.path())
    return "encrypted"
  }
}
