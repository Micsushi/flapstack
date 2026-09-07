import { existsSync, linkSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const scan = vi.hoisted(() => ({ count: null as number | null, closed: false }))
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    opendir: (...args: Parameters<typeof actual.opendir>) => {
      if (scan.count === null) return actual.opendir(...args)
      return (async function* () {
        try {
          for (let i = 0; i < scan.count!; i++) yield { name: `other-${i}` }
        } finally {
          scan.closed = true
        }
      })()
    },
  }
})
import {
  readFileInsideRoot,
  renameFileInsideRoot,
  renamePathInsideRoot,
} from "../src/main/lib/path-safety"

let root: string
beforeEach(() => {
  scan.count = null
  scan.closed = false
  root = mkdtempSync(join(tmpdir(), "flapstack-exact-name-"))
  writeFileSync(join(root, "file.txt"), "bytes")
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it.each([
  ["editor", renameFileInsideRoot],
  ["file tree", renamePathInsideRoot],
] as const)("distinguishes actual spelling through %s case-only rename", async (_label, rename) => {
  await expect(readFileInsideRoot(root, "FILE.TXT", { exactName: true })).rejects.toMatchObject({
    code: "ENOENT",
  })
  await rename(root, "file.txt", "FILE.TXT")
  expect((await readFileInsideRoot(root, "FILE.TXT", { exactName: true })).toString()).toBe("bytes")
  await expect(readFileInsideRoot(root, "file.txt", { exactName: true })).rejects.toMatchObject({
    code: "ENOENT",
  })
})

it("rejects separate same-inode names on a case-sensitive filesystem", async ({ skip }) => {
  if (existsSync(join(root, "FILE.TXT"))) return skip()
  linkSync(join(root, "file.txt"), join(root, "FILE.TXT"))
  await expect(renameFileInsideRoot(root, "file.txt", "FILE.TXT")).rejects.toMatchObject({
    code: "EEXIST",
  })
  expect(readdirSync(root).sort()).toEqual(["FILE.TXT", "file.txt"])
})

it("bounds exact-name scans and closes the directory iterator on refusal", async () => {
  scan.count = 10_001
  await expect(readFileInsideRoot(root, "file.txt", { exactName: true })).rejects.toThrow(
    "10000 directory entries",
  )
  expect(scan.closed).toBe(true)
})
