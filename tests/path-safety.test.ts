import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { prepareSafeWritePath, resolveInsideRoot } from "../src/main/lib/path-safety"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("attachment write path safety", () => {
  it("rejects lexical traversal and symlinked parent escapes", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-safe-root-"))
    const outside = mkdtempSync(join(tmpdir(), "flapstack-safe-outside-"))
    roots.push(root, outside)
    symlinkSync(outside, join(root, "escape"))

    expect(() => resolveInsideRoot(root, "../outside.txt")).toThrow("escapes root")
    await expect(prepareSafeWritePath(root, "escape/owned.txt")).rejects.toThrow("symbolic link")
  })

  it("creates safe nested parents and rejects a symlink final target", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-safe-root-"))
    const outside = mkdtempSync(join(tmpdir(), "flapstack-safe-outside-"))
    roots.push(root, outside)

    await expect(prepareSafeWritePath(root, "nested/file.txt")).resolves.toBe(
      join(realpathSync(root), "nested", "file.txt"),
    )
    writeFileSync(join(outside, "target.txt"), "outside")
    symlinkSync(join(outside, "target.txt"), join(root, "linked.txt"))
    await expect(prepareSafeWritePath(root, "linked.txt")).rejects.toThrow("symbolic link")
  })
})
