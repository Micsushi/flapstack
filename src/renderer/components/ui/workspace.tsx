import { forwardRef, type ComponentProps } from "react"
import { cn } from "../../lib/utils"

/** Shared page structure; feature-specific content and scrolling stay with callers. */
export function WorkspacePage({ className, ...props }: ComponentProps<"main">) {
  return <main className={cn("beta-surface h-full min-w-0 bg-background", className)} {...props} />
}

export function WorkspaceHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      className={cn("flex shrink-0 flex-wrap items-center justify-between gap-3", className)}
      {...props}
    />
  )
}

export function WorkspaceTitle({ className, ...props }: ComponentProps<"h1">) {
  return <h1 className={cn("workspace-title", className)} {...props} />
}

export function WorkspaceContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto max-w-5xl px-4 py-5 md:px-6", className)} {...props} />
}

/** A whole-row action, distinct from a toolbar button. Native props preserve list navigation. */
export const WorkspaceRow = forwardRef<HTMLButtonElement, ComponentProps<"button">>(
  ({ className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "group w-full min-w-0 rounded-lg text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  ),
)
WorkspaceRow.displayName = "WorkspaceRow"
