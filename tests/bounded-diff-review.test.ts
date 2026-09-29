import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { afterEach, expect, it } from "vitest"
import { readDiffReview, reviewPage } from "../src/main/lib/diff-annotations/review"
import { splitUnifiedDiffByFile } from "../src/main/lib/git/diff-parser"
import { decodeGitPath, gitDiffHeaderPaths } from "../src/shared/git-diff-paths"

const roots: string[] = []
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=",
  "base64",
)
const git = (root: string, ...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "flapstack-image-review-"))
  roots.push(root)
  git(root, "init", "--quiet")
  git(root, "config", "user.name", "Review fixture")
  git(root, "config", "user.email", "fixture@example.invalid")
  writeFileSync(join(root, "image.png"), png)
  git(root, "add", ".")
  git(root, "commit", "--quiet", "-m", "fixture")
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it("bounds pages, retains exact old/new line numbers, and discloses long rows", () => {
  const diff =
    "--- a/a\n+++ b/a\n@@ -20,250 +30,250 @@\n-old\n+new\n" +
    " context\n".repeat(248) +
    "+" +
    "x".repeat(3000)
  const first = reviewPage(diff, 0),
    second = reviewPage(diff, 200)
  expect(first.rows).toHaveLength(200)
  expect(first.rows[3]).toMatchObject({ left: 20, right: null })
  expect(first.rows[4]).toMatchObject({ left: null, right: 30 })
  expect(second.rows[0]).toMatchObject({ left: 216, right: 226 })
  expect(second.rows.at(-1)).toMatchObject({ truncated: true })
  expect(second.next).toBeNull()
})

it("returns exact before/after bytes and separate identities for changed images", async () => {
  const root = fixture()
  const changed = Buffer.concat([png, Buffer.from("changed")])
  writeFileSync(join(root, "image.png"), changed)
  const diff = git(root, "diff", "HEAD"),
    file = splitUnifiedDiffByFile(diff)[0]!
  const result = await readDiffReview(root, diff, file.key, 0)
  expect(result.kind).toBe("image")
  if (result.kind !== "image") throw Error("Expected image")
  expect(result.before?.dataUrl).toBe(`data:image/png;base64,${png.toString("base64")}`)
  expect(result.after?.dataUrl).toBe(`data:image/png;base64,${changed.toString("base64")}`)
  expect(result.before?.hash).not.toBe(result.after?.hash)
})

it("represents image addition and deletion without manufacturing the missing side", async () => {
  const root = fixture()
  unlinkSync(join(root, "image.png"))
  let diff = git(root, "diff", "HEAD")
  let result = await readDiffReview(root, diff, splitUnifiedDiffByFile(diff)[0]!.key, 0)
  expect(result).toMatchObject({ kind: "image", after: null })
  writeFileSync(join(root, "added.png"), png)
  git(root, "add", "added.png")
  diff = git(root, "diff", "HEAD", "--", "added.png")
  result = await readDiffReview(root, diff, splitUnifiedDiffByFile(diff)[0]!.key, 0)
  expect(result).toMatchObject({ kind: "image", before: null })
})

it("rejects unsupported binary content, over-limit pixels payloads and absent file keys", async () => {
  const root = fixture()
  writeFileSync(join(root, "image.png"), Buffer.from([0, 1, 2, 3]))
  let diff = git(root, "diff", "HEAD"),
    key = splitUnifiedDiffByFile(diff)[0]!.key
  await expect(readDiffReview(root, diff, key, 0)).rejects.toThrow("supports")
  await expect(readDiffReview(root, diff, "foreign", 0)).rejects.toThrow("no longer")
  writeFileSync(join(root, "image.png"), Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]))
  diff = git(root, "diff", "HEAD")
  await expect(readDiffReview(root, diff, key, 0)).rejects.toThrow()
})

it("cancels image collection before Git work can complete", async () => {
  const root = fixture()
  writeFileSync(join(root, "image.png"), Buffer.concat([png, Buffer.from("changed")]))
  const diff = git(root, "diff", "HEAD"),
    signal = AbortSignal.abort()
  await expect(
    readDiffReview(root, diff, splitUnifiedDiffByFile(diff)[0]!.key, 0, signal),
  ).rejects.toThrow()
})

it("rejects small compressed payloads declaring excessive decoded dimensions", async () => {
  const root = fixture()
  const oversized = Buffer.from(png)
  oversized.writeUInt32BE(100_000, 16)
  writeFileSync(join(root, "image.png"), oversized)
  const diff = git(root, "diff", "HEAD")
  await expect(readDiffReview(root, diff, splitUnifiedDiffByFile(diff)[0]!.key, 0)).rejects.toThrow(
    "megapixel",
  )
})

it("loads Unicode image paths with Git's default octal quoting", async () => {
  const root = fixture(),
    name = "画像 space.png"
  writeFileSync(join(root, name), png)
  git(root, "add", name)
  const diff = git(root, "-c", "core.quotePath=true", "diff", "HEAD", "--", name)
  const file = splitUnifiedDiffByFile(diff)[0]!
  expect(file.newPath).toBe(name)
  const result = await readDiffReview(root, diff, file.key, 0)
  expect(result).toMatchObject({ kind: "image", before: null })
})

it("decodes quoted control characters without changing diff boundaries", () => {
  expect(decodeGitPath('"a/tab\\tquote\\\"slash\\\\.png"')).toBe('a/tab\tquote"slash\\.png')
  expect(gitDiffHeaderPaths('diff --git "a/tab\\nname.png" "b/tab\\nname.png"')).toEqual([
    "tab\nname.png",
    "tab\nname.png",
  ])
  expect(gitDiffHeaderPaths("diff --git a/foo b/bar.png b/foo b/bar.png")).toEqual([
    "foo b/bar.png",
    "foo b/bar.png",
  ])
})
