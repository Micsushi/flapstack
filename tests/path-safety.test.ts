import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  prepareSafeWritePath,
  resolveInsideRoot,
  writeFileInsideRoot,
} from "../src/main/lib/path-safety"

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

  it("writes and atomically replaces only within the verified root", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-safe-root-"))
    roots.push(root)
    await expect(writeFileInsideRoot(root, "nested/file.txt", { data: "first" })).resolves.toEqual({
      targetPath: join(realpathSync(root), "nested", "file.txt"),
      byteLength: 5,
    })
    await writeFileInsideRoot(root, "nested/file.txt", { data: "second" }, { overwrite: true })
    expect(readFileSync(join(root, "nested/file.txt"), "utf8")).toBe("second")
  })

  it("aborts when the verified parent is swapped before commit", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-safe-root-"))
    const outside = mkdtempSync(join(tmpdir(), "flapstack-safe-outside-"))
    roots.push(root, outside)
    mkdirSync(join(root, "nested"))

    await expect(
      writeFileInsideRoot(
        root,
        "nested/file.txt",
        { data: "blocked" },
        {
          overwrite: true,
          beforeCommit: () => {
            renameSync(join(root, "nested"), join(outside, "moved-parent"))
            symlinkSync(outside, join(root, "nested"))
          },
        },
      ),
    ).rejects.toThrow(/parent/)
    expect(existsSync(join(outside, "file.txt"))).toBe(false)
  })

  it("aborts when the final inode is replaced by a symlink before commit", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-safe-root-"))
    const outside = mkdtempSync(join(tmpdir(), "flapstack-safe-outside-"))
    roots.push(root, outside)
    const target = join(root, "file.txt")
    const outsideTarget = join(outside, "victim.txt")
    writeFileSync(target, "inside")
    writeFileSync(outsideTarget, "outside")

    await expect(
      writeFileInsideRoot(
        root,
        "file.txt",
        { data: "blocked" },
        {
          overwrite: true,
          beforeCommit: () => {
            rmSync(target)
            symlinkSync(outsideTarget, target)
          },
        },
      ),
    ).rejects.toThrow(/target changed/)
    expect(readFileSync(outsideTarget, "utf8")).toBe("outside")
  })

  it("shares the rooted writer across product MCP and renderer attachment paths", () => {
    for (const file of [
      "src/main/lib/mcp-control/mutation-service.ts",
      "src/main/lib/trpc/routers/attachments.ts",
    ]) {
      expect(readFileSync(file, "utf8")).toContain("writeFileInsideRoot")
      expect(readFileSync(file, "utf8")).not.toContain("prepareSafeWritePath(")
    }
  })
})
