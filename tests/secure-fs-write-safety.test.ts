import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const assertRegisteredWorktree = vi.hoisted(() => vi.fn())

vi.mock("../src/main/lib/git/security/path-validation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/main/lib/git/security/path-validation")>()),
  assertRegisteredWorktree,
}))

import { secureFs } from "../src/main/lib/git/security/secure-fs"
import { PathValidationError } from "../src/main/lib/git/security/path-validation"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe("secureFs rooted writer", () => {
  it("preserves lexical PathValidationError codes and blocks symlink targets", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-secure-fs-root-"))
    const outside = mkdtempSync(join(tmpdir(), "flapstack-secure-fs-outside-"))
    roots.push(root, outside)
    const victim = join(outside, "victim.txt")
    writeFileSync(victim, "outside")
    symlinkSync(victim, join(root, "linked.txt"))

    await expect(secureFs.writeFile(root, "../victim.txt", "blocked")).rejects.toMatchObject({
      code: "PATH_TRAVERSAL",
    })
    await expect(secureFs.writeFile(root, victim, "blocked")).rejects.toMatchObject({
      code: "ABSOLUTE_PATH",
    })
    await expect(secureFs.writeFile(root, "linked.txt", "blocked")).rejects.toMatchObject({
      code: "SYMLINK_ESCAPE",
    })
    expect(readFileSync(victim, "utf8")).toBe("outside")
  })

  it("fails closed when the worktree namespace changes before atomic replace", async () => {
    const container = mkdtempSync(join(tmpdir(), "flapstack-secure-fs-container-"))
    const root = join(container, "root")
    const movedRoot = join(container, "moved-root")
    roots.push(container)
    mkdirSync(root)
    writeFileSync(join(root, "file.txt"), "inside")

    const write = secureFs.writeFile(root, "file.txt", "blocked", {
      beforeCommit: () => {
        renameSync(root, movedRoot)
        mkdirSync(root)
      },
    })
    await expect(write).rejects.toBeInstanceOf(PathValidationError)
    await expect(write).rejects.toMatchObject({ code: "SYMLINK_ESCAPE" })
    expect(readFileSync(join(movedRoot, "file.txt"), "utf8")).toBe("inside")
    expect(existsSync(join(root, "file.txt"))).toBe(false)
    expect(assertRegisteredWorktree).toHaveBeenCalledWith(root)
  })
})
