import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("MCP server form recovery surface", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/renderer/components/dialogs/settings-tabs/mcp/mcp-server-form.tsx"),
    "utf8",
  )

  it("keeps project-scoped submission gated on project discovery", () => {
    expect(source).toContain("Project list unavailable:")
    expect(source).toContain("projectsQuery.refetch()")
    expect(source).toContain("projectReadUnavailable")
    expect(source).toContain('role="alert"')
  })
})
