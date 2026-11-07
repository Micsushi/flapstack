import { describe, expect, it, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureWorktreeTree } from "../src/main/lib/checkpoints"

vi.mock("electron", () => ({ app: { getPath: () => tmpdir(), isPackaged: false } }))

describe("checkpoint index reuse", () => {
  it("captures staged, unstaged and untracked files without changing the user's index", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-checkpoint-test-"))
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim()
    try {
      git("init", "-q")
      writeFileSync(join(root, "tracked.txt"), "original")
      git("add", ".")
      git("commit", "-qm", "Fixture")
      writeFileSync(join(root, "tracked.txt"), "staged")
      git("add", "tracked.txt")
      writeFileSync(join(root, "tracked.txt"), "unstaged")
      writeFileSync(join(root, "new.txt"), "new file")
      const index = readFileSync(join(root, ".git/index"))
      const checkpoint = await captureWorktreeTree(root)
      expect(git("show", `${checkpoint}:tracked.txt`)).toBe("unstaged")
      expect(git("show", `${checkpoint}:new.txt`)).toBe("new file")
      expect(readFileSync(join(root, ".git/index"))).toEqual(index)
      expect(git("show", ":tracked.txt")).toBe("staged")
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})
