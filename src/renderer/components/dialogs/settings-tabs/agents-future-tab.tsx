import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import { trpc } from "../../../lib/trpc"
import { RefreshCw } from "lucide-react"

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "scaffolded" ? "secondary" : "outline"} className="text-[11px]">
      {status}
    </Badge>
  )
}

export function AgentsFutureTab() {
  const capabilitiesQuery = trpc.futureStages.listCapabilities.useQuery()
  const speechAdaptersQuery = trpc.speech.listAdapters.useQuery()
  const appControlQuery = trpc.appControl.describe.useQuery()
  const capabilities = capabilitiesQuery.data ?? []
  const speechAdapters = speechAdaptersQuery.data
  const appControl = appControlQuery.data
  const readError = capabilitiesQuery.error ?? speechAdaptersQuery.error ?? appControlQuery.error
  const isRefreshing =
    capabilitiesQuery.isFetching || speechAdaptersQuery.isFetching || appControlQuery.isFetching

  const retryReads = async () => {
    await Promise.all([
      capabilitiesQuery.refetch(),
      speechAdaptersQuery.refetch(),
      appControlQuery.refetch(),
    ])
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col space-y-1.5 text-center sm:text-left">
        <h3 className="text-sm font-semibold text-foreground">Future Scaffolds</h3>
        <p className="text-xs text-muted-foreground">
          Typed contracts for later-stage features. Feature execution stays disabled until each
          planning gate is complete.
        </p>
      </div>

      {readError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
        >
          <span>
            Future scaffold data unavailable:{" "}
            {readError instanceof Error ? readError.message : String(readError)}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={isRefreshing}
            onClick={() => void retryReads()}
          >
            <RefreshCw
              className={isRefreshing ? "mr-2 h-3.5 w-3.5 animate-spin" : "mr-2 h-3.5 w-3.5"}
            />
            Retry
          </Button>
        </div>
      )}

      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-medium text-foreground">Stage 2 voice</h4>
              <p className="text-xs text-muted-foreground">
                {speechAdaptersQuery.isLoading
                  ? "Loading adapter registry"
                  : speechAdaptersQuery.error
                    ? "Adapter registry unavailable"
                    : speechAdapters
                      ? `${speechAdapters.stt.length} STT adapters, ${speechAdapters.tts.length} TTS adapters`
                      : "Loading adapter registry"}
              </p>
            </div>
            <StatusBadge status="experimental" />
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-medium text-foreground">App-control MCP scaffold</h4>
              <p className="text-xs text-muted-foreground">
                {appControlQuery.isLoading
                  ? "Loading tool registry"
                  : appControlQuery.error
                    ? "Tool registry unavailable"
                    : appControl
                      ? `${appControl.tools.length} tools registered; transport disabled`
                      : "Loading tool registry"}
              </p>
            </div>
            <StatusBadge status={appControl?.enabled ? "ready" : "scaffolded"} />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">Capability map</h4>
        <div className="bg-background rounded-lg border border-border overflow-hidden">
          {capabilitiesQuery.isLoading ? (
            <p role="status" className="p-4 text-xs text-muted-foreground">
              Loading capability map
            </p>
          ) : capabilitiesQuery.error && !capabilitiesQuery.data ? (
            <p role="alert" className="p-4 text-xs text-destructive">
              Capability map unavailable. Use Retry above to try again.
            </p>
          ) : capabilities.length === 0 ? (
            <p role="status" className="p-4 text-xs text-muted-foreground">
              No future capabilities are registered.
            </p>
          ) : (
            capabilities.map((capability, index) => (
              <div
                key={capability.id}
                className={index === 0 ? "p-4" : "p-4 border-t border-border"}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {capability.title}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{capability.stage}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{capability.summary}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">Gate: {capability.gate}</p>
                  </div>
                  <StatusBadge status={capability.status} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
