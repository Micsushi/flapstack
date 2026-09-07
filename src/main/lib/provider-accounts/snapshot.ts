import type Database from "better-sqlite3"
import type { AgentHarness } from "../../../shared/harness-types"
import {
  providerAccountSnapshotSchema,
  type ProviderAccountSnapshot,
} from "../../../shared/provider-account"
import { getCredentialService, type CredentialService } from "../credential-service"

type Row = Record<string, unknown>

const APP_CREDENTIALS = {
  codex: "codex.api-key",
  "claude-code": "claude.custom-api-token",
  openrouter: "openrouter.api-key",
  nanogpt: "nanogpt.api-key",
} as const

export type ProviderAccountSnapshotColumns = {
  providerAccountId: string
  providerAuthMode: ProviderAccountSnapshot["authMode"]
  providerRuntimeTarget: string
  providerCredentialRevision: string
}

export function resolveProviderAccountSnapshot(
  database: Database.Database,
  harness: AgentHarness | string,
  credentialStatus: () => Pick<CredentialService, "status"> = getCredentialService,
): ProviderAccountSnapshot {
  const credentialId = APP_CREDENTIALS[harness as keyof typeof APP_CREDENTIALS]
  if (credentialId) {
    const status = credentialStatus().status(credentialId)
    if (
      status.configured &&
      (harness !== "claude-code" || (status.metadata?.model && status.metadata.baseUrl))
    ) {
      return providerAccountSnapshotSchema.parse({
        provider: providerForHarness(harness),
        accountId: `app-managed:${credentialId}`,
        authMode: "api-key",
        runtimeTarget: "local",
        credentialRevision: String(status.updatedAt ?? "session"),
      })
    }
  }

  if (harness === "claude-code") {
    const managed = resolveActiveAnthropicAccount(database)
    if (managed) return managed
    if (
      hasTable(database, "claude_code_credentials") &&
      database
        .prepare(
          "SELECT 1 FROM claude_code_credentials WHERE id = 'default' AND length(oauth_token) > 0",
        )
        .get()
    ) {
      return providerAccountSnapshotSchema.parse({
        provider: "anthropic",
        accountId: "legacy-default",
        authMode: "subscription",
        runtimeTarget: "local",
        credentialRevision: "legacy",
      })
    }
  }

  if (harness === "local") {
    return providerAccountSnapshotSchema.parse({
      provider: "local",
      accountId: "local-runtime",
      authMode: "local",
      runtimeTarget: "local",
      credentialRevision: "none",
    })
  }

  return providerAccountSnapshotSchema.parse({
    provider: providerForHarness(harness),
    accountId: "system-default",
    authMode: "system-default",
    runtimeTarget: "local",
    credentialRevision: "system",
  })
}

export function providerAccountSnapshotColumns(
  snapshot: ProviderAccountSnapshot,
): ProviderAccountSnapshotColumns {
  return {
    providerAccountId: snapshot.accountId,
    providerAuthMode: snapshot.authMode,
    providerRuntimeTarget: snapshot.runtimeTarget,
    providerCredentialRevision: snapshot.credentialRevision,
  }
}

export function providerAccountSnapshotFromRow(row: Row): ProviderAccountSnapshot {
  return providerAccountSnapshotSchema.parse({
    provider: providerForHarness(String(row.harness ?? "unknown")),
    accountId: String(row.provider_account_id ?? row.providerAccountId ?? "legacy-system-default"),
    authMode: String(row.provider_auth_mode ?? row.providerAuthMode ?? "legacy"),
    runtimeTarget: String(row.provider_runtime_target ?? row.providerRuntimeTarget ?? "local"),
    credentialRevision: String(
      row.provider_credential_revision ?? row.providerCredentialRevision ?? "legacy",
    ),
  })
}

export function providerAccountSnapshotSqlValues(
  snapshot: ProviderAccountSnapshotColumns,
): readonly unknown[] {
  return [
    snapshot.providerAccountId,
    snapshot.providerAuthMode,
    snapshot.providerRuntimeTarget,
    snapshot.providerCredentialRevision,
  ]
}

function resolveActiveAnthropicAccount(
  database: Database.Database,
): ProviderAccountSnapshot | null {
  if (!hasTable(database, "anthropic_settings") || !hasTable(database, "anthropic_accounts")) {
    return null
  }
  const columns = database.prepare("PRAGMA table_info(anthropic_accounts)").all() as Array<{
    name: string
  }>
  const hasRevision = columns.some((column) => column.name === "credential_revision")
  const hasAuthMode = columns.some((column) => column.name === "auth_mode")
  const hasRuntimeTarget = columns.some((column) => column.name === "runtime_target")
  const row = database
    .prepare(
      `SELECT a.id,
        ${hasAuthMode ? "a.auth_mode" : "'subscription' auth_mode"},
        ${hasRuntimeTarget ? "a.runtime_target" : "'local' runtime_target"},
        ${hasRevision ? "a.credential_revision" : "1 credential_revision"}
       FROM anthropic_settings s
       LEFT JOIN anthropic_accounts a ON a.id = s.active_account_id
       WHERE s.id = 'singleton' AND s.active_account_id IS NOT NULL AND s.active_account_id != ''`,
    )
    .get() as
    | {
        id: string
        auth_mode: string
        runtime_target: string
        credential_revision: number | string
      }
    | undefined
  if (!row) return null
  if (!row.id)
    throw new Error(
      "Selected Claude account is unavailable; reconnect it or select another account",
    )
  return providerAccountSnapshotSchema.parse({
    provider: "anthropic",
    accountId: row.id,
    authMode: row.auth_mode,
    runtimeTarget: row.runtime_target,
    credentialRevision: String(row.credential_revision),
  })
}

function hasTable(database: Database.Database, name: string): boolean {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  )
}

function providerForHarness(harness: string): string {
  if (harness === "codex") return "openai"
  if (harness === "claude-code") return "anthropic"
  if (harness === "cursor-agent") return "cursor"
  return harness
}
