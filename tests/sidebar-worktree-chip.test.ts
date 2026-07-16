import { describe, expect, it } from "vitest"
import { getNonMainWorktreeLabel } from "../src/renderer/features/sidebar/worktree-chip"

describe("sidebar worktree chip", () => {
  it("hides the chip for the Project main checkout", () => {
    expect(
      getNonMainWorktreeLabel({
        projectPath: "/repos/flapstack",
        worktreePath: "/repos/flapstack/",
      }),
    ).toBeNull()
  })

  it("shows the worktree folder name for every non-main checkout", () => {
    expect(
      getNonMainWorktreeLabel({
        projectPath: "/repos/flapstack",
        worktreePath: "/worktrees/flapstack-fix-sidebar",
      }),
    ).toBe("flapstack-fix-sidebar")
    expect(
      getNonMainWorktreeLabel({
        projectPath: String.raw`C:\repos\flapstack`,
        worktreePath: String.raw`C:\worktrees\sidebar-fix`,
      }),
    ).toBe("sidebar-fix")
  })

  it("does not invent a chip without both Project and Chat checkout paths", () => {
    expect(
      getNonMainWorktreeLabel({ projectPath: null, worktreePath: "/worktrees/one" }),
    ).toBeNull()
    expect(getNonMainWorktreeLabel({ projectPath: "/repos/one", worktreePath: null })).toBeNull()
  })
})
