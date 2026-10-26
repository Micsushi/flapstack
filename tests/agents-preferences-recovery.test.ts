import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents Preferences recovery surface", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "src/renderer/components/dialogs/settings-tabs/agents-preferences-tab.tsx",
    ),
    "utf8",
  )

  it("keeps attribution setting failures visible and non-writable", () => {
    expect(source).toContain("Attribution setting unavailable:")
    expect(source).toContain("refetchCoAuthoredBy()")
    expect(source).toContain("Boolean(coAuthoredByError)")
    expect(source).toContain("Loading attribution setting")
    expect(source).toContain('role="alert"')
  })
})
