import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents custom agents recovery surface", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "src/renderer/components/dialogs/settings-tabs/agents-custom-agents-tab.tsx",
    ),
    "utf8",
  )

  it("keeps agent discovery failures visible and retryable", () => {
    expect(source).toContain("Custom agent discovery unavailable:")
    expect(source).toContain("Agent list unavailable")
    expect(source).toContain("error && agents.length === 0")
    expect(source).toContain("refetch()")
    expect(source).toContain('role="alert"')
  })
})
