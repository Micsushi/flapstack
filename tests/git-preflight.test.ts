import { describe, expect, it } from "vitest"
import {
  formatGitPreflightSnapshot,
  isRepositoryStateQuestion,
} from "../src/main/lib/harness/git-preflight"

describe("git preflight review target", () => {
  it("seals current-commit reviews to the live checkout HEAD", () => {
    expect(isRepositoryStateQuestion("Review the latest commit")).toBe(true)
    expect(
      formatGitPreflightSnapshot({
        repositoryRoot: "/repo",
        currentBranch: "main",
        headSha: "6c78ce24",
        dirty: false,
        worktrees: [],
      }),
    ).toContain("the review target is exactly 6c78ce24 in\n/repo")
  })
})
