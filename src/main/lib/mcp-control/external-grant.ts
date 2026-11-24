import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto"
import { readFileSync, realpathSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"
import type { McpCallerIdentity } from "./types"

export const externalPermissionModes = ["read-only", "ask-before-edits", "full-access"] as const
const grantIdSchema = z.string().uuid()
const storedGrant = z.object({
  version: z.literal(1),
  databasePath: z.string(),
  configDir: z.string(),
  permissionMode: z.enum(externalPermissionModes),
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{59}$/),
})

export function externalGrantDirectory(databasePath: string): string {
  const db = realpathSync.native(databasePath)
  // Keep a hard-linked database from being paired with a different directory's grants.
  const info = statSync(db)
  if (!info.isFile() || info.nlink !== 1)
    throw new Error("External MCP requires a regular profile database.")
  return join(dirname(db), "external-mcp-grants")
}

export function externalGrantPath(databasePath: string, grantId: string): string {
  return join(externalGrantDirectory(databasePath), grantIdSchema.parse(grantId) + ".json")
}

function privateCredential(token: string) {
  const match = /^([a-f0-9-]{36})\.([A-Za-z0-9_-]{64})$/.exec(token)
  if (!match || !grantIdSchema.safeParse(match[1]).success)
    throw new Error("Invalid external MCP credential.")
  const key = createPrivateKey({
    key: Buffer.from(match[2]!, "base64url"),
    format: "der",
    type: "pkcs8",
  })
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Invalid external MCP key.")
  return { grantId: match[1]!, key }
}

function loadGrant(databasePath: string, grantId: string) {
  try {
    const grant = storedGrant.parse(
      JSON.parse(readFileSync(externalGrantPath(databasePath, grantId), "utf8")),
    )
    if (grant.databasePath === realpathSync.native(databasePath)) return grant
  } catch {
    // Missing, revoked and malformed grants all fail closed.
  }
  throw new Error("External MCP grant is missing, revoked, or belongs to another profile.")
}

function caller(grantId: string, grant: z.infer<typeof storedGrant>): McpCallerIdentity {
  return {
    callerKind: "external-owner",
    chatId: `external-owner:${grantId}`,
    permissionMode: grant.permissionMode,
    projectId: null,
    taskId: null,
  }
}

export function verifyExternalMcpGrant(
  databasePath: string,
  token: string,
  configDir?: string,
): McpCallerIdentity {
  const { grantId, key } = privateCredential(token)
  const grant = loadGrant(databasePath, grantId)
  const publicKey = createPublicKey(key)
    .export({ format: "der", type: "spki" })
    .toString("base64url")
  if (
    publicKey !== grant.publicKey ||
    (configDir !== undefined && realpathSync.native(configDir) !== grant.configDir)
  )
    throw new Error("External MCP credential does not match the configured grant.")
  return caller(grantId, grant)
}

export function signExternalMcpProof(token: string, payload: string) {
  const { grantId, key } = privateCredential(token)
  return { grantId, signature: sign(null, Buffer.from(payload), key).toString("base64url") }
}

export function verifyExternalMcpProof(
  databasePath: string,
  proof: { grantId: string; signature: string },
  payload: string,
): McpCallerIdentity {
  const grant = loadGrant(databasePath, proof.grantId)
  const publicKey = createPublicKey({
    key: Buffer.from(grant.publicKey, "base64url"),
    format: "der",
    type: "spki",
  })
  if (
    !/^[A-Za-z0-9_-]{86}$/.test(proof.signature) ||
    !verify(null, Buffer.from(payload), publicKey, Buffer.from(proof.signature, "base64url"))
  )
    throw new Error("Invalid external MCP request signature.")
  return caller(proof.grantId, grant)
}
