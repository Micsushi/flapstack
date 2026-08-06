import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { getRepositoryOverview } from "../src/main/lib/git/repository-overview"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("repository overview", () => {
  it("lists branches, checked-out worktrees, unique commits, and dirty counts", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-repo-overview-"))
    const second = `${root}-review`
    roots.push(root, second)
    execFileSync("git", ["init", "-b", "main"], { cwd: root })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root })
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: root })
    writeFileSync(join(root, "tracked.txt"), "initial")
    execFileSync("git", ["add", "tracked.txt"], { cwd: root })
    execFileSync("git", ["commit", "-m", "initial"], { cwd: root })
    execFileSync("git", ["branch", "review"], { cwd: root })
    execFileSync("git", ["update-ref", "refs/remotes/origin/archive", "HEAD"], { cwd: root })
    execFileSync("git", ["worktree", "add", second, "review"], { cwd: root })
    writeFileSync(join(second, "review.txt"), "dirty")

    const overview = await getRepositoryOverview(root)

    expect(overview.defaultBranch).toBe("main")
    expect(overview.worktrees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: root, branch: "main", isMain: true, dirtyCount: 0 }),
        expect.objectContaining({
          path: second,
          branch: "review",
          dirtyCount: 1,
          untrackedCount: 1,
        }),
      ]),
    )
    expect(overview.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "main", checkedOutPath: root, uniqueCommits: 0 }),
        expect.objectContaining({ name: "review", checkedOutPath: second, uniqueCommits: 0 }),
        expect.objectContaining({ name: "origin/archive", kind: "remote", checkedOutPath: null }),
      ]),
    )
  })
})
