import { Badge } from "../../ui/badge"
import { trpc } from "../../../lib/trpc"

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "scaffolded" ? "secondary" : "outline"} className="text-[11px]">
      {status}
    </Badge>
  )
}

export function AgentsFutureTab() {
  const { data: capabilities = [] } = trpc.futureStages.listCapabilities.useQuery()
  const { data: speechAdapters } = trpc.speech.listAdapters.useQuery()
  const { data: appControl } = trpc.appControl.describe.useQuery()

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col space-y-1.5 text-center sm:text-left">
        <h3 className="text-sm font-semibold text-foreground">Future Scaffolds</h3>
        <p className="text-xs text-muted-foreground">
          Typed contracts for later-stage features. Feature execution stays disabled until each
          planning gate is complete.
        </p>
      </div>

      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-medium text-foreground">Stage 2 voice</h4>
              <p className="text-xs text-muted-foreground">
                {speechAdapters
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
                {appControl
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
          {capabilities.map((capability, index) => (
            <div key={capability.id} className={index === 0 ? "p-4" : "p-4 border-t border-border"}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{capability.title}</span>
                    <span className="text-[11px] text-muted-foreground">{capability.stage}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{capability.summary}</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Gate: {capability.gate}</p>
                </div>
                <StatusBadge status={capability.status} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
