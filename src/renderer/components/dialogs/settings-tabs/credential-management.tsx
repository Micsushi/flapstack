import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type {
  CredentialId,
  CredentialMetadata,
  CredentialStatus,
} from "../../../../shared/credential-types"
import {
  CREDENTIAL_MIGRATION_STATUS_EVENT,
  clearLegacyCredentialAfterReplacement,
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

function statusLabel(
  status: CredentialStatus,
  externallyConfigured: boolean,
  readUnavailable: boolean,
): string {
  if (readUnavailable) return "Status unavailable"
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
  readUnavailable,
}: {
  definition: ManagedCredentialDefinition
  status: CredentialStatus
  externallyConfigured?: boolean
  onSave: (secret: string, metadata?: CredentialMetadata) => Promise<void>
  onRemove: () => Promise<void>
  pending: boolean
  readUnavailable: boolean
}) {
  const [secret, setSecret] = useState("")
  const [model, setModel] = useState(status.metadata?.model ?? "claude-sonnet-5")
  const [baseUrl, setBaseUrl] = useState(status.metadata?.baseUrl ?? "https://api.anthropic.com")
  const previousMetadata = useRef({ model, baseUrl })
  const busy = useRef(false)
  const draftRevision = useRef(0)
  const secretInput = useRef<HTMLInputElement>(null)
  const [writing, setWriting] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)
  const configured = !readUnavailable && (status.configured || externallyConfigured)

  useEffect(() => {
    if (definition.metadata !== "claude-custom") return
    const previous = previousMetadata.current
    const next = {
      model: status.metadata?.model ?? "claude-sonnet-5",
      baseUrl: status.metadata?.baseUrl ?? "https://api.anthropic.com",
    }
    setModel((current) => (current === previous.model ? next.model : current))
    setBaseUrl((current) => (current === previous.baseUrl ? next.baseUrl : current))
    previousMetadata.current = next
  }, [definition.metadata, status.metadata?.baseUrl, status.metadata?.model])

  const finishWrite = () => {
    busy.current = false
    setWriting(false)
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) secretInput.current?.focus()
    })
  }

  const save = async () => {
    if (busy.current || pending || readUnavailable || !secret.trim()) return
    if (
      configured &&
      !window.confirm(`Replace the ${definition.label}? The prior value cannot be recovered.`)
    )
      return
    busy.current = true
    setWriting(true)
    setWriteError(null)
    const submittedRevision = draftRevision.current
    try {
      await onSave(
        secret,
        definition.metadata === "claude-custom"
          ? { model: model.trim(), baseUrl: baseUrl.trim() }
          : undefined,
      )
      if (draftRevision.current === submittedRevision) setSecret("")
    } catch (error) {
      setWriteError(errorMessage(error))
    } finally {
      finishWrite()
    }
  }

  const remove = async () => {
    if (busy.current || pending || readUnavailable) return
    if (!window.confirm(`Remove the ${definition.label}? Runs that require it will stop working.`))
      return
    busy.current = true
    setWriting(true)
    setWriteError(null)
    try {
      await onRemove()
    } catch (error) {
      setWriteError(errorMessage(error))
    } finally {
      finishWrite()
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
              {statusLabel(status, externallyConfigured, readUnavailable)}
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
              onChange={(event) => {
                draftRevision.current += 1
                setModel(event.target.value)
              }}
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
              onChange={(event) => {
                draftRevision.current += 1
                setBaseUrl(event.target.value)
              }}
              placeholder="https://api.anthropic.com"
            />
          </div>
        </div>
      )}

      {writeError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400 break-words">
          {writeError}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor={`${targetId(definition.id)}-secret`} className="text-xs">
            {configured ? "New secret" : "Secret"}
          </Label>
          <Input
            id={`${targetId(definition.id)}-secret`}
            ref={secretInput}
            type="password"
            value={secret}
            onChange={(event) => {
              draftRevision.current += 1
              setSecret(event.target.value)
            }}
            placeholder={
              configured
                ? "Enter a replacement; stored values are never shown"
                : definition.placeholder
            }
            autoComplete="new-password"
          />
        </div>
        <Button
          disabled={!secret.trim() || !metadataReady || pending || writing || readUnavailable}
          onClick={() => void save()}
        >
          {configured ? "Replace" : "Save"}
        </Button>
        {status.configured && !readUnavailable && (
          <Button
            variant="outline"
            disabled={pending || writing || readUnavailable}
            onClick={() => void remove()}
          >
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
      {status.retired.length > 0
        ? ` ${status.retired.length} stale legacy source${status.retired.length === 1 ? " was" : "s were"} retired because a newer replacement exists.`
        : status.migrated.length > 0
          ? ` ${status.migrated.length} renderer credential${status.migrated.length === 1 ? " was" : "s were"} moved only after encrypted persistence was acknowledged.`
          : " No legacy renderer credential needed migration."}
    </div>
  )
}

export function CredentialManagement() {
  const utils = trpc.useUtils()
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const statusesQuery = trpc.credentials.listStatuses.useQuery()
  const voiceKeyQuery = trpc.voice.hasOpenAIKey.useQuery()
  const statuses = statusesQuery.data ?? []
  const voiceKey = voiceKeyQuery.data
  const credentialReadError = statusesQuery.error ?? voiceKeyQuery.error
  const credentialReadsUnavailable =
    statusesQuery.isLoading ||
    Boolean(statusesQuery.error) ||
    voiceKeyQuery.isLoading ||
    Boolean(voiceKeyQuery.error)
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
    setRefreshing(true)
    try {
      await Promise.all([
        utils.credentials.listStatuses.invalidate(undefined, undefined, { throwOnError: true }),
        utils.codex.getIntegration.invalidate(undefined, undefined, { throwOnError: true }),
        utils.voice.hasOpenAIKey.invalidate(undefined, undefined, { throwOnError: true }),
        utils.speech.listAdapters.invalidate(undefined, undefined, { throwOnError: true }),
      ])
      setRefreshError(null)
    } catch {
      setRefreshError("Credential change saved, but status could not be refreshed.")
    } finally {
      setRefreshing(false)
    }
  }

  const retryCredentialReads = async () => {
    await Promise.all([statusesQuery.refetch(), voiceKeyQuery.refetch()])
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
    try {
      const nextMigration = clearLegacyCredentialAfterReplacement(
        localStorage,
        sessionStorage,
        definition.id,
      )
      if (nextMigration) setMigration(nextMigration)
    } catch {
      toast.warning("Credential saved, but the legacy credential could not be cleared.")
    }
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
      {credentialReadError && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
          <p className="text-destructive" role="alert">
            Credential status unavailable: {credentialReadError.message}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={statusesQuery.isFetching || voiceKeyQuery.isFetching}
            onClick={() => void retryCredentialReads()}
          >
            Retry status
          </Button>
        </div>
      )}
      {refreshError && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {refreshError}
          </p>
          <Button
            disabled={refreshing}
            onClick={async () => {
              await refresh()
              requestAnimationFrame(() => {
                if (document.activeElement === document.body) {
                  document.getElementById("credential-codex-api-key-secret")?.focus()
                }
              })
            }}
          >
            Retry status
          </Button>
        </div>
      )}
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
            pending={pending || refreshing}
            readUnavailable={credentialReadsUnavailable || Boolean(refreshError)}
            onSave={(secret, metadata) => save(definition, secret, metadata)}
            onRemove={() => remove(definition)}
          />
        )
      })}
    </section>
  )
}
