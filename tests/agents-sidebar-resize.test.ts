import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  DEFAULT_AGENTS_SIDEBAR_WIDTH,
  MAX_AGENTS_SIDEBAR_WIDTH,
  migrateAgentsSidebarWidth,
} from "../src/renderer/features/agents/lib/sidebar-width"

const layoutSource = readFileSync("src/renderer/features/layout/agents-layout.tsx", "utf8")

describe("agents sidebar sizing", () => {
  it("uses the wider polished geometry", () => {
    expect(DEFAULT_AGENTS_SIDEBAR_WIDTH).toBe(272)
    expect(MAX_AGENTS_SIDEBAR_WIDTH).toBe(360)
  })

  it("migrates the legacy default once and preserves custom widths", () => {
    expect(migrateAgentsSidebarWidth(224, false)).toBe(272)
    expect(migrateAgentsSidebarWidth(224, true)).toBe(224)
    expect(migrateAgentsSidebarWidth(248, false)).toBe(248)
  })

  it("does not close when the resize divider is clicked", () => {
    expect(layoutSource).toContain("disableClickToClose={true}")
  })
})
