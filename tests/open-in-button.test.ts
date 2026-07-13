import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("Open in button", () => {
  it("opts out of Electron title-bar dragging so both controls stay clickable", () => {
    const source = readFileSync("src/renderer/components/open-in-button.tsx", "utf8")

    expect(source).toContain('className="no-drag inline-flex -space-x-px rounded-md"')
  })
})
