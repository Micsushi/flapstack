import { createElement } from "react"
import { toast } from "sonner"
import type {
  WorkbenchWindowCreationFailure,
  WorkbenchWindowCreationFailureReason,
  WorkbenchWindowDestination,
} from "../../shared/workbench-window-budget"

export function asWorkbenchWindowCreationFailure(
  value:
    | {
        reason?: string
        destinations?: readonly WorkbenchWindowDestination[]
      }
    | null
    | undefined,
): WorkbenchWindowCreationFailure | null {
  if (value?.reason === "window-limit") {
    return Array.isArray(value.destinations)
      ? { reason: "window-limit", destinations: [...value.destinations] }
      : null
  }
  if (value?.reason === "reservation-expired" || value?.reason === "creation-failed") {
    return { reason: value.reason }
  }
  return null
}

export function describeWorkbenchWindowCreationFailure(
  reason: WorkbenchWindowCreationFailureReason,
): { title: string; description: string; offersDestinations: boolean } {
  if (reason === "window-limit") {
    return {
      title: "Four-window limit reached",
      description: "Focus an available window, or cancel and keep this content here.",
      offersDestinations: true,
    }
  }
  if (reason === "reservation-expired") {
    return {
      title: "Window creation timed out",
      description: "The reserved window slot expired before creation completed. Try again.",
      offersDestinations: false,
    }
  }
  return {
    title: "Window could not be created",
    description: "Flapstack could not construct or attach the new window. Existing work was kept.",
    offersDestinations: false,
  }
}

export function usableWorkbenchWindowDestinations(
  destinations: readonly WorkbenchWindowDestination[] | undefined,
): WorkbenchWindowDestination[] {
  return (destinations ?? []).filter(
    (destination) => destination.state === "available" && destination.actions.includes("focus"),
  )
}

export function showWorkbenchWindowLimitChoice(
  destinations: readonly WorkbenchWindowDestination[] | undefined,
): void {
  const usable = usableWorkbenchWindowDestinations(destinations)
  const feedback = describeWorkbenchWindowCreationFailure("window-limit")
  toast.custom(
    (toastId) =>
      createElement(
        "section",
        {
          "aria-label": "Choose an existing Flapstack window",
          className:
            "w-[360px] rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg",
          role: "dialog",
        },
        createElement("h2", { className: "text-sm font-semibold" }, feedback.title),
        createElement(
          "p",
          { className: "mt-1 text-xs text-muted-foreground" },
          usable.length > 0
            ? "Focus an available window, or cancel and keep this content here."
            : "No existing renderer is currently available. Cancel and retry after recovery.",
        ),
        createElement(
          "div",
          { className: "mt-3 flex flex-wrap gap-2" },
          ...usable.map((destination) =>
            createElement(
              "button",
              {
                className:
                  "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground",
                key: destination.stableId,
                onClick: async () => {
                  const focused = await window.desktopApi?.focusStableWindow(destination.stableId)
                  if (focused === "focused") toast.dismiss(toastId)
                },
                type: "button",
              },
              `Focus ${destination.label}`,
            ),
          ),
          createElement(
            "button",
            {
              className:
                "rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground",
              onClick: () => toast.dismiss(toastId),
              type: "button",
            },
            "Cancel",
          ),
        ),
      ),
    { duration: Infinity },
  )
}

export function showWorkbenchWindowCreationFeedback(failure: WorkbenchWindowCreationFailure): void {
  const feedback = describeWorkbenchWindowCreationFailure(failure.reason)
  if (feedback.offersDestinations) {
    showWorkbenchWindowLimitChoice(
      failure.reason === "window-limit" ? failure.destinations : undefined,
    )
    return
  }
  toast.error(feedback.title, {
    description: feedback.description,
    duration: 8_000,
  })
}
