import type { CredentialId, CredentialMetadata } from "../../shared/credential-types"

type MigrationClient = {
  credentials: {
    migrateLegacy: {
      mutate(input: {
        id: CredentialId
        legacyKey:
          "onboarding:codex-api-key" | "agents:openai-api-key" | "agents:claude-custom-config"
        secret: string
        expectedFingerprint: string
        metadata?: CredentialMetadata
      }): Promise<{
        acknowledged: boolean
        fingerprint: string | null
        retireSource?: boolean
        warning?: string
      }>
    }
  }
}

type LegacyCandidate = {
  id: CredentialId
  legacyKey: LegacyCredentialKey
  secret: string
  metadata?: CredentialMetadata
}

export type CredentialMigrationReport = {
  migrated: string[]
  retired: string[]
  retained: Array<{ key: string; reason: string }>
}

export type CredentialMigrationStatus = CredentialMigrationReport & {
  checkedAt: number
}

export const CREDENTIAL_MIGRATION_STATUS_KEY = "flapstack:credential-migration-status:v1"
export const CREDENTIAL_MIGRATION_STATUS_EVENT = "flapstack:credential-migration-status"
export const LEGACY_CREDENTIAL_KEYS = [
  "onboarding:codex-api-key",
  "agents:openai-api-key",
  "agents:claude-custom-config",
] as const
export type LegacyCredentialKey = (typeof LEGACY_CREDENTIAL_KEYS)[number]

const legacyKeyByCredentialId: Partial<Record<CredentialId, LegacyCredentialKey>> = {
  "codex.api-key": "onboarding:codex-api-key",
  "openai.voice-api-key": "agents:openai-api-key",
  "claude.custom-api-token": "agents:claude-custom-config",
}

export function recordCredentialMigrationStatus(
  storage: Storage,
  report: CredentialMigrationReport,
  now = Date.now,
): CredentialMigrationStatus {
  const status = { ...report, checkedAt: now() }
  storage.setItem(CREDENTIAL_MIGRATION_STATUS_KEY, JSON.stringify(status))
  return status
}

export function readCredentialMigrationStatus(storage: Storage): CredentialMigrationStatus | null {
  try {
    const parsed = JSON.parse(
      storage.getItem(CREDENTIAL_MIGRATION_STATUS_KEY) || "null",
    ) as CredentialMigrationStatus | null
    if (
      !parsed ||
      !Number.isFinite(parsed.checkedAt) ||
      !Array.isArray(parsed.migrated) ||
      !Array.isArray(parsed.retained)
    ) {
      return null
    }
    return { ...parsed, retired: Array.isArray(parsed.retired) ? parsed.retired : [] }
  } catch {
    return null
  }
}

export function discardRetainedLegacyCredential(
  legacyStorage: Storage,
  statusStorage: Storage,
  key: string,
  now = Date.now,
): CredentialMigrationStatus | null {
  if (!LEGACY_CREDENTIAL_KEYS.includes(key as LegacyCredentialKey)) return null
  const status = readCredentialMigrationStatus(statusStorage)
  if (!status?.retained.some((item) => item.key === key)) return null
  legacyStorage.removeItem(key)
  return recordCredentialMigrationStatus(
    statusStorage,
    {
      migrated: status.migrated,
      retired: status.retired,
      retained: status.retained.filter((item) => item.key !== key),
    },
    now,
  )
}

export function clearLegacyCredentialAfterReplacement(
  legacyStorage: Storage,
  statusStorage: Storage,
  id: CredentialId,
  now = Date.now,
): CredentialMigrationStatus | null {
  const key = legacyKeyByCredentialId[id]
  if (!key) return null
  legacyStorage.removeItem(key)
  const status = readCredentialMigrationStatus(statusStorage)
  if (!status) return null
  return recordCredentialMigrationStatus(
    statusStorage,
    {
      migrated: status.migrated,
      retired: status.retired.includes(key) ? status.retired : [...status.retired, key],
      retained: status.retained.filter((item) => item.key !== key),
    },
    now,
  )
}

function decodeStoredValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export function readLegacyCredentialCandidates(storage: Storage): LegacyCandidate[] {
  const candidates: LegacyCandidate[] = []
  const codexRaw = storage.getItem("onboarding:codex-api-key")
  const codex = typeof codexRaw === "string" ? decodeStoredValue(codexRaw) : null
  if (typeof codex === "string" && codex.trim()) {
    candidates.push({
      id: "codex.api-key",
      legacyKey: "onboarding:codex-api-key",
      secret: codex.trim(),
    })
  }

  const voiceRaw = storage.getItem("agents:openai-api-key")
  const voice = typeof voiceRaw === "string" ? decodeStoredValue(voiceRaw) : null
  if (typeof voice === "string" && voice.trim()) {
    candidates.push({
      id: "openai.voice-api-key",
      legacyKey: "agents:openai-api-key",
      secret: voice.trim(),
    })
  }

  const claudeRaw = storage.getItem("agents:claude-custom-config")
  const claude = typeof claudeRaw === "string" ? decodeStoredValue(claudeRaw) : null
  if (claude && typeof claude === "object") {
    const record = claude as Record<string, unknown>
    const secret = typeof record.token === "string" ? record.token.trim() : ""
    const model = typeof record.model === "string" ? record.model.trim() : ""
    const baseUrl = typeof record.baseUrl === "string" ? record.baseUrl.trim() : ""
    if (secret) {
      candidates.push({
        id: "claude.custom-api-token",
        legacyKey: "agents:claude-custom-config",
        secret,
        metadata: {
          ...(model ? { model } : {}),
          ...(baseUrl ? { baseUrl } : {}),
        },
      })
    }
  }
  return candidates
}

async function rendererFingerprint(secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(secret)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12)
}

export async function migrateLegacyCredentials(
  storage: Storage,
  client: MigrationClient,
): Promise<CredentialMigrationReport> {
  const report: CredentialMigrationReport = { migrated: [], retired: [], retained: [] }
  for (const candidate of readLegacyCredentialCandidates(storage)) {
    try {
      const expectedFingerprint = await rendererFingerprint(candidate.secret)
      const result = await client.credentials.migrateLegacy.mutate({
        ...candidate,
        expectedFingerprint,
      })
      if (result.acknowledged && result.fingerprint === expectedFingerprint) {
        storage.removeItem(candidate.legacyKey)
        report.migrated.push(candidate.legacyKey)
      } else if (result.retireSource) {
        storage.removeItem(candidate.legacyKey)
        report.retired.push(candidate.legacyKey)
      } else {
        report.retained.push({
          key: candidate.legacyKey,
          reason:
            result.warning ||
            "Encrypted persistence was not acknowledged. The legacy value was retained for retry.",
        })
      }
    } catch {
      report.retained.push({
        key: candidate.legacyKey,
        reason: "Credential migration failed. The legacy value was retained for retry.",
      })
    }
  }
  return report
}
