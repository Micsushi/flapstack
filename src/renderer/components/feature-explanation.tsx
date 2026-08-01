import { CircleHelp } from "lucide-react"
import {
  FEATURE_VISIBILITY_REGISTRY,
  explainFeature,
  type OptionalFeatureId,
} from "../../shared/feature-visibility"
import { Button } from "./ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"

export function FeatureExplanationSummary({ featureId }: { featureId: OptionalFeatureId }) {
  const explanation = explainFeature(featureId)
  return (
    <div className="text-xs leading-5 text-muted-foreground">
      <p>{explanation.purpose}</p>
      <p className="mt-1">{explanation.why}</p>
    </div>
  )
}

export function FeatureHelpPopover({ featureId }: { featureId: OptionalFeatureId }) {
  const feature = FEATURE_VISIBILITY_REGISTRY.find((candidate) => candidate.id === featureId)
  if (!feature) return null
  const explanation = feature.explanation
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs">
          <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
          What is this?
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        forceDark={false}
        className="w-[min(22rem,calc(100vw-2rem))] space-y-3 p-4"
        aria-label={`${feature.label} explanation`}
      >
        <div>
          <p className="text-sm font-semibold">{feature.label}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{explanation.purpose}</p>
        </div>
        <dl className="space-y-2 text-xs leading-5">
          <ExplanationRow label="Why" value={explanation.why} />
          <ExplanationRow label="Requires" value={explanation.prerequisites} />
          <ExplanationRow label="Authority" value={explanation.authority} />
          <ExplanationRow label="Re-enable" value={explanation.reenable} />
        </dl>
      </PopoverContent>
    </Popover>
  )
}

function ExplanationRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-foreground">{label}</dt>
      <dd className="text-muted-foreground">{value}</dd>
    </div>
  )
}
