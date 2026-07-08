import { cn } from "../../../lib/utils"

export function SidebarSectionHeader({
  title,
  isMultiSelectMode,
}: {
  title: string
  isMultiSelectMode: boolean
}) {
  return (
    <div className={cn("flex items-center h-4 mb-1", isMultiSelectMode ? "pl-3" : "pl-2")}>
      <h3 className="text-xs font-medium text-muted-foreground whitespace-nowrap">{title}</h3>
    </div>
  )
}

export function SidebarSectionEmptyState({ label }: { label: string }) {
  return <p className="px-2 py-1.5 text-xs text-muted-foreground/60">{label}</p>
}
