import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents worktrees recovery surface", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "src/renderer/components/dialogs/settings-tabs/agents-worktrees-tab.tsx",
    ),
    "utf8",
  )

  it("keeps project and configuration reads visible and retryable", () => {
    expect(source).toContain("Worktree projects unavailable:")
    expect(source).toContain("Worktree configuration unavailable:")
    expect(source).toContain("refetchProjects()")
    expect(source).toContain("refetchConfig()")
    expect(source).toContain("Boolean(configError)")
    expect(source).toContain('role="alert"')
  })
})
