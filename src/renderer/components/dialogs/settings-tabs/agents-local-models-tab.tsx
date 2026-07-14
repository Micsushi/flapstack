import { useAtom } from "jotai"
import { AlertTriangle, Check, HardDrive, RefreshCw, ShieldCheck, X } from "lucide-react"
import { useMemo, useReducer, useState } from "react"
import {
  DEFAULT_OLLAMA_BASE_URL,
  type LocalModelCapabilityName,
  type LocalModelCapabilityState,
  type LocalModelToolTier,
} from "../../../../shared/local-model-contract"
import type { RunPermissionMode } from "../../../../shared/harness-types"
import { localModelEndpointAtom, selectedLocalModelIdAtom } from "../../../lib/atoms"
import { cn } from "../../../lib/utils"
import { trpc } from "../../../lib/trpc"
import { Button } from "../../ui/button"
import {
  buildLocalModelControlPreview,
  createLocalModelUiState,
  localModelCatalogStatus,
  reduceLocalModelUiState,
} from "../../../features/local-models/local-model-ui-state"

const capabilityLabels: Record<LocalModelCapabilityName, string> = {
  chat: "Chat",
  streaming: "Streaming",
  tools: "Tool calls",
  vision: "Vision",
}

const permissionOptions: Array<{ value: RunPermissionMode; label: string }> = [
  { value: "read-only", label: "Read-only" },
  { value: "ask-before-edits", label: "Ask before edits" },
  { value: "auto-edit-project-only", label: "Auto-edit project only" },
  { value: "full-access", label: "Full access" },
]

const unavailableRuntime = {
  chat: false,
  toolTiers: [] as readonly LocalModelToolTier[],
}

