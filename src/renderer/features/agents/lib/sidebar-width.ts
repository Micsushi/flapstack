export const LEGACY_AGENTS_SIDEBAR_WIDTH = 224
export const DEFAULT_AGENTS_SIDEBAR_WIDTH = 272
export const MAX_AGENTS_SIDEBAR_WIDTH = 360
export const AGENTS_SIDEBAR_WIDTH_MIGRATION_KEY = "agents-sidebar-width:v2"

export function migrateAgentsSidebarWidth(width: number, migrationApplied: boolean): number {
  if (!migrationApplied && width === LEGACY_AGENTS_SIDEBAR_WIDTH) {
    return DEFAULT_AGENTS_SIDEBAR_WIDTH
  }
  return width
}
