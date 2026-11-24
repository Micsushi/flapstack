import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { renameFileInsideRoot } from "../src/main/lib/path-safety"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "flapstack-text-rename-"))
  writeFileSync(join(root, "source.txt"), "original")
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it("never replaces a destination created at the commit boundary", async () => {
  await expect(
    renameFileInsideRoot(root, "source.txt", "target.txt", {
      beforeCommit: () => {
        writeFileSync(join(root, "target.txt"), "external")
      },
    }),
  ).rejects.toMatchObject({ code: "EEXIST" })
  expect(readFileSync(join(root, "source.txt"), "utf8")).toBe("original")
  expect(readFileSync(join(root, "target.txt"), "utf8")).toBe("external")
})

it("keeps recovery bytes when the source name changes after exclusive linking", async () => {
  await expect(
    renameFileInsideRoot(root, "source.txt", "target.txt", {
      afterLink: () => {
        renameSync(join(root, "source.txt"), join(root, "displaced.txt"))
        writeFileSync(join(root, "source.txt"), "external")
      },
    }),
  ).rejects.toThrow()
  expect(readFileSync(join(root, "source.txt"), "utf8")).toBe("external")
  expect(readFileSync(join(root, "target.txt"), "utf8")).toBe("original")
})
