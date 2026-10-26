import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents projects recovery surface", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "src/renderer/components/dialogs/settings-tabs/agents-project-worktree-tab.tsx",
    ),
    "utf8",
  )

  it("keeps project and detail reads visible and retryable", () => {
    expect(source).toContain("Projects unavailable:")
    expect(source).toContain("Project settings unavailable:")
    expect(source).toContain("Project list unavailable")
    expect(source).toContain("retryDetailReads()")
    expect(source).toContain("configUnavailable")
    expect(source).toContain('role="alert"')
  })
})
