import { describe, expect, it, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, truncateSync } from "node:fs"
import { createHash, randomBytes } from "node:crypto"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureWorktreeTree, hashWorktreeFile } from "../src/main/lib/checkpoints"

vi.mock("electron", () => ({ app: { getPath: () => tmpdir(), isPackaged: false } }))

describe("checkpoint index reuse", () => {
  it("preserves existing hashes across stream boundaries and handles missing files", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-hash-test-"))
    try {
      const data = randomBytes(131071)
      writeFileSync(join(root, "binary"), data)
      expect(await hashWorktreeFile(root, "binary")).toBe(
        createHash("sha256").update(data.toString("base64")).digest("hex").slice(0, 16),
      )
      expect(await hashWorktreeFile(root, "missing")).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("hashes files whose base64 representation exceeds the JavaScript string limit", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-large-hash-test-"))
    try {
      const file = join(root, "large")
      writeFileSync(file, "")
      const size = 405 * 1024 * 1024
      truncateSync(file, size)
      const expected = createHash("sha256")
      for (let remaining = (size / 3) * 4; remaining > 0; remaining -= 65536)
        expected.update("A".repeat(Math.min(remaining, 65536)))
      expect(await hashWorktreeFile(root, "large")).toBe(expected.digest("hex").slice(0, 16))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30000)
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
