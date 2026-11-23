import { useRef, useState } from "react"
import { BETA_TUTORIALS } from "../../../shared/beta-tutorials"
import type { BetaFeatureId } from "../../../shared/beta-features"
import { Button } from "../../components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog"

export function BetaFeatureTutorial({ feature, label }: { feature: BetaFeatureId; label: string }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const nextButton = useRef<HTMLButtonElement>(null)
  const steps = BETA_TUTORIALS[feature]
  const current = steps[step]

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setStep(0)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="mt-3" aria-label={`${label} tutorial`}>
          Tutorial
        </Button>
      </DialogTrigger>
      <DialogContent
        className="w-[440px] overflow-y-auto"
        aria-describedby="beta-tutorial-description"
      >
        <DialogTitle className="pr-6">{label}</DialogTitle>
        <div aria-live="polite" aria-atomic="true">
          <p className="mb-2 text-xs text-muted-foreground">
            Step {step + 1} of {steps.length}
          </p>
          <h3 className="text-sm font-medium">{current.title}</h3>
          <DialogDescription id="beta-tutorial-description" className="mt-2 text-sm leading-6">
            {current.body}
          </DialogDescription>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            disabled={step === 0}
            onClick={() => {
              if (step === 1) nextButton.current?.focus()
              setStep(step - 1)
            }}
          >
            Back
          </Button>
          <Button
            ref={nextButton}
            onClick={() => (step === steps.length - 1 ? setOpen(false) : setStep(step + 1))}
          >
            {step === steps.length - 1 ? "Done" : "Next"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
