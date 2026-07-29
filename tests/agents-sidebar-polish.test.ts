import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync("src/renderer/features/sidebar/agents-sidebar.tsx", "utf8")

describe("agents sidebar polish", () => {
  it("uses one trailing disclosure component across sidebar sections", () => {
    expect(source).toContain("function SidebarDisclosure")
    expect(source.match(/<SidebarDisclosure/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(source).toContain("group-focus-within:opacity-100")
  })

  it("uses less top padding and more bottom padding for chat rows", () => {
    expect(source).toContain("text-left pt-0.5 pb-1.5 cursor-pointer group relative")
    expect(source).not.toContain("text-left py-1 cursor-pointer group relative")
  })
})
