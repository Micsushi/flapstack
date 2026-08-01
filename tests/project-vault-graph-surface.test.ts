import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("project vault graph surface", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/renderer/features/project-vault/project-vault-graph-panel.tsx"),
    "utf8",
  )

  it("keeps whole/local graph and equivalent list navigation explicit", () => {
    expect(source).toContain('"local"')
    expect(source).toContain('"whole"')
    expect(source).toContain('aria-label="Knowledge graph node list"')
    expect(source).toContain('aria-label="Graph scope"')
  })

  it("exposes type, tag, folder, and link-state filters", () => {
    for (const label of [
      "Filter by note type",
      "Filter by tag",
      "Filter by folder",
      "Filter by link state",
    ]) {
      expect(source).toContain(`aria-label="${label}"`)
    }
  })

  it("provides keyboard-selectable nodes plus zoom, reset, and fit controls", () => {
    expect(source).toContain('role="button"')
    expect(source).toContain("tabIndex={0}")
    expect(source).toContain('aria-label="Zoom in graph"')
    expect(source).toContain('aria-label="Zoom out graph"')
    expect(source).toContain('aria-label="Reset graph zoom"')
    expect(source).toContain('aria-label="Fit selected graph node"')
  })

  it("previews exact graph context provenance before staging it", () => {
    expect(source).toContain("previewGraphContext")
    expect(source).toContain("Preview includes")
    expect(source).toContain("includedBytes")
    expect(source).toContain("estimatedTokens")
  })
})
