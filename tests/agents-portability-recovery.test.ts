import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents portability recovery surface", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "src/renderer/components/dialogs/settings-tabs/agents-portability-tab.tsx",
    ),
    "utf8",
  )

  it("keeps prerequisite reads visible and gates unknown actions", () => {
    expect(source).toContain("Portability settings unavailable:")
    expect(source).toContain("Private sync state unavailable:")
    expect(source).toContain("retryReads()")
    expect(source).toContain("capabilitiesUnavailable")
    expect(source).toContain("privateSyncUnavailable")
    expect(source).toContain('role="alert"')
  })
})
