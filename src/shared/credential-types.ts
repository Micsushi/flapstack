export const CREDENTIAL_IDS = [
  "codex.api-key",
  "openai.voice-api-key",
  "claude.custom-api-token",
  "openrouter.api-key",
  "nanogpt.api-key",
] as const

export type CredentialId = (typeof CREDENTIAL_IDS)[number]

export type CredentialMetadata = {
  model?: string
  baseUrl?: string
}

export type CredentialPersistence = "encrypted" | "session"

export type CredentialStatus = {
  id: CredentialId
  configured: boolean
  persistence: CredentialPersistence | null
  fingerprint: string | null
  updatedAt: number | null
  encryptionBackend: string | null
  metadata?: CredentialMetadata
  warning?: string
}

export type CredentialWriteAcknowledgement = CredentialStatus & {
  acknowledged: boolean
}
