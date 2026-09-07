import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ path: "", delta: 0n, descriptor: false }))
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  function inode<T extends object>(info: T, bigint: boolean, delta: bigint): T {
    const exact = 9007199254740992n + delta
    return Object.assign(Object.create(Object.getPrototypeOf(info)), info, {
      ino: bigint ? exact : Number(exact),
    })
  }
  return {
    ...actual,
    lstatSync: (...args: Parameters<typeof actual.lstatSync>) => {
      const info = actual.lstatSync(...args)
      return info && String(args[0]) === state.path
        ? inode(info, !!args[1]?.bigint, state.delta)
        : info
    },
    fstatSync: (...args: Parameters<typeof actual.fstatSync>) => {
      const info = actual.fstatSync(...args)
      return state.descriptor ? inode(info, !!args[1]?.bigint, 0n) : info
    },
  }
})
import { ensureProjectVaultGitExclusion } from "../src/main/lib/project-vaults/git-exclusion"

let root: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "flapstack-exclude-identity-")))
  execFileSync("git", ["init", "--quiet", root], { windowsHide: true })
  state.path = ""
  state.delta = 0n
  state.descriptor = false
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it("does not remove a replacement lock with an adjacent 64-bit identity", () => {
  state.path = join(root, ".git", "info", "flapstack-project-vault-exclude.lock")
  state.descriptor = true
  ensureProjectVaultGitExclusion(root, {
    beforeVerify: () => {
      state.delta = 1n
      writeFileSync(state.path, "replacement owner")
    },
  })
  expect(existsSync(state.path)).toBe(true)
  expect(readFileSync(state.path, "utf8")).toBe("replacement owner")
})

it("rejects repeatedly replaced exclude identities even when contents are equal", () => {
  state.path = join(root, ".git", "info", "exclude")
  const original = readFileSync(state.path, "utf8")
  expect(() =>
    ensureProjectVaultGitExclusion(root, {
      beforeCompareAndSwap: () => {
        state.delta = state.delta === 0n ? 1n : 0n
      },
    }),
  ).toThrow("changed concurrently too many times")
  expect(readFileSync(state.path, "utf8")).toBe(original)
})
