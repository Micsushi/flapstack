import { WorkspaceTitle } from "../../ui/workspace"
import { BETA_FEATURE_REGISTRY } from "../../../../shared/beta-features"
import { trpc } from "../../../lib/trpc"
import { Switch } from "../../ui/switch"
import { Button } from "../../ui/button"
import { BetaFeatureTutorial } from "../../../features/onboarding/beta-feature-tutorial"

export function AgentsBetaTab() {
  const utils = trpc.useUtils()
  const settings = trpc.betaFeatures.get.useQuery()
  const update = trpc.betaFeatures.set.useMutation({
    onSuccess: (next) => utils.betaFeatures.get.setData(undefined, next),
  })

  return (
    <div
      className="beta-surface mx-auto max-w-3xl space-y-5 p-6"
      data-settings-id="beta-feature-settings"
    >
      <WorkspaceTitle>Beta features</WorkspaceTitle>
      {settings.isLoading && (
        <p role="status" className="text-sm">
          Loading features...
        </p>
      )}
      {(settings.error || update.error) && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          {settings.error?.message || update.error?.message}
          {settings.error && (
            <Button size="sm" variant="outline" onClick={() => void settings.refetch()}>
              Retry
            </Button>
          )}
        </div>
      )}
      <div className="divide-y divide-border">
        {BETA_FEATURE_REGISTRY.map((feature) => (
          <div
            key={feature.id}
            className="flex items-center gap-3 py-3"
            data-settings-id={`beta-feature-${feature.id}`}
          >
            <span className="min-w-0 flex-1 text-sm font-medium">{feature.label}</span>
            <BetaFeatureTutorial feature={feature.id} label={feature.label} />
            <Switch
              checked={settings.data?.[feature.id] ?? false}
              disabled={!settings.data || settings.isError || update.isPending}
              aria-label={`Enable ${feature.label}`}
              onCheckedChange={(enabled) => update.mutate({ feature: feature.id, enabled })}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
