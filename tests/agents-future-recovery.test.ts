import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents Future Scaffolds recovery surface", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/renderer/components/dialogs/settings-tabs/agents-future-tab.tsx"),
    "utf8",
  )

  it("keeps registry failures visible and retryable", () => {
    expect(source).toContain("Future scaffold data unavailable:")
    expect(source).toContain("retryReads()")
    expect(source).toContain("Capability map unavailable.")
    expect(source).toContain("speechAdaptersQuery.error")
    expect(source).toContain("appControlQuery.error")
    expect(source).toContain('role="alert"')
  })
})
