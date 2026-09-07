import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ path: "", delta: 0n, descriptorShift: false }))
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  function inode<T extends object>(info: T, bigint: boolean, delta: bigint): T {
    const exact = 9007199254740992n + delta
    return Object.assign(Object.create(Object.getPrototypeOf(info)), info, {
      ino: bigint ? exact : Number(exact),
    })
  }
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const info = await actual.lstat(...args)
      return String(args[0]) === state.path ? inode(info, !!args[1]?.bigint, state.delta) : info
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      if (String(args[0]) === state.path) {
        const stat = handle.stat.bind(handle)
        const delta = state.delta + (state.descriptorShift ? 1n : 0n)
        vi.spyOn(handle, "stat").mockImplementation(async (options) =>
          inode(await stat(options), !!options?.bigint, delta),
        )
      }
      return handle
    },
  }
})
import {
  actOnPathInsideRoot,
  readFileInsideRoot,
  removeFileInsideRoot,
  renameFileInsideRoot,
  writeFileInsideRoot,
} from "../src/main/lib/path-safety"

let root: string, parent: string, target: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "flapstack-exact-identity-")))
  parent = join(root, "nested")
  mkdirSync(parent)
  target = join(parent, "file.txt")
  writeFileSync(target, "original")
  state.path = ""
  state.delta = 0n
  state.descriptorShift = false
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

it.each(
  ["read", "write", "rename", "remove", "act"].flatMap((operation) =>
    ["root", "parent", "target"].map((part) => ({ operation, part })),
  ),
)("rejects adjacent 64-bit $part identities before $operation", async ({ operation, part }) => {
  state.path = part === "root" ? root : part === "parent" ? parent : target
  const change = () => {
    state.delta = 1n
  }
  const action = vi.fn(async () => undefined)
  const result =
    operation === "read"
      ? readFileInsideRoot(root, "nested/file.txt", { beforeOpen: change })
      : operation === "write"
        ? writeFileInsideRoot(
            root,
            "nested/file.txt",
            { data: "new" },
            { overwrite: true, beforeCommit: change },
          )
        : operation === "rename"
          ? renameFileInsideRoot(root, "nested/file.txt", "renamed.txt", { beforeCommit: change })
          : operation === "remove"
            ? removeFileInsideRoot(root, "nested/file.txt", { beforeCommit: change })
            : actOnPathInsideRoot(root, "nested/file.txt", action, { beforeCommit: change })
  await expect(result).rejects.toThrow(/changed/)
  expect(action).not.toHaveBeenCalled()
  expect(readFileSync(target, "utf8")).toBe("original")
})

it.each(["read", "write"])(
  "rejects a rounded-equal descriptor identity during %s",
  async (operation) => {
    state.path = target
    state.descriptorShift = true
    const result =
      operation === "read"
        ? readFileInsideRoot(root, "nested/file.txt")
        : writeFileInsideRoot(root, "nested/file.txt", { data: "new" }, { overwrite: true })
    await expect(result).rejects.toThrow(/changed/)
    expect(readFileSync(target, "utf8")).toBe("original")
  },
)