export function AgentsLocalModelsTab() {
  const [persistedEndpoint, setPersistedEndpoint] = useAtom(localModelEndpointAtom)
  const [persistedModelId, setPersistedModelId] = useAtom(selectedLocalModelIdAtom)
  const [state, dispatch] = useReducer(
    reduceLocalModelUiState,
    { endpoint: persistedEndpoint, selectedModelId: persistedModelId },
    createLocalModelUiState,
  )
  const [permissionMode, setPermissionMode] = useState<RunPermissionMode>("read-only")
  const queryEndpoint = state.endpointValidation.valid
    ? state.endpointValidation.endpoint
    : DEFAULT_OLLAMA_BASE_URL
  const catalogQuery = trpc.localModels.catalog.useQuery(
    { endpoint: queryEndpoint },
    { enabled: false, retry: false, refetchOnWindowFocus: false },
  )

  const status = localModelCatalogStatus(state)
  const preview = useMemo(
    () => buildLocalModelControlPreview({ state, permissionMode, runtime: unavailableRuntime }),
    [permissionMode, state],
  )
  const selectedModel = state.catalog?.models.find(
    (entry) => entry.identity.modelId === state.selectedModelId,
  )

  const refresh = async () => {
    dispatch({ type: "refresh-started" })
    if (!state.endpointValidation.valid) return

    const result = await catalogQuery.refetch()
    if (result.data) {
      dispatch({ type: "refresh-succeeded", catalog: result.data })
      return
    }
    dispatch({
      type: "refresh-failed",
      message: result.error?.message ?? "The local model catalog could not be refreshed.",
    })
  }

  const selectModel = (modelId: string) => {
    const value = modelId || null
    dispatch({ type: "model-selected", modelId: value })
    setPersistedModelId(value)
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-green-600 dark:text-green-400" />
          <h3 className="text-sm font-semibold text-foreground">Local models</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Connect a loopback Ollama server, inspect declared capabilities, and preview launch
          permissions. No cloud credential is required.
        </p>
      </div>

      <section
        className="space-y-3 rounded-lg border border-border bg-background p-4"
        data-settings-id="local-model-endpoint"
        tabIndex={-1}
      >
        <div>
          <label htmlFor="local-model-endpoint-input" className="text-sm font-medium">
            Ollama endpoint
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Remote hosts, credentials, paths, query strings, and fragments are rejected.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="local-model-endpoint-input"
            value={state.endpointDraft}
            onChange={(event) => {
              const value = event.target.value
              dispatch({ type: "endpoint-edited", value })
              setPersistedEndpoint(value)
            }}
            spellCheck={false}
            aria-invalid={!state.endpointValidation.valid}
            aria-describedby="local-model-endpoint-help"
            className={cn(
              "h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              state.endpointValidation.valid ? "border-input" : "border-destructive",
            )}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void refresh()}
            disabled={state.phase === "refreshing" || !state.endpointValidation.valid}
          >
            <RefreshCw
              className={cn("mr-2 h-4 w-4", state.phase === "refreshing" && "animate-spin")}
            />
            Refresh catalog
          </Button>
        </div>
        <p
          id="local-model-endpoint-help"
          className={cn(
            "text-xs",
            state.endpointValidation.valid ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {state.endpointValidation.valid
            ? `Validated loopback origin: ${state.endpointValidation.endpoint}`
            : state.endpointValidation.message}
        </p>
      </section>

      <section
        className="space-y-3 rounded-lg border border-border bg-background p-4"
        data-settings-id="local-model-catalog"
        tabIndex={-1}
        aria-live="polite"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-medium">Ollama availability</h4>
            <p className="mt-0.5 text-xs text-muted-foreground">{status.detail}</p>
          </div>
          <StatusBadge tone={status.tone} label={status.label} />
        </div>
        {state.catalog && (
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Version</dt>
              <dd>{state.catalog.provider.version ?? "Unknown"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last checked</dt>
              <dd>{new Date(state.catalog.capturedAt).toLocaleString()}</dd>
            </div>
          </dl>
        )}
        {state.catalog?.state === "empty" && (
          <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            Install a model with Ollama, then refresh. Flapstack does not download or launch a model
            automatically.
          </p>
        )}
        {(state.catalog?.state === "stale" ||
          state.catalog?.state === "unavailable" ||
          state.catalog?.state === "error") && (
          <LimitationList limitations={state.catalog.limitations} />
        )}
      </section>

      <section
        className="space-y-4 rounded-lg border border-border bg-background p-4"
        data-settings-id="local-model-picker"
        tabIndex={-1}
      >
        <div>
          <label htmlFor="local-model-picker-select" className="text-sm font-medium">
            Model picker
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Capabilities come from Ollama metadata. Flapstack does not guess from model names.
          </p>
        </div>
        <select
          id="local-model-picker-select"
          value={state.selectedModelId ?? ""}
          onChange={(event) => selectModel(event.target.value)}
          disabled={!state.catalog || state.catalog.models.length === 0}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
        >
          <option value="">Choose a local model</option>
          {state.catalog?.models.map((model) => (
            <option key={model.identity.modelId} value={model.identity.modelId}>
              {model.identity.modelId}
            </option>
          ))}
        </select>

        {selectedModel ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(capabilityLabels) as LocalModelCapabilityName[]).map((name) => (
                <CapabilityRow
                  key={name}
                  label={capabilityLabels[name]}
                  state={selectedModel.capabilities[name].state}
                  evidence={selectedModel.capabilities[name].evidence}
                />
              ))}
            </div>
            <LimitationList limitations={preview.limitations} />
          </>
        ) : (
          <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            {preview.status}
          </p>
        )}
      </section>

      <section
        className="space-y-4 rounded-lg border border-border bg-background p-4"
        data-settings-id="local-model-permission-preview"
        tabIndex={-1}
      >
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <h4 className="text-sm font-medium">Permission and tool preview</h4>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Preview combines declared model support, the selected permission, and tool runtimes
              actually present in this build.
            </p>
          </div>
        </div>
        <label className="block text-xs font-medium" htmlFor="local-model-permission-select">
          Launch permission
        </label>
        <select
          id="local-model-permission-select"
          value={permissionMode}
          onChange={(event) => setPermissionMode(event.target.value as RunPermissionMode)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {permissionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {preview.toolTiers.length > 0 ? (
          <ul className="space-y-2" aria-label="Local model tool availability">
            {preview.toolTiers.map((tier) => (
              <li
                key={tier.tier}
                className="flex items-start gap-2 rounded-md border p-2.5 text-xs"
              >
                {tier.displayAvailable ? (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                ) : (
                  <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <div>
                  <span className="font-medium capitalize">{tier.tier.replace("-", " ")}</span>
                  <p className="mt-0.5 text-muted-foreground">
                    {tier.displayAvailable ? "Available for this launch." : tier.displayReason}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            Choose a discovered model to preview chat and tool tiers.
          </p>
        )}
      </section>

      <section
        className="rounded-lg border border-green-500/30 bg-green-500/5 p-4"
        data-settings-id="local-model-no-cloud-fallback"
        tabIndex={-1}
      >
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-700 dark:text-green-300" />
          <div>
            <h4 className="text-sm font-medium text-green-800 dark:text-green-200">
              No cloud fallback
            </h4>
            <p className="mt-1 text-xs text-green-800/80 dark:text-green-200/80">
              If Ollama or the selected model is unavailable, the launch stops. Flapstack never
              sends the prompt to a cloud provider as a fallback.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

function StatusBadge({
  tone,
  label,
}: {
  tone: "neutral" | "success" | "warning" | "danger"
  label: string
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone === "success" &&
          "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
        tone === "warning" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "danger" && "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
        tone === "neutral" && "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      {label}
    </span>
  )
}

function CapabilityRow({
  label,
  state,
  evidence,
}: {
  label: string
  state: LocalModelCapabilityState
  evidence: string | null
}) {
  return (
    <div className="rounded-md border p-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <StatusBadge
          label={state}
          tone={state === "supported" ? "success" : state === "unknown" ? "warning" : "neutral"}
        />
      </div>
      <p className="mt-1 text-muted-foreground">Evidence: {evidence ?? "Not declared"}</p>
    </div>
  )
}

function LimitationList({
  limitations,
}: {
  limitations: Array<{ code: string; message: string }>
}) {
  if (limitations.length === 0) return null
  const unique = [
    ...new Map(limitations.map((item) => [`${item.code}:${item.message}`, item])).values(),
  ]
  return (
    <ul className="space-y-2" aria-label="Local model limitations">
      {unique.map((limitation) => (
        <li
          key={`${limitation.code}:${limitation.message}`}
          className="flex items-start gap-2 rounded-md bg-amber-500/5 p-2.5 text-xs"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <div>
            <span className="font-medium">{limitation.code}</span>
            <p className="mt-0.5 text-muted-foreground">{limitation.message}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
