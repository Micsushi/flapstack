import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { afterEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ growPath: "", closed: false, readBytes: 0 }))
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      if (String(args[0]) === state.growPath) {
        const stat = handle.stat.bind(handle)
        vi.spyOn(handle, "stat").mockImplementationOnce(async () => {
          const snapshot = await stat()
          appendFileSync(state.growPath, Buffer.alloc(1024 * 1024, 97))
          return snapshot
        })
        const read = handle.read.bind(handle)
        vi.spyOn(handle, "read").mockImplementation(async (...readArgs) => {
          const result = await read(...readArgs)
          state.readBytes += result.bytesRead
          return result
        })
        const close = handle.close.bind(handle)
        vi.spyOn(handle, "close").mockImplementation(async () => {
          await close()
          state.closed = true
        })
      }
      return handle
    },
  }
})

import {
  readFileInsideRoot,
  writeFileInsideRoot,
  RootedReadTooLargeError,
} from "../src/main/lib/path-safety"

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  state.growPath = ""
  state.closed = false
  state.readBytes = 0
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(content: string | Buffer) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flapstack-read-limit-")))
  roots.push(root)
  writeFileSync(join(root, "file.txt"), content)
  return root
}

it("stops at the byte limit even when a file grows after the initial handle stat", async () => {
  const root = fixture("abc")
  state.growPath = join(root, "file.txt")
  await expect(
    readFileInsideRoot(root, "file.txt", { maxBytes: 8 }).then((bytes) => bytes.length),
  ).rejects.toBeInstanceOf(RootedReadTooLargeError)
  expect(state.closed).toBe(true)
  expect(state.readBytes).toBe(9)
})

it("reads exact limits, empty files and multiple chunks without truncation", async () => {
  for (const size of [0, 1, 64 * 1024, 64 * 1024 + 3]) {
    const bytes = Buffer.alloc(size, 97)
    await expect(
      readFileInsideRoot(fixture(bytes), "file.txt", { maxBytes: size }),
    ).resolves.toEqual(bytes)
  }
})

it("bounds the old-content read used by a conditional overwrite after handle growth", async () => {
  const root = fixture("abc")
  state.growPath = join(root, "file.txt")
  await expect(
    writeFileInsideRoot(
      root,
      "file.txt",
      { data: "next" },
      {
        overwrite: true,
        maxExistingBytes: 8,
        expectedSha256: createHash("sha256").update("abc").digest("hex"),
      },
    ),
  ).rejects.toBeInstanceOf(RootedReadTooLargeError)
  expect(state.closed).toBe(true)
  expect(state.readBytes).toBe(9)
})

it("rejects oversized files and invalid limits", async () => {
  const root = fixture("abc")
  await expect(readFileInsideRoot(root, "file.txt", { maxBytes: 2 })).rejects.toBeInstanceOf(
    RootedReadTooLargeError,
  )
  for (const maxBytes of [-1, NaN, Infinity, 1.5]) {
    await expect(readFileInsideRoot(root, "file.txt", { maxBytes })).rejects.toThrow()
    await expect(
      writeFileInsideRoot(
        root,
        "file.txt",
        { data: "next" },
        { overwrite: true, maxExistingBytes: maxBytes },
      ),
    ).rejects.toBeInstanceOf(RangeError)
  }
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("abc")
})

it("rechecks the existing byte limit without a content-hash expectation", async () => {
  const root = fixture("abc")
  await expect(
    writeFileInsideRoot(
      root,
      "file.txt",
      { data: "next" },
      {
        overwrite: true,
        maxExistingBytes: 3,
        beforeCommit: async (path) => {
          appendFileSync(path, "d")
        },
      },
    ),
  ).rejects.toBeInstanceOf(RootedReadTooLargeError)
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("abcd")
})

it("rejects an existing target expected to be missing before reading its content", async () => {
  const root = fixture("abc")
  state.growPath = join(root, "file.txt")
  await expect(
    writeFileInsideRoot(
      root,
      "file.txt",
      { data: "next" },
      {
        overwrite: true,
        expectedSha256: null,
        maxExistingBytes: 3,
      },
    ),
  ).rejects.toThrow()
  expect(state.readBytes).toBe(0)
  expect(state.closed).toBe(false)
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("abc")
})
