/**
 * API Providers settings tab (Track E - E7).
 *
 * OpenRouter + NanoGPT run through Flapstack's provider runtime. This tab
 * manages provider API keys, shows connection + runtime status, and previews how
 * the sidecar resolves. Runs are available when the runtime and provider key are
 * configured.
 */

import { useEffect, useState } from "react"
import { useAtom, useSetAtom } from "jotai"
import { toast } from "sonner"
import {
  enabledOpencodeModelsAtom,
  lastSelectedAgentIdAtom,
  lastSelectedOpencodeModelsAtom,
  pendingAuthRetryMessageAtom,
} from "../../../features/agents/atoms"
import { appStore } from "../../../lib/jotai-store"
import { trpc } from "../../../lib/trpc"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"

function ProviderCard({ providerId }: { providerId: "openrouter" | "nanogpt" }) {
  const setLastSelectedAgentId = useSetAtom(lastSelectedAgentIdAtom)
  const [selectedModels, setSelectedModels] = useAtom(lastSelectedOpencodeModelsAtom)
  const [enabledModels, setEnabledModels] = useAtom(enabledOpencodeModelsAtom)
  const trpcUtils = trpc.useUtils()
  const { data: providers } = trpc.opencode.listProviders.useQuery()
  const provider = providers?.find((p) => p.id === providerId)
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [modelSearch, setModelSearch] = useState("")
  const { data: modelCatalog } = trpc.opencode.listModels.useQuery({ provider: providerId })
  const catalogStats = {
    priced: modelCatalog?.models.filter((model) => model.pricing).length ?? 0,
    tools: modelCatalog?.models.filter((model) => model.supportsTools).length ?? 0,
    reasoning: modelCatalog?.models.filter((model) => model.supportsReasoning).length ?? 0,
  }
  const liveModels = modelCatalog?.source === "seed" ? [] : (modelCatalog?.models ?? [])
  const filteredModels = liveModels.filter((model) => {
    const query = modelSearch.trim().toLowerCase()
    return (
      !query || model.id.toLowerCase().includes(query) || model.label.toLowerCase().includes(query)
    )
  })

  const setKey = trpc.opencode.setKey.useMutation({
    onSuccess: (status) => {
      setApiKey("")
      trpcUtils.opencode.listProviders.invalidate()
      trpcUtils.opencode.getKeyStatus.invalidate()
      if (status.sessionOnly) {
        toast.info(`${provider?.label ?? providerId} key added for this session`)
      }
      const pending = appStore.get(pendingAuthRetryMessageAtom)
      if (pending?.provider === providerId) {
        appStore.set(pendingAuthRetryMessageAtom, { ...pending, readyToRetry: true })
      }
    },
  })
  const clearKey = trpc.opencode.clearKey.useMutation({
    onSuccess: () => {
      trpcUtils.opencode.listProviders.invalidate()
      trpcUtils.opencode.getKeyStatus.invalidate()
    },
  })
  const refreshModels = trpc.opencode.refreshModels.useMutation({
    onSuccess: () => trpcUtils.opencode.listModels.invalidate({ provider: providerId }),
  })

  useEffect(() => {
    if (provider?.baseUrl) setBaseUrl(provider.baseUrl)
  }, [provider?.baseUrl])

  useEffect(() => {
    if (localStorage.getItem("flapstack:api-provider-focus") !== providerId) return
    localStorage.removeItem("flapstack:api-provider-focus")
    window.setTimeout(() => {
      document.getElementById(`${providerId}-provider-card`)?.scrollIntoView({ block: "center" })
      document.getElementById(`${providerId}-key`)?.focus()
    }, 0)
  }, [providerId])

  if (!provider) return null

  return (
    <div id={`${providerId}-provider-card`} className="rounded-lg border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium">{provider.label}</span>
          {provider.configured ? (
            <Badge variant="secondary">
              {provider.sessionOnly ? "Connected for this session" : "Connected"}
            </Badge>
          ) : (
            <Badge variant="outline">Not configured</Badge>
          )}
        </div>
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground underline"
        >
          Docs
        </a>
      </div>

      <p className="mb-2 text-xs text-muted-foreground">
        Base URL: <code>{provider.baseUrl}</code>
      </p>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor={`${providerId}-key`} className="text-xs">
            API key
          </Label>
          <Input
            id={`${providerId}-key`}
            type="password"
            value={apiKey}
            placeholder={provider.configured ? "•••••••• (stored, encrypted)" : "Enter API key"}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <Button
          disabled={!apiKey.trim() || setKey.isPending}
          onClick={() =>
            setKey.mutate({
              provider: providerId,
              apiKey: apiKey.trim(),
              ...(provider.allowsCustomBaseUrl ? { baseUrl: baseUrl.trim() } : {}),
            })
          }
        >
          Save
        </Button>
        {provider.configured && (
          <Button
            variant="outline"
            disabled={clearKey.isPending}
            onClick={() => clearKey.mutate({ provider: providerId })}
          >
            Clear
          </Button>
        )}
      </div>
      {provider.allowsCustomBaseUrl && (
        <div className="mt-3">
          <Label htmlFor={`${providerId}-base-url`} className="text-xs">
            Base URL
          </Label>
          <Input
            id={`${providerId}-base-url`}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://nano-gpt.com/api/v1"
          />
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          Models: {modelCatalog?.models.length ?? 0} ({modelCatalog?.source ?? "loading"})
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!provider.configured || refreshModels.isPending}
            onClick={() => refreshModels.mutate({ provider: providerId })}
          >
            {refreshModels.isPending ? "Refreshing…" : "Refresh models"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!provider.configured}
            onClick={() => {
              setShowModelPicker((open) => !open)
              if (!showModelPicker) refreshModels.mutate({ provider: providerId })
            }}
          >
            Add model
          </Button>
        </div>
      </div>
      {showModelPicker && (
        <div className="mt-3 rounded-md border border-border p-3">
          <Input
            value={modelSearch}
            onChange={(event) => setModelSearch(event.target.value)}
            placeholder={`Search ${provider.label} by name or exact model ID`}
            autoFocus
          />
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {(refreshModels.isPending || modelCatalog?.source === "seed") && (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                Loading current models from {provider.label}…
              </p>
            )}
            {filteredModels.map((model) => {
              const qualifiedId = `${providerId}/${model.id}`
              const selected = selectedModels[providerId] === qualifiedId
              const added = enabledModels[providerId].includes(qualifiedId)
              return (
                <button
                  key={model.id}
                  type="button"
                  className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
                  onClick={() => {
                    if (added) {
                      if (enabledModels[providerId].length <= 1) {
                        toast.error(`${provider.label} needs at least one enabled model`)
                        return
                      }
                      const next = enabledModels[providerId].filter((id) => id !== qualifiedId)
                      setEnabledModels((current) => ({ ...current, [providerId]: next }))
                      if (selected) {
                        setSelectedModels((current) => ({ ...current, [providerId]: next[0]! }))
                      }
                      toast.success(`${model.label} removed from ${provider.label}`)
                      return
                    }
                    setEnabledModels((current) => ({
                      ...current,
                      [providerId]: [...current[providerId], qualifiedId],
                    }))
                    setSelectedModels((current) => ({ ...current, [providerId]: qualifiedId }))
                    setLastSelectedAgentId(providerId)
                    setShowModelPicker(false)
                    setModelSearch("")
                    toast.success(`${model.label} selected for new ${provider.label} chats`)
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{model.label}</span>
                    <code className="block truncate text-xs text-muted-foreground">{model.id}</code>
                  </span>
                  <Badge variant={added ? "secondary" : "outline"}>
                    {selected ? "Selected" : added ? "Added" : "Add"}
                  </Badge>
                </button>
              )
            })}
            {!refreshModels.isPending &&
              modelCatalog?.source !== "seed" &&
              filteredModels.length === 0 && (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No live provider models match this search.
                </p>
              )}
          </div>
        </div>
      )}
      {modelCatalog && (
        <p className="mt-2 text-xs text-muted-foreground">
          Catalog metadata: {catalogStats.priced} priced · {catalogStats.tools} tool-capable ·{" "}
          {catalogStats.reasoning} reasoning-capable.
        </p>
      )}
      {refreshModels.error && (
        <p className="mt-2 text-xs text-destructive">{refreshModels.error.message}</p>
      )}
      <Button
        className="mt-3"
        size="sm"
        variant="secondary"
        disabled={!provider.configured}
        onClick={() => setLastSelectedAgentId(providerId)}
      >
        Use for new chats
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        Chat keys are stored in an encrypted local file using the operating system's secure
        encryption. If secure encryption is unavailable, the key remains in memory for this app
        session only. No plaintext fallback or hosted sync.
      </p>
    </div>
  )
}

export function AgentsApiProvidersTab() {
  const { data: runtime } = trpc.opencode.runtimeStatus.useQuery()

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">API Providers</h2>
        <p className="text-sm text-muted-foreground">
          Connect OpenRouter and NanoGPT directly with your own API keys.
        </p>
      </div>

      {runtime && (
        <div
          className={
            "rounded-md border p-3 text-xs " +
            (runtime.runtimeEnabled
              ? "border-green-500/30 bg-green-500/10"
              : "border-amber-500/30 bg-amber-500/10")
          }
        >
          <div className="font-medium">
            Engine runtime: {runtime.runtimeEnabled ? "enabled" : "disabled"}
          </div>
          <div className="mt-1 text-muted-foreground">{runtime.note}</div>
          <div className="mt-1 text-muted-foreground">
            Provider runtime:{" "}
            {runtime.binary.available
              ? `available (${"kind" in runtime.binary ? runtime.binary.kind : "unknown"})`
              : `missing - ${"reason" in runtime.binary ? runtime.binary.reason : ""}`}
          </div>
        </div>
      )}

      <ProviderCard providerId="openrouter" />
      <ProviderCard providerId="nanogpt" />
    </div>
  )
}
