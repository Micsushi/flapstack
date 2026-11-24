import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  findProjectByCanonicalPath,
  resolveCanonicalProjectPath,
} from "../src/main/lib/projects/project-path"
// @ts-expect-error JavaScript test helper intentionally has no declaration file.
import { createIsolatedTestGitEnvironment } from "../scripts/lib/test-git-environment.mjs"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("canonical project paths", () => {
  it("deduplicates alternate paths to the same non-Git folder", () => {
    const container = temporaryDirectory()
    const project = join(container, "project")
    const alias = join(container, "alias")
    mkdirSync(project)
    symlinkSync(project, alias, process.platform === "win32" ? "junction" : "dir")

    expect(resolveCanonicalProjectPath(alias)).toBe(realpathSync(project))
    expect(
      findProjectByCanonicalPath([{ id: "legacy", path: alias }], realpathSync(project)),
    ).toEqual({ id: "legacy", path: alias })
  })

  it("keeps a linked Git worktree as its own Project folder", () => {
    const container = temporaryDirectory()
    const project = join(container, "project")
    const worktree = join(container, "linked-worktree")
    mkdirSync(project)
    git(project, ["init"])
    writeFileSync(join(project, "README.md"), "project\n")
    git(project, ["add", "README.md"])
    const isolatedGit = createIsolatedTestGitEnvironment()
    try {
      git(project, ["commit", "-m", "init"], isolatedGit.env)
    } finally {
      isolatedGit.cleanup()
    }
    git(project, ["worktree", "add", "--detach", worktree])

    expect(resolveCanonicalProjectPath(project)).toBe(realpathSync(project))
    expect(resolveCanonicalProjectPath(worktree)).toBe(realpathSync(worktree))
  })
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-project-path-"))
  directories.push(directory)
  return directory
}

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  execFileSync("git", args, { cwd, env, stdio: "ignore" })
}
