import { useEffect, useState } from "react"
import { toast } from "sonner"
import type {
  CredentialId,
  CredentialMetadata,
  CredentialStatus,
} from "../../../../shared/credential-types"
import {
  CREDENTIAL_MIGRATION_STATUS_EVENT,
  discardRetainedLegacyCredential,
  readCredentialMigrationStatus,
  type CredentialMigrationStatus,
} from "../../../lib/credential-migration"
import { trpc } from "../../../lib/trpc"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"

export type ManagedCredentialDefinition = {
  id: Extract<CredentialId, "codex.api-key" | "openai.voice-api-key" | "claude.custom-api-token">
  provider: string
  label: string
  placeholder: string
  priority: string
  metadata?: "claude-custom"
}

export const MANAGED_CREDENTIALS: readonly ManagedCredentialDefinition[] = [
  {
    id: "codex.api-key",
    provider: "OpenAI / Codex",
    label: "Codex API key",
    placeholder: "sk-...",
    priority:
      "An app-managed API key is used when configured. Remove it to return to an existing ChatGPT subscription.",
  },
  {
    id: "openai.voice-api-key",
    provider: "OpenAI Voice",
    label: "OpenAI transcription API key",
    placeholder: "sk-...",
    priority:
      "Used only when OpenAI Whisper is selected. Local speech adapters do not use this key.",
  },
  {
    id: "claude.custom-api-token",
    provider: "Anthropic / custom Claude",
    label: "Claude API key or custom endpoint token",
    placeholder: "sk-ant-...",
    priority:
      "Used for API-key or custom-endpoint runs. Claude Code subscription authentication remains separate.",
    metadata: "claude-custom",
  },
] as const

function targetId(id: CredentialId): string {
  return `credential-${id.replaceAll(".", "-")}`
}

function statusLabel(status: CredentialStatus, externallyConfigured: boolean): string {
  if (externallyConfigured) return "Configured outside Flapstack"
  if (status.persistence === "session") return "Session only"
  if (status.persistence === "encrypted") return "Encrypted on this device"
  return "Not configured"
}

function formatUpdatedAt(value: number | null): string | null {
  if (!value) return null
  return new Date(value).toLocaleString()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error"
}

