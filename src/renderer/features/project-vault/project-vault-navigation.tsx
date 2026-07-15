import { AlertTriangle, Check, Circle, FileText } from "lucide-react"
import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react"

import { cn } from "../../lib/utils"
import { hasVaultEditorChanges, type VaultEditorState } from "./editor-state"

export const SECTION_IDS = ["index", "handoff", "decisions", "context", "tasks", "logs"] as const
export type SectionId = (typeof SECTION_IDS)[number]

export const SECTION_GROUPS: Array<{ label: string; ids: SectionId[] }> = [
  { label: "Foundation", ids: ["index", "handoff"] },
  { label: "Project memory", ids: ["decisions", "context", "tasks"] },
  { label: "Activity", ids: ["logs"] },
]

export function isSectionId(value: string): value is SectionId {
  return SECTION_IDS.includes(value as SectionId)
}

export function SectionTree({
  groups,
  sections,
  selected,
  editors,
  onSelect,
}: {
  groups: typeof SECTION_GROUPS
  sections: Array<{ sectionId: string; title: string; sectionType: string }>
  selected: SectionId | null
  editors: Partial<Record<SectionId, VaultEditorState>>
  onSelect: (id: SectionId) => void
}) {
  const itemRefs = useRef(new Map<SectionId, HTMLButtonElement>())
  const visibleIds = groups.flatMap((group) =>
    group.ids.filter((id) => sections.some((section) => section.sectionId === id)),
  )
  const onTreeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: SectionId) => {
    const index = visibleIds.indexOf(id)
    const targetIndex = getRovingTargetIndex(event.key, index, visibleIds.length)
    if (targetIndex === null) return
    event.preventDefault()
    const targetId = visibleIds[targetIndex]
    if (!targetId) return
    onSelect(targetId)
    itemRefs.current.get(targetId)?.focus()
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-2" role="tree" aria-label="Typed vault sections">
      {groups.map((group) => {
        const groupSections = group.ids
          .map((id) => sections.find((section) => section.sectionId === id))
          .filter(Boolean)
        if (groupSections.length === 0) return null
        return (
          <div key={group.label} role="group" aria-label={group.label} className="mb-3">
            <div
              className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              aria-hidden="true"
            >
              {group.label}
            </div>
            {groupSections.map((section) => {
              const id = section!.sectionId as SectionId
              const editor = editors[id]
              const changed = editor ? hasVaultEditorChanges(editor) : false
              const stateLabel = editor?.conflict
                ? "Conflict"
                : changed
                  ? "Unsaved changes"
                  : "Saved"
              return (
                <button
                  key={id}
                  ref={(node) => {
                    if (node) itemRefs.current.set(id, node)
                    else itemRefs.current.delete(id)
                  }}
                  type="button"
                  role="treeitem"
                  aria-selected={selected === id}
                  tabIndex={selected === id || (!selected && visibleIds[0] === id) ? 0 : -1}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
                    selected === id && "bg-muted",
                  )}
                  onClick={() => onSelect(id)}
                  onKeyDown={(event) => onTreeKeyDown(event, id)}
                >
                  <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{section!.title}</span>
                  <span className="sr-only">{stateLabel}</span>
                  {editor?.conflict ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
                  ) : changed ? (
                    <Circle
                      className="h-2.5 w-2.5 fill-amber-500 text-amber-500"
                      aria-hidden="true"
                    />
                  ) : (
                    <Check className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden="true" />
                  )}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export function SearchResults({
  results,
  loading,
  error,
  onSelect,
  onExit,
}: {
  results: Array<{ sectionId: string; title: string; snippet: string; externallyModified: boolean }>
  loading: boolean
  error?: string
  onSelect: (id: string) => void
  onExit: () => void
}) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const onResultKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "Escape") {
      event.preventDefault()
      onExit()
      return
    }
    const targetIndex = getRovingTargetIndex(event.key, index, results.length)
    if (targetIndex === null) return
    event.preventDefault()
    itemRefs.current[targetIndex]?.focus()
  }

  return (
    <section
      className="min-h-0 flex-1 overflow-auto p-2"
      aria-label="Vault search results"
      aria-busy={loading}
    >
      <div
        className="sr-only"
        role={error ? "alert" : "status"}
        aria-live={error ? "assertive" : "polite"}
      >
        {error
          ? `Search failed: ${error}`
          : loading
            ? "Searching project vault"
            : `${results.length} project vault search result${results.length === 1 ? "" : "s"}`}
      </div>
      {error ? (
        <p className="p-2 text-xs text-red-600">Search unavailable: {error}</p>
      ) : loading && results.length === 0 ? (
        <p className="p-2 text-xs text-muted-foreground">Searching…</p>
      ) : results.length === 0 ? (
        <p className="p-2 text-xs text-muted-foreground">No results in this vault.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {results.map((result, index) => (
            <li key={result.sectionId}>
              <button
                ref={(node) => {
                  itemRefs.current[index] = node
                }}
                type="button"
                data-vault-search-result
                className="mb-1 w-full rounded-md border border-transparent p-2 text-left hover:border-border hover:bg-muted"
                onClick={() => onSelect(result.sectionId)}
                onKeyDown={(event) => onResultKeyDown(event, index)}
              >
                <span className="flex items-center gap-1 text-xs font-medium">
                  {result.title}
                  {result.externallyModified && (
                    <>
                      <span className="sr-only">Changed outside Flapstack</span>
                      <AlertTriangle className="h-3 w-3 text-red-600" aria-hidden="true" />
                    </>
                  )}
                </span>
                <span className="mt-1 line-clamp-3 block text-[11px] text-muted-foreground">
                  {result.snippet}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function getRovingTargetIndex(key: string, index: number, length: number): number | null {
  if (length === 0) return null
  if (key === "ArrowDown") return Math.min(index + 1, length - 1)
  if (key === "ArrowUp") return Math.max(index - 1, 0)
  if (key === "Home") return 0
  if (key === "End") return length - 1
  return null
}
