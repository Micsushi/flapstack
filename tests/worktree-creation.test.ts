import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../src/main/lib/git/security/path-validation", () => ({
  bindFilesystemRootIdentity: vi.fn(),
}))

import { createWorktree, getDefaultBranch } from "../src/main/lib/git/worktree"

const temporaryDirectories: string[] = []

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function createRepository(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `flapstack-${name}-`))
  temporaryDirectories.push(root)
  const repository = join(root, "repository")
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", repository])
  git(repository, "config", "user.name", "Flapstack Test")
  git(repository, "config", "user.email", "flapstack-test@example.com")
  return repository
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("worktree creation base commits", () => {
  it("rejects a missing requested base instead of silently using HEAD", async () => {
    const repository = createRepository("local-ref")
    const origin = join(repository, "..", "origin.git")
    execFileSync("git", ["init", "--bare", "--quiet", origin])
    git(repository, "remote", "add", "origin", origin)
    writeFileSync(join(repository, "README.md"), "local branch\n")
    git(repository, "add", "README.md")
    git(repository, "commit", "--quiet", "-m", "Local root")
    git(repository, "branch", "-M", "feature/local")
    const worktreePath = join(repository, "..", "local-worktree")

    expect(await getDefaultBranch(repository)).toBe("feature/local")
    await expect(
      createWorktree(repository, "feature/worktree", worktreePath, "origin/main"),
    ).rejects.toThrow("Base branch not found: origin/main")
  })

  it("uses the requested local base branch", async () => {
    const repository = createRepository("local-base")
    writeFileSync(join(repository, "README.md"), "local branch\n")
    git(repository, "add", "README.md")
    git(repository, "commit", "--quiet", "-m", "Local root")
    git(repository, "branch", "-M", "feature/local")
    const sourceCommit = git(repository, "rev-parse", "HEAD")
    const worktreePath = join(repository, "..", "local-worktree")

    const result = await createWorktree(
      repository,
      "feature/worktree",
      worktreePath,
      "feature/local",
    )

    expect(result).toEqual({ commitHash: sourceCommit, bootstrappedEmptyRepository: false })
    expect(git(worktreePath, "rev-parse", "HEAD")).toBe(sourceCommit)
  })

  it("creates an isolated empty root commit when the repository is unborn", async () => {
    const repository = createRepository("unborn")
    const worktreePath = join(repository, "..", "testing")

    const result = await createWorktree(repository, "testing", worktreePath, "origin/main")

    expect(result.bootstrappedEmptyRepository).toBe(true)
    expect(git(worktreePath, "branch", "--show-current")).toBe("testing")
    expect(git(worktreePath, "log", "-1", "--format=%s")).toBe("Initialize worktree")
    expect(() => git(repository, "rev-parse", "--verify", "HEAD")).toThrow()
  })
})
