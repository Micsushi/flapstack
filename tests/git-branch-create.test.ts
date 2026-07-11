import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import simpleGit from "simple-git"
import { afterEach, describe, expect, it } from "vitest"
import { createBranchAtWorktree } from "../src/main/lib/git/branches"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("create and switch branch", () => {
  it("atomically switches while preserving modified and untracked files", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-branch-"))
    roots.push(root)
    execFileSync("git", ["init", "-b", "main"], { cwd: root })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root })
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: root })
    writeFileSync(join(root, "tracked.txt"), "initial")
    execFileSync("git", ["add", "tracked.txt"], { cwd: root })
    execFileSync("git", ["commit", "-m", "initial"], { cwd: root })
    writeFileSync(join(root, "tracked.txt"), "modified")
    writeFileSync(join(root, "untracked.txt"), "untracked")

    const git = simpleGit(root)
    await createBranchAtWorktree({
      git,
      branchName: "feature/manual-review",
      startPoint: "main",
      switchAfterCreate: true,
    })

    expect((await git.branchLocal()).current).toBe("feature/manual-review")
    expect((await git.status()).files.map((file) => file.path).sort()).toEqual([
      "tracked.txt",
      "untracked.txt",
    ])
  })
})
