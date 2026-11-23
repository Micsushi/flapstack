import { BETA_TUTORIALS } from "../../../shared/beta-tutorials"
import type { BetaFeatureId } from "../../../shared/beta-features"
import { Button } from "../../components/ui/button"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../../components/ui/dialog"

export function BetaFeatureTutorial({ feature, label }: { feature: BetaFeatureId; label: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`${label} guide`}>
          Guide
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[85vh] w-[min(480px,90vw)] overflow-y-auto"
        aria-describedby={undefined}
      >
        <DialogTitle className="pr-6">{label}</DialogTitle>
        <ol className="list-decimal space-y-3 pl-5 text-sm">
          {BETA_TUTORIALS[feature].map((step) => (
            <li key={step.title} className="pl-1">
              <h3 className="font-medium">{step.title}</h3>
              <p className="mt-1 leading-5 text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  )
}