function ManagedCredentialRow({
  definition,
  status,
  externallyConfigured = false,
  onSave,
  onRemove,
  pending,
}: {
  definition: ManagedCredentialDefinition
  status: CredentialStatus
  externallyConfigured?: boolean
  onSave: (secret: string, metadata?: CredentialMetadata) => Promise<void>
  onRemove: () => Promise<void>
  pending: boolean
}) {
  const [secret, setSecret] = useState("")
  const [model, setModel] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const configured = status.configured || externallyConfigured

  useEffect(() => {
    if (definition.metadata !== "claude-custom") return
    setModel(status.metadata?.model ?? "claude-sonnet-5")
    setBaseUrl(status.metadata?.baseUrl ?? "https://api.anthropic.com")
  }, [definition.metadata, status.metadata?.baseUrl, status.metadata?.model])

  const save = async () => {
    if (
      configured &&
      !window.confirm(`Replace the ${definition.label}? The prior value cannot be recovered.`)
    ) {
      return
    }
    try {
      await onSave(
        secret,
        definition.metadata === "claude-custom"
          ? { model: model.trim(), baseUrl: baseUrl.trim() }
          : undefined,
      )
      setSecret("")
    } catch (error) {
      toast.error(`${definition.label} was not saved`, { description: errorMessage(error) })
    }
  }

  const remove = async () => {
    if (
      !window.confirm(`Remove the ${definition.label}? Runs that require it will stop working.`)
    ) {
      return
    }
    try {
      await onRemove()
      setSecret("")
    } catch (error) {
      toast.error(`${definition.label} was not removed`, { description: errorMessage(error) })
    }
  }

  const metadataReady =
    definition.metadata !== "claude-custom" || Boolean(model.trim() && baseUrl.trim())
  const updatedAt = formatUpdatedAt(status.updatedAt)

  return (
    <div
      id={targetId(definition.id)}
      data-settings-id={targetId(definition.id)}
      tabIndex={-1}
      className="space-y-3 rounded-lg border border-border p-4 outline-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{definition.label}</h3>
            <Badge variant={configured ? "secondary" : "outline"}>
              {statusLabel(status, externallyConfigured)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{definition.provider}</p>
        </div>
        {status.fingerprint && (
          <code className="text-xs text-muted-foreground">Fingerprint {status.fingerprint}</code>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{definition.priority}</p>
      {status.persistence === "session" && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          Session only. This credential stays in main-process memory and disappears when this app
          process exits. {status.warning}
        </p>
      )}
      {externallyConfigured && (
        <p className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
          Flapstack can use a credential from the environment or shell, but cannot replace or remove
          that external source. Saving here adds an app-managed credential instead.
        </p>
      )}
      {status.warning && status.persistence !== "session" && (
        <p className="text-xs text-destructive">{status.warning}</p>
      )}
      {(updatedAt || status.encryptionBackend) && (
        <p className="text-xs text-muted-foreground">
          {updatedAt ? `Updated ${updatedAt}` : ""}
          {updatedAt && status.encryptionBackend ? " · " : ""}
          {status.encryptionBackend ? `OS encryption backend: ${status.encryptionBackend}` : ""}
        </p>
      )}

      {definition.metadata === "claude-custom" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${targetId(definition.id)}-model`} className="text-xs">
              Model
            </Label>
            <Input
              id={`${targetId(definition.id)}-model`}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="claude-sonnet-5"
            />
          </div>
          <div>
            <Label htmlFor={`${targetId(definition.id)}-base-url`} className="text-xs">
              Base URL
            </Label>
            <Input
              id={`${targetId(definition.id)}-base-url`}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.anthropic.com"
            />
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor={`${targetId(definition.id)}-secret`} className="text-xs">
            {configured ? "New secret" : "Secret"}
          </Label>
          <Input
            id={`${targetId(definition.id)}-secret`}
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder={
              configured
                ? "Enter a replacement; stored values are never shown"
                : definition.placeholder
            }
            autoComplete="new-password"
          />
        </div>
        <Button disabled={!secret.trim() || !metadataReady || pending} onClick={() => void save()}>
          {configured ? "Replace" : "Save"}
        </Button>
        {status.configured && (
          <Button variant="outline" disabled={pending} onClick={() => void remove()}>
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}

function MigrationAcknowledgement({
  status,
  onDiscard,
}: {
  status: CredentialMigrationStatus | null
  onDiscard: (key: string) => void
}) {
  if (!status) return null
  if (status.retained.length > 0) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
        <p className="font-medium">Legacy credential migration needs attention</p>
        {status.retained.map((item) => (
          <div key={item.key} className="mt-2 flex items-start justify-between gap-3">
            <p className="text-muted-foreground">
              {item.key}: {item.reason}
            </p>
            <Button variant="outline" size="sm" onClick={() => onDiscard(item.key)}>
              Discard legacy value
            </Button>
          </div>
        ))}
        <p className="mt-1 text-muted-foreground">
          Retained values retry automatically. Discard only when you accept losing that legacy
          value; replacement fields above do not read it.
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
      Legacy credential check complete.
      {status.migrated.length > 0
        ? ` ${status.migrated.length} renderer credential${status.migrated.length === 1 ? " was" : "s were"} moved only after encrypted persistence was acknowledged.`
        : " No legacy renderer credential needed migration."}
    </div>
  )
}

export function CredentialManagement() {
  const utils = trpc.useUtils()
  const { data: statuses = [] } = trpc.credentials.listStatuses.useQuery()
  const { data: voiceKey } = trpc.voice.hasOpenAIKey.useQuery()
  const setCredential = trpc.credentials.set.useMutation()
  const removeCredential = trpc.credentials.remove.useMutation()
  const removeCodexApiKey = trpc.codex.removeApiKey.useMutation()
  const setVoiceKey = trpc.voice.setOpenAIKey.useMutation()
  const [migration, setMigration] = useState<CredentialMigrationStatus | null>(() =>
    readCredentialMigrationStatus(sessionStorage),
  )

  useEffect(() => {
    const refresh = () => setMigration(readCredentialMigrationStatus(sessionStorage))
    window.addEventListener(CREDENTIAL_MIGRATION_STATUS_EVENT, refresh)
    return () => window.removeEventListener(CREDENTIAL_MIGRATION_STATUS_EVENT, refresh)
  }, [])

  const refresh = async () => {
    await Promise.all([
      utils.credentials.listStatuses.invalidate(),
      utils.codex.getIntegration.invalidate(),
      utils.voice.hasOpenAIKey.invalidate(),
      utils.speech.listAdapters.invalidate(),
    ])
  }

  const discardLegacy = (key: string) => {
    if (
      !window.confirm(
        `Discard retained legacy credential ${key}? This value cannot be recovered and may not exist in encrypted storage.`,
      )
    ) {
      return
    }
    const next = discardRetainedLegacyCredential(localStorage, sessionStorage, key)
    if (!next) {
      toast.error("Legacy credential was not discarded")
      return
    }
    setMigration(next)
    toast.success("Legacy credential discarded")
  }

  const save = async (
    definition: ManagedCredentialDefinition,
    secret: string,
    metadata?: CredentialMetadata,
  ) => {
    const result =
      definition.id === "openai.voice-api-key"
        ? (await setVoiceKey.mutateAsync({ key: secret.trim() })).status
        : await setCredential.mutateAsync({ id: definition.id, secret: secret.trim(), metadata })
    await refresh()
    if (result.persistence === "session") {
      toast.warning(`${definition.label} is available for this session only`, {
        description: result.warning,
      })
    } else {
      toast.success(`${definition.label} saved`)
    }
  }

  const remove = async (definition: ManagedCredentialDefinition) => {
    if (definition.id === "codex.api-key") await removeCodexApiKey.mutateAsync()
    else if (definition.id === "openai.voice-api-key") {
      await setVoiceKey.mutateAsync({ key: "" })
    } else await removeCredential.mutateAsync({ id: definition.id })
    await refresh()
    toast.success(`${definition.label} removed`)
  }

  const pending =
    setCredential.isPending ||
    removeCredential.isPending ||
    removeCodexApiKey.isPending ||
    setVoiceKey.isPending

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Secure credentials</h2>
        <p className="text-sm text-muted-foreground">
          Secret fields are write-only. Reopening Settings never reads or fills a stored value.
        </p>
      </div>
      <MigrationAcknowledgement status={migration} onDiscard={discardLegacy} />
      {MANAGED_CREDENTIALS.map((definition) => {
        const status =
          statuses.find((candidate) => candidate.id === definition.id) ??
          ({
            id: definition.id,
            configured: false,
            persistence: null,
            source: null,
            fingerprint: null,
            updatedAt: null,
            encryptionBackend: null,
          } satisfies CredentialStatus)
        const externallyConfigured =
          definition.id === "openai.voice-api-key" &&
          voiceKey?.hasKey === true &&
          status.configured === false
        return (
          <ManagedCredentialRow
            key={definition.id}
            definition={definition}
            status={status}
            externallyConfigured={externallyConfigured}
            pending={pending}
            onSave={(secret, metadata) => save(definition, secret, metadata)}
            onRemove={() => remove(definition)}
          />
        )
      })}
    </section>
  )
}
