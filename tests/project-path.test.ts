import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  findProjectByCanonicalPath,
  resolveCanonicalProjectPath,
} from "../src/main/lib/projects/project-path"

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
    git(project, [
      "-c",
      "user.name=Flapstack Test",
      "-c",
      "user.email=test@flapstack.local",
      "commit",
      "-m",
      "init",
    ])
    git(project, ["worktree", "add", "--detach", worktree])

    expect(resolveCanonicalProjectPath(project)).toBe(realpathSync(project))
    expect(resolveCanonicalProjectPath(worktree)).toBe(realpathSync(worktree))
  })

  it("keeps independent Git repositories separate", () => {
    const container = temporaryDirectory()
    const first = join(container, "first")
    const second = join(container, "second")
    mkdirSync(first)
    mkdirSync(second)
    git(first, ["init"])
    git(second, ["init"])

    expect(resolveCanonicalProjectPath(first)).toBe(realpathSync(first))
    expect(resolveCanonicalProjectPath(second)).toBe(realpathSync(second))
  })

  it("allows folders with the same name at different paths", () => {
    const container = temporaryDirectory()
    const first = join(container, "one", "flapstack")
    const second = join(container, "two", "flapstack")
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })

    expect(resolveCanonicalProjectPath(first)).toBe(realpathSync(first))
    expect(resolveCanonicalProjectPath(second)).toBe(realpathSync(second))
    expect(resolveCanonicalProjectPath(first)).not.toBe(resolveCanonicalProjectPath(second))
  })
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-project-path-"))
  directories.push(directory)
  return directory
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" })
}
