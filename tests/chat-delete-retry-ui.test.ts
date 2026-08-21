import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("archived chat deletion retry feedback", () => {
  it.each([
    "src/renderer/features/agents/ui/archive-popover.tsx",
    "src/renderer/features/sidebar/agents-sidebar.tsx",
  ])("warns about partial cleanup failures in %s", (filePath) => {
    const source = readFileSync(filePath, "utf8")
    expect(source).toContain("failedChatIds.length > 0")
    expect(source).toContain("remain available to retry")
  })
})
