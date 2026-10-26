import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents plugins recovery surface", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/renderer/components/dialogs/settings-tabs/agents-plugins-tab.tsx"),
    "utf8",
  )

  it("keeps plugin and MCP status reads visible and retryable", () => {
    expect(source).toContain("Plugin discovery unavailable:")
    expect(source).toContain("MCP status unavailable:")
    expect(source).toContain("refetch()")
    expect(source).toContain("refetchMcp()")
    expect(source).toContain('role="alert"')
  })
})
