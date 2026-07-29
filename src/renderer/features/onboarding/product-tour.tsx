import { useAtom } from "jotai"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  readProductTourState,
  shouldAutoStartProductTour,
  writeProductTourState,
} from "../../../shared/product-tour"
import { agentsSidebarOpenAtom, desktopViewAtom } from "../agents/atoms"

const PRODUCT_TOUR_START_EVENT = "flapstack:start-product-tour"

const PRODUCT_TOUR_STEPS = [
  {
    selector: '[data-tour="workspace"]',
    title: "Your workspace",
    body: "This is your main work area. Start by choosing a project, then open or create a chat.",
  },
  {
    selector: '[data-tour="sidebar"]',
    title: "Projects and chats",
    body: "Projects, tasks, drafts, and chats stay organized here. Resize this panel when you need more room.",
  },
  {
    selector: '[data-tour="scope"]',
    title: "Choose the scope",
    body: "A chat can be global, attached to a project, or focused on one task.",
  },
  {
    selector: '[data-tour="model"]',
    title: "Choose a model",
    body: "Pick the provider and model for this chat. Existing chats keep their saved model.",
  },
  {
    selector: '[data-tour="prompt"]',
    title: "Describe the work",
    body: "Write what you want changed or investigated. You can also attach files and images.",
  },
  {
    selector: '[data-tour="runtime"]',
    title: "Choose a runtime",
    body: "Automatic uses the best configured runtime. You can select a specific agent runtime here.",
  },
  {
    selector: '[data-tour="mode"]',
    title: "Set the chat mode",
    body: "Write can change code. Plan and Review keep the agent read-only.",
  },
  {
    selector: '[data-tour="settings"]',
    title: "Settings",
    body: "Configure runtimes, providers, permissions, notifications, and rerun this tutorial.",
  },
] as const

export function startProductTour(): void {
  window.dispatchEvent(new Event(PRODUCT_TOUR_START_EVENT))
}

function findAvailableStep(start: number, direction: 1 | -1): number {
  for (let index = start; index >= 0 && index < PRODUCT_TOUR_STEPS.length; index += direction) {
    if (document.querySelector(PRODUCT_TOUR_STEPS[index].selector)) return index
  }
  return -1
}

export function ProductTour() {
  const [, setDesktopView] = useAtom(desktopViewAtom)
  const [, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const [isOpen, setIsOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const nextButtonRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const openTour = useCallback(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDesktopView(null)
    setSidebarOpen(true)
    window.setTimeout(() => {
      const firstStep = findAvailableStep(0, 1)
      if (firstStep < 0) return
      setStepIndex(firstStep)
      setIsOpen(true)
    }, 0)
  }, [setDesktopView, setSidebarOpen])

  const closeTour = useCallback((status: "completed" | "dismissed") => {
    writeProductTourState(localStorage, status)
    setIsOpen(false)
    setTargetRect(null)
    window.setTimeout(() => restoreFocusRef.current?.focus(), 0)
  }, [])

  const goNext = useCallback(() => {
    const nextStep = findAvailableStep(stepIndex + 1, 1)
    if (nextStep < 0) {
      closeTour("completed")
      return
    }
    setStepIndex(nextStep)
  }, [closeTour, stepIndex])

  const goBack = useCallback(() => {
    const previousStep = findAvailableStep(stepIndex - 1, -1)
    if (previousStep >= 0) setStepIndex(previousStep)
  }, [stepIndex])

  useEffect(() => {
    const handleManualStart = () => openTour()
    window.addEventListener(PRODUCT_TOUR_START_EVENT, handleManualStart)

    void window.desktopApi
      ?.isPackaged()
      .then((isPackaged) => {
        if (
          shouldAutoStartProductTour({
            isPackaged,
            state: readProductTourState(localStorage),
          })
        ) {
          openTour()
        }
      })
      .catch(() => undefined)

    return () => window.removeEventListener(PRODUCT_TOUR_START_EVENT, handleManualStart)
  }, [openTour])

  useEffect(() => {
    if (!isOpen) return
    const step = PRODUCT_TOUR_STEPS[stepIndex]
    const target = document.querySelector<HTMLElement>(step.selector)
    if (!target) {
      goNext()
      return
    }

    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" })
    const updateRect = () => setTargetRect(target.getBoundingClientRect())
    const frame = requestAnimationFrame(() => {
      updateRect()
      nextButtonRef.current?.focus()
    })
    window.addEventListener("resize", updateRect)
    window.addEventListener("scroll", updateRect, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", updateRect)
      window.removeEventListener("scroll", updateRect, true)
    }
  }, [goNext, isOpen, stepIndex])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeTour("dismissed")
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        goNext()
      } else if (event.key === "ArrowLeft") {
        event.preventDefault()
        goBack()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [closeTour, goBack, goNext, isOpen])

  if (!isOpen || !targetRect || typeof document === "undefined") return null

  const step = PRODUCT_TOUR_STEPS[stepIndex]
  const panelWidth = Math.min(320, window.innerWidth - 24)
  const panelLeft = Math.max(12, Math.min(targetRect.left, window.innerWidth - panelWidth - 12))
  const fitsBelow = targetRect.bottom + 180 < window.innerHeight
  const panelTop = fitsBelow ? targetRect.bottom + 12 : Math.max(12, targetRect.top - 168)
  const hasPrevious = findAvailableStep(stepIndex - 1, -1) >= 0
  const hasNext = findAvailableStep(stepIndex + 1, 1) >= 0

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70]" aria-hidden="true" />
      <div
        className="pointer-events-none fixed z-[71] rounded-lg border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.58)] transition-[left,top,width,height] duration-150 motion-reduce:transition-none"
        style={{
          left: targetRect.left - 5,
          top: targetRect.top - 5,
          width: targetRect.width + 10,
          height: targetRect.height + 10,
        }}
        aria-hidden="true"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-tour-title"
        className="fixed z-[72] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-2xl"
        style={{ left: panelLeft, top: panelTop, width: panelWidth }}
      >
        <button
          type="button"
          onClick={() => closeTour("dismissed")}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close tutorial"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="pr-7">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {stepIndex + 1} of {PRODUCT_TOUR_STEPS.length}
          </div>
          <h2 id="product-tour-title" className="mt-1 text-sm font-semibold">
            {step.title}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={!hasPrevious}
            className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:invisible"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <button
            ref={nextButtonRef}
            type="button"
            onClick={goNext}
            className="flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            {hasNext ? "Next" : "Done"}
            {hasNext && <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </section>
    </>,
    document.body,
  )
}
