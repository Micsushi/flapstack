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
import { fileSymlinksSupported } from "./helpers/symlink-capability"
import {
  actOnPathInsideRoot,
  prepareSafeWritePath,
  renamePathInsideRoot,
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
    symlinkSync(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir")

    expect(() => resolveInsideRoot(root, "../outside.txt")).toThrow("escapes root")
    await expect(prepareSafeWritePath(root, "escape/owned.txt")).rejects.toThrow("symbolic link")
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

  it("never removes an adjacent or replacement inode during failed post-write cleanup", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-safe-root-"))
    roots.push(root)
    const target = join(root, "created.txt")
    const movedCreated = join(root, "moved-created.txt")
    const adjacent = join(root, "adjacent.txt")
    writeFileSync(adjacent, "adjacent sentinel")

    await expect(
      writeFileInsideRoot(
        root,
        "created.txt",
        { data: "owned payload" },
        {
          afterCommit: () => {
            throw new Error("forced database failure")
          },
          beforeFailureCleanup: () => {
            renameSync(target, movedCreated)
            writeFileSync(target, "replacement sentinel")
          },
        },
      ),
    ).rejects.toThrow("forced database failure")

    expect(readFileSync(adjacent, "utf8")).toBe("adjacent sentinel")
    expect(readFileSync(target, "utf8")).toBe("replacement sentinel")
    expect(readFileSync(movedCreated, "utf8")).toBe("owned payload")
  })

  it("aborts a write when the registered root namespace is replaced", async () => {
    const container = mkdtempSync(join(tmpdir(), "flapstack-safe-container-"))
    const root = join(container, "root")
    const movedRoot = join(container, "moved-root")
    roots.push(container)
    mkdirSync(root)
    writeFileSync(join(root, "file.txt"), "inside")

    await expect(
      writeFileInsideRoot(
        root,
        "file.txt",
        { data: "blocked" },
        {
          overwrite: true,
          beforeCommit: () => {
            renameSync(root, movedRoot)
            mkdirSync(root)
          },
        },
      ),
    ).rejects.toThrow(/root inode/)
    expect(readFileSync(join(movedRoot, "file.txt"), "utf8")).toBe("inside")
    expect(existsSync(join(root, "file.txt"))).toBe(false)
  })

  it("roots rename and trash operations and rejects namespace swaps", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-safe-root-"))
    const outside = mkdtempSync(join(tmpdir(), "flapstack-safe-outside-"))
    roots.push(root, outside)
    mkdirSync(join(root, "nested"))
    writeFileSync(join(root, "nested", "file.txt"), "inside")

    expect(() => resolveInsideRoot(root, join(outside, "victim.txt"))).toThrow(/relative/)
    await expect(renamePathInsideRoot(root, "../victim.txt", "renamed.txt")).rejects.toThrow(
      /escapes root/,
    )
    await expect(
      renamePathInsideRoot(root, "nested/file.txt", "renamed.txt", {
        beforeCommit: () => {
          renameSync(join(root, "nested"), join(outside, "moved-parent"))
          symlinkSync(
            outside,
            join(root, "nested"),
            process.platform === "win32" ? "junction" : "dir",
          )
        },
      }),
    ).rejects.toThrow(/parent/)
    expect(existsSync(join(outside, "renamed.txt"))).toBe(false)

    if (fileSymlinksSupported) {
      rmSync(join(root, "nested"))
      mkdirSync(join(root, "nested"))
      writeFileSync(join(root, "nested", "trash.txt"), "inside")
      let dispatched = false
      await expect(
        actOnPathInsideRoot(
          root,
          "nested/trash.txt",
          async () => {
            dispatched = true
          },
          {
            beforeCommit: (targetPath) => {
              rmSync(targetPath)
              symlinkSync(join(outside, "victim.txt"), targetPath)
            },
          },
        ),
      ).rejects.toThrow(/inode/)
      expect(dispatched).toBe(false)
    }
  })
})
