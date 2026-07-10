/**
 * API Providers settings tab (Track E — E7 renderer scaffold).
 *
 * OpenRouter + NanoGPT run through the OpenCode sidecar harness engine. This tab
 * manages provider API keys, shows connection + runtime status, and previews how
 * the sidecar resolves. It is intentionally scaffolding-level: it surfaces the
 * honest "runtime not yet enabled" state instead of implying live runs work.
 */

import { useEffect, useState } from "react"
import { useSetAtom } from "jotai"
import { lastSelectedAgentIdAtom } from "../../../features/agents/atoms"
import { trpc } from "../../../lib/trpc"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"

function ProviderCard({ providerId }: { providerId: "openrouter" | "nanogpt" }) {
  const setLastSelectedAgentId = useSetAtom(lastSelectedAgentIdAtom)
  const trpcUtils = trpc.useUtils()
  const { data: providers } = trpc.opencode.listProviders.useQuery()
  const provider = providers?.find((p) => p.id === providerId)
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const { data: modelCatalog } = trpc.opencode.listModels.useQuery({ provider: providerId })

  const setKey = trpc.opencode.setKey.useMutation({
    onSuccess: () => {
      setApiKey("")
      trpcUtils.opencode.listProviders.invalidate()
      trpcUtils.opencode.getKeyStatus.invalidate()
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

  if (!provider) return null

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium">{provider.label}</span>
          {provider.configured ? (
            <Badge variant="secondary">Connected</Badge>
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
        <Button
          size="sm"
          variant="outline"
          disabled={!provider.configured || refreshModels.isPending}
          onClick={() => refreshModels.mutate({ provider: providerId })}
        >
          {refreshModels.isPending ? "Refreshing…" : "Refresh models"}
        </Button>
      </div>
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
        Keys are stored locally with the OS keychain. Saving is blocked if encryption is
        unavailable. No hosted sync.
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
          OpenRouter and NanoGPT run through the OpenCode harness engine.
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
            Engine runtime: {runtime.runtimeEnabled ? "enabled" : "scaffolded (disabled)"}
          </div>
          <div className="mt-1 text-muted-foreground">{runtime.note}</div>
          <div className="mt-1 text-muted-foreground">
            OpenCode binary:{" "}
            {runtime.binary.available
              ? `available (${"kind" in runtime.binary ? runtime.binary.kind : "unknown"})`
              : `missing — ${"reason" in runtime.binary ? runtime.binary.reason : ""}`}
          </div>
        </div>
      )}

      <ProviderCard providerId="openrouter" />
      <ProviderCard providerId="nanogpt" />
    </div>
  )
}
