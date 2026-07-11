import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { validateCustomWorktreePath } from "../src/main/lib/git/validate-custom-worktree"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "flapstack-custom-worktree-"))
  tempDirs.push(dir)
  return dir
}

describe("custom worktree validation", () => {
  it("rejects relative and missing paths", async () => {
    expect(await validateCustomWorktreePath("relative/path")).toMatchObject({
      valid: false,
      error: "Enter an absolute path.",
    })
    expect(
      await validateCustomWorktreePath(join(tmpdir(), "flapstack-does-not-exist")),
    ).toMatchObject({ valid: false })
  })

  it("rejects an existing non-Git directory", async () => {
    const dir = makeTempDir()
    expect(await validateCustomWorktreePath(dir)).toEqual({
      valid: false,
      path: realpathSync(dir),
      error: "The selected directory is not a Git checkout.",
    })
  })

  it("resolves and accepts a Git checkout", async () => {
    const dir = makeTempDir()
    execFileSync("git", ["init", "-b", "main", dir], { stdio: "ignore" })
    writeFileSync(join(dir, "README.md"), "test\n")
    execFileSync("git", ["-C", dir, "add", "README.md"])
    execFileSync(
      "git",
      [
        "-C",
        dir,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "init",
      ],
      { stdio: "ignore" },
    )

    expect(await validateCustomWorktreePath(dir)).toEqual({
      valid: true,
      path: realpathSync(dir),
      branch: "main",
    })

    const nested = join(dir, "src", "nested")
    mkdirSync(nested, { recursive: true })
    expect(await validateCustomWorktreePath(nested)).toEqual({
      valid: true,
      path: realpathSync(dir),
      branch: "main",
    })
  })
})
