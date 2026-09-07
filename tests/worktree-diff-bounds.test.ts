import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
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
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

it("rejects oversized tracked output without returning a partial review", async () => {
  const root = repository()
  writeFileSync(join(root, "file.txt"), "x".repeat(9 * 1024 * 1024))
  expect(await getWorktreeDiff(root, undefined, { onlyUncommitted: true })).toMatchObject({
    success: false,
    error: expect.stringMatching(/limit/i),
  })
})

it("applies one output budget across separate untracked files", async () => {
  const root = repository()
  for (const name of ["a.txt", "b.txt"])
    writeFileSync(join(root, name), "x".repeat(4 * 1024 * 1024 + 1024))
  const result = await getWorktreeDiff(root, undefined, { onlyUncommitted: true })
  expect(result.success).toBe(false)
  expect(result.diff).toBeUndefined()
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

it("treats a leading dash filename as a path", async () => {
  const root = repository()
  writeFileSync(join(root, "-name.txt"), "dash filename\n")
  const result = await getWorktreeDiff(root, undefined, { onlyUncommitted: true })
  expect(result.success).toBe(true)
  expect(result.diff).toContain("+dash filename")
  writeFileSync(join(root, "new 文本.txt"), "Unicode filename\n")
  expect((await getWorktreeDiff(root, undefined, { onlyUncommitted: true })).diff).toContain(
    "+Unicode filename",
  )
})

it("does not run configured external diff drivers", async () => {
  const root = repository()
  writeFileSync(join(root, "file.txt"), "after\n")
  git(root, "config", "diff.external", "flapstack-nonexistent-diff-driver")
  const result = await getWorktreeDiff(root, undefined, { onlyUncommitted: true })
  expect(result.success).toBe(true)
  expect(result.diff).toContain("+after")
})

it("keeps clean and unborn-empty repositories empty", async () => {
  const root = repository()
  expect(await getWorktreeDiff(root, undefined, { onlyUncommitted: true })).toEqual({
    success: true,
    diff: "",
  })
  git(root, "checkout", "--orphan", "empty")
  git(root, "rm", "-f", "file.txt")
  expect(await getWorktreeDiff(root, undefined, { onlyUncommitted: true })).toEqual({
    success: true,
    diff: "",
  })
})

it("stops starting commands once the shared deadline expires", async () => {
  const root = repository()
  const now = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(30_001)
  try {
    expect(await getWorktreeDiff(root, undefined, { onlyUncommitted: true })).toEqual({
      success: false,
      error: "Review diff reached the 30 second collection limit",
    })
  } finally {
    now.mockRestore()
  }
})
