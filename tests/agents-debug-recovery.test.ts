import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents debug recovery surface", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/renderer/components/dialogs/settings-tabs/agents-debug-tab.tsx"),
    "utf8",
  )

  it("keeps diagnostic reads visible and retryable", () => {
    expect(source).toContain("Debug information unavailable:")
    expect(source).toContain("Offline simulation state unavailable:")
    expect(source).toContain("refetchSystem()")
    expect(source).toContain("refetchDb()")
    expect(source).toContain("refetchOfflineSimulation()")
    expect(source).toContain('role="alert"')
    expect(source).toContain('unavailable ? "Unavailable"')
  })
})
