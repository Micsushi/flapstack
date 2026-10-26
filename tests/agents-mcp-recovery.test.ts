import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents MCP recovery surface", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/renderer/components/dialogs/settings-tabs/agents-mcp-tab.tsx"),
    "utf8",
  )

  it("keeps provider discovery failures visible and retryable", () => {
    expect(source).toContain("MCP server discovery unavailable:")
    expect(source).toContain("MCP server list unavailable")
    expect(source).toContain("configError && totalServers === 0")
    expect(source).toContain("handleRefresh()")
    expect(source).toContain('role="alert"')
  })
})
