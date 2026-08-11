import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync("src/renderer/features/sidebar/agents-sidebar.tsx", "utf8")
const overlayStyles = readFileSync("src/renderer/lib/overlay-styles.ts", "utf8")
const dropdownMenu = readFileSync("src/renderer/components/ui/dropdown-menu.tsx", "utf8")
const contextMenu = readFileSync("src/renderer/components/ui/context-menu.tsx", "utf8")

describe("agents sidebar polish", () => {
  it("keeps disclosure arrows directly after truncating sidebar titles", () => {
    expect(source).toContain("function SidebarDisclosure")
    expect(source.match(/<SidebarDisclosure/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(source.match(/group\/disclosure/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(source).toContain("group-hover/disclosure:opacity-100")
    expect(source).not.toContain("group-focus-within/disclosure:opacity-100")
    expect(source).not.toContain('!isCollapsed && "opacity-100"')
    expect(source).toContain("flex h-5 w-5 flex-shrink-0")
    expect(source).not.toContain("ml-auto mr-10 flex h-5 w-5")
    expect(source).toContain('actions && "pr-12"')
    expect(source).toContain('lifecycleTarget && !isMultiSelectMode && "pr-12"')
    expect(source).toContain('isGlobalSection && !isMultiSelectMode && "pr-7"')
    expect(source).toContain('"min-w-0 truncate whitespace-nowrap"')
  })

  it("aligns project card edges with the Projects divider and keeps internal padding", () => {
    expect(source).toContain("h-7 mt-0.5 mb-0 rounded-md pl-2 pr-1")
    expect(source).not.toContain("h-7 -ml-1.5 mt-0.5")
    expect(source).not.toContain("h-7 mt-0.5 mb-0 rounded-md pl-0.5")
  })

  it("shows user-tagged chats and keeps an empty Global section", () => {
    expect(source).toContain("activeFiltered.filter((chat) => chat.tags.length > 0)")
    expect(source).toContain('title: "Tagged"')
    expect(source).toContain('kind: "tagged" as const')
    expect(source).toContain('title: "Global"')
    expect(source).toContain("showWhenEmpty: true")
    expect(source).toContain("showEmptyState: !searchQuery.trim() && global.length === 0")
    expect(source).toContain('kind === "tagged"')
  })

  it("hides empty built-in Quick access sections except Global", () => {
    expect(source).toContain(
      "section.chats.length > 0 || section.tasks.some((task) => task.chats.length > 0)",
    )
    expect(source).toContain("drafts.length > 0")
    expect(source).toMatch(/section\.tasks\s+\.filter\(\(task\) => task\.chats\.length > 0\)/)
    expect(source).not.toContain("hideWhenEmpty")
    expect(source).not.toContain('data-sidebar-empty-state="quick-access"')
    expect(source).not.toContain("No drafts")
  })

  it("treats Global and promoted projects as Quick Access project rows", () => {
    expect(source).toContain('"flapstack-sidebar-quick-access-projects"')
    expect(source).toContain("visibleQuickAccessProjectSections")
    expect(source).toContain('dropTargetKind="quick-access-project"')
    expect(source).toContain("Move to Quick access")
    expect(source).toContain("Move to Projects")
    expect(source).toContain('isGlobalSection || lifecycleTarget?.type === "project"')
  })

  it("keeps project task creation available outside the Planning beta", () => {
    expect(source).toContain("onCreateProjectTask?.(lifecycleTarget.id)")
    expect(source).not.toContain("planningEnabled && (")
  })

  it("keeps branches and worktrees behind its beta toggle", () => {
    expect(source).toMatch(
      /onOpenRepositoryOverview:\s*betaFeatures\.branchesAndWorktrees\s*\? setRepositoryOverviewProjectId\s*: undefined/,
    )
    expect(source).toContain("onOpenRepositoryOverview && (")
    expect(source).toContain("betaFeatures.branchesAndWorktrees && (")
  })

  it("folds sidebar sections under their headers with reduced-motion support", () => {
    expect(source).toContain("useReducedMotion")
    expect(source).toContain("SidebarCollapsibleContent")
    expect(source).toContain('animate={{ height: "auto", opacity: 1, y: 0 }}')
    expect(source).toContain('className={cn("overflow-hidden", className)}')
    expect(source).toMatch(/shouldReduceMotion\s*\? \{ duration: 0 \}/)
    expect(source).toContain("PROJECT_CHILD_MOTION_VARIANTS")
    expect(source).toContain('mode="popLayout"')
    expect(source).toContain('layout="position"')
    expect(source).not.toContain('clipPath: "inset(0 0 100% 0 round 6px)"')
    expect(source).not.toContain("animate-in fade-in-0 slide-in-from-top-1 duration-150")
  })

  it("uses halved asymmetric vertical padding for chat rows", () => {
    expect(source).toContain("text-left pt-px pb-[3px] cursor-pointer group relative")
    expect(source).not.toContain("text-left py-1 cursor-pointer group relative")
  })

  it("marks Chats that belong to a saved group", () => {
    expect(source).toContain("isInWorkbenchGroup")
    expect(source).toContain('aria-label="In Chat group"')
    expect(source).toContain("<PanelsTopLeft")
  })

  it("gives the icon-only Settings action an accessible name", () => {
    const settingsButton = source.slice(
      source.indexOf('data-tour="settings"'),
      source.indexOf("<SettingsIcon", source.indexOf('data-tour="settings"')),
    )
    expect(settingsButton).toContain('aria-label="Settings"')
  })

  it("uses text-only action menus while preserving submenu chevrons", () => {
    expect(overlayStyles).toContain("[&_svg:not([data-menu-chevron])]:hidden")
    expect(dropdownMenu).toContain("data-menu-chevron")
    expect(contextMenu).toContain("data-menu-chevron")
  })

  it("groups chat lifecycle actions before utility and submenu sections", () => {
    const dropdownStart = source.indexOf('<DropdownMenuContent align="end" className="w-48"')
    const dropdownEnd = source.indexOf("</DropdownMenuContent>", dropdownStart)
    const dropdownActions = source.slice(dropdownStart, dropdownEnd)

    expect(dropdownActions).toContain('{isPinned ? "Unpin chat" : "Pin chat"}')
    expect(dropdownActions).toContain("disabled={archivePending}")
    expect(dropdownActions.indexOf('"Pin chat"')).toBeLessThan(
      dropdownActions.indexOf("Rename chat"),
    )
    expect(dropdownActions.indexOf("Rename chat")).toBeLessThan(
      dropdownActions.indexOf("Archive chat"),
    )
    expect(dropdownActions.indexOf("Open in new window")).toBeLessThan(
      dropdownActions.indexOf("Move to..."),
    )
    expect(dropdownActions.indexOf("Move to...")).toBeLessThan(
      dropdownActions.indexOf("Export chat"),
    )

    const contextStart = source.indexOf('<ContextMenuContent className="w-48">')
    const contextEnd = source.indexOf("</ContextMenuContent>", contextStart)
    const contextActions = source.slice(contextStart, contextEnd)

    expect(contextActions).toContain('{isPinned ? "Unpin chat" : "Pin chat"}')
    expect(contextActions).toContain("disabled={archivePending}")
    expect(contextActions.indexOf('"Pin chat"')).toBeLessThan(contextActions.indexOf("Rename chat"))
    expect(contextActions.indexOf("Rename chat")).toBeLessThan(
      contextActions.indexOf("Archive chat"),
    )
    expect(contextActions.indexOf("Open in new window")).toBeLessThan(
      contextActions.indexOf("Move to..."),
    )
    expect(contextActions.indexOf("Move to...")).toBeLessThan(contextActions.indexOf("Export chat"))
  })
})
