import { BETA_FEATURE_REGISTRY } from "../../../../shared/beta-features"
import { trpc } from "../../../lib/trpc"
import { Switch } from "../../ui/switch"

export function AgentsBetaTab() {
  const utils = trpc.useUtils()
  const { data: settings } = trpc.betaFeatures.get.useQuery()
  const update = trpc.betaFeatures.set.useMutation({
    onSuccess: (next) => utils.betaFeatures.get.setData(undefined, next),
  })

  return (
    <div className="space-y-6 p-6" data-settings-id="beta-feature-settings">
      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">Beta Features</h3>
        <p className="text-xs text-muted-foreground">
          Advanced features stay hidden and disabled until you opt in. MCP, Usage, and sub-agents
          are always available.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        {BETA_FEATURE_REGISTRY.map((feature, index) => (
          <div
            key={feature.id}
            className={
              index === 0
                ? "flex items-center justify-between gap-6 p-4"
                : "flex items-center justify-between gap-6 border-t border-border p-4"
            }
            data-settings-id={`beta-feature-${feature.id}`}
          >
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-medium text-foreground">{feature.label}</div>
              <div className="text-xs text-muted-foreground">{feature.description}</div>
            </div>
            <Switch
              checked={settings?.[feature.id] ?? false}
              disabled={update.isPending}
              aria-label={`Enable ${feature.label}`}
              onCheckedChange={(enabled) => update.mutate({ feature: feature.id, enabled })}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
