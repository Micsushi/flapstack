import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents coordination engine recovery surface", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "src/renderer/components/dialogs/settings-tabs/agents-coordination-engines-tab.tsx",
    ),
    "utf8",
  )

  it("keeps default and capability reads visible and retryable", () => {
    expect(source).toContain("Coordination engine settings unavailable:")
    expect(source).toContain("defaults.refetch()")
    expect(source).toContain("capabilities.refetch()")
    expect(source).toContain('role="alert"')
    expect(source).toContain("Boolean(defaults.error)")
    expect(source).toContain("Boolean(capabilities.error)")
  })
})
