import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, expect, it } from "vitest"
import { getWorktreeDiff } from "../src/main/lib/git/worktree"

const roots: string[] = []
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true })
function repository() {
  const root = mkdtempSync(join(tmpdir(), "flapstack-bounded-diff-"))
  roots.push(root)
  git(root, "init", "--quiet", "--initial-branch=fixture")
  git(root, "config", "core.autocrlf", "false")
  writeFileSync(join(root, "file.txt"), "before\n")
  git(root, "add", "file.txt")
  git(root, "commit", "--quiet", "-m", "Fixture")
  return root
}
afterAll(() =>
  roots
    .splice(0)
    .forEach((root) =>
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
    ),
)

it("rejects oversized tracked output without returning a partial review", async () => {
  const root = repository()
  writeFileSync(join(root, "file.txt"), "x".repeat(9 * 1024 * 1024))
  expect(await getWorktreeDiff(root, undefined, { onlyUncommitted: true })).toMatchObject({
    success: false,
    error: expect.stringMatching(/limit/i),
  })
})

it("preserves ordinary diff bytes, ignores locks and never changes the index", async () => {
  const root = repository()
  writeFileSync(join(root, "file.txt"), "after\n")
  writeFileSync(join(root, "new.txt"), "new\n")
  writeFileSync(join(root, "package-lock.json"), "ignored\n")
  const ordinary = await getWorktreeDiff(root)
  const index = readFileSync(join(root, ".git/index"))
  const bounded = await getWorktreeDiff(root, undefined, { onlyUncommitted: true })
  expect(bounded).toEqual(ordinary)
  expect(bounded.diff).toContain("+new")
  expect(bounded.diff).not.toContain("+ignored")
  expect(readFileSync(join(root, ".git/index"))).toEqual(index)
})

it("does not run configured external diff drivers", async () => {
  const root = repository()
  writeFileSync(join(root, "file.txt"), "after\n")
  git(root, "config", "diff.external", "flapstack-nonexistent-diff-driver")
  const result = await getWorktreeDiff(root, undefined, { onlyUncommitted: true })
  expect(result.success).toBe(true)
  expect(result.diff).toContain("+after")
})
