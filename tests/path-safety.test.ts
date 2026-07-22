import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

  it.skipIf(!fileSymlinksSupported)(
    "creates safe nested parents and rejects a symlink final target",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "flapstack-safe-root-"))
      const outside = mkdtempSync(join(tmpdir(), "flapstack-safe-outside-"))
      roots.push(root, outside)

      await expect(prepareSafeWritePath(root, "nested/file.txt")).resolves.toBe(
        join(realpathSync(root), "nested", "file.txt"),
      )
      writeFileSync(join(outside, "target.txt"), "outside")
      symlinkSync(join(outside, "target.txt"), join(root, "linked.txt"))
      await expect(prepareSafeWritePath(root, "linked.txt")).rejects.toThrow("symbolic link")
    },
  )

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

    const payload = "secret-payload-must-not-survive"
    await expect(
      writeFileInsideRoot(
        root,
        "nested/file.txt",
        { data: payload },
        {
          overwrite: true,
          beforeCommit: () => {
            renameSync(join(root, "nested"), join(outside, "moved-parent"))
            symlinkSync(
              outside,
              join(root, "nested"),
              process.platform === "win32" ? "junction" : "dir",
            )
          },
        },
      ),
    ).rejects.toThrow(/parent/)
    expect(existsSync(join(outside, "file.txt"))).toBe(false)
    const survivingFiles = listRealFiles(root).concat(listRealFiles(outside))
    expect(
      survivingFiles.some((path) => path.includes(".flapstack-") && path.endsWith(".tmp")),
    ).toBe(false)
    expect(
      survivingFiles.some((path) => {
        try {
          return readFileSync(path, "utf8").includes(payload)
        } catch {
          return false
        }
      }),
    ).toBe(false)
  })

  it.skipIf(!fileSymlinksSupported)(
    "aborts when the final inode is replaced by a symlink before commit",
    async () => {
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
    },
  )

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

  it.skipIf(!fileSymlinksSupported)(
    "renames a final symlink itself without following its target",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "flapstack-safe-root-"))
      const outside = mkdtempSync(join(tmpdir(), "flapstack-safe-outside-"))
      roots.push(root, outside)
      const victim = join(outside, "victim.txt")
      writeFileSync(victim, "outside")
      symlinkSync(victim, join(root, "linked.txt"))

      await renamePathInsideRoot(root, "linked.txt", "renamed-link.txt")
      expect(readFileSync(victim, "utf8")).toBe("outside")
      expect(existsSync(join(root, "linked.txt"))).toBe(false)
    },
  )

  it("shares the rooted writer across product MCP and renderer attachment paths", () => {
    for (const file of [
      "src/main/lib/mcp-control/mutation-service.ts",
      "src/main/lib/trpc/routers/attachments.ts",
      "src/main/lib/git/security/secure-fs.ts",
    ]) {
      expect(readFileSync(file, "utf8")).toContain("writeFileInsideRoot")
      expect(readFileSync(file, "utf8")).not.toContain("prepareSafeWritePath(")
    }
  })
})

function listRealFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isFile()) files.push(path)
    if (entry.isDirectory() && !entry.isSymbolicLink()) files.push(...listRealFiles(path))
  }
  return files
}
