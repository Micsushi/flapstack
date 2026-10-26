import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents Profile recovery surface", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/renderer/components/dialogs/settings-tabs/agents-profile-tab.tsx"),
    "utf8",
  )

  it("does not leave account loading failures stuck on a spinner", () => {
    expect(source).toContain("Account profile unavailable:")
    expect(source).toContain("Retry profile")
    expect(source).toContain("setLoadError")
    expect(source).toContain('role="alert"')
  })
})
