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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fileSymlinksSupported } from "./helpers/symlink-capability"

const state = vi.hoisted(() => ({
  userDataPath: "/tmp/flapstack-files-router-initial",
  subChatId: null as string | null,
  chatId: "chat-1",
  registeredRoots: new Set<string>(),
  trashed: [] as string[],
}))

const assertRegisteredWorktree = vi.hoisted(() => vi.fn())
const scanState = vi.hoisted(() => ({
  opens: 0,
  beforeOpen: null as (() => Promise<void>) | null,
  identityPath: "",
  identityDelta: 0n,
}))
const watchState = vi.hoisted(() => ({ watcher: null as import("chokidar").FSWatcher | null }))
vi.mock("chokidar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("chokidar")>()
  return {
    ...actual,
    watch: (...args: Parameters<typeof actual.watch>) => {
      const watcher = actual.watch(...args)
      watchState.watcher = watcher
      return watcher
    },
  }
})
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const info = await actual.lstat(...args)
      if (String(args[0]) !== scanState.identityPath) return info
      const exact = 9007199254740992n + scanState.identityDelta
      return Object.assign(Object.create(Object.getPrototypeOf(info)), info, {
        ino: args[1]?.bigint ? exact : Number(exact),
      })
    },
    opendir: async (...args: Parameters<typeof actual.opendir>) => {
      scanState.opens += 1
      await scanState.beforeOpen?.()
      return actual.opendir(...args)
    },
  }
})

vi.mock("electron", () => ({
  app: { getPath: () => state.userDataPath },
  shell: {
    trashItem: vi.fn(async (path: string) => {
      state.trashed.push(path)
    }),
  },
}))

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: () => ({}),
}))

vi.mock("../src/main/lib/db", () => ({
  subChats: { id: "id" },
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: () =>
            state.subChatId === null ? undefined : { id: state.subChatId, chatId: state.chatId },
        }),
      }),
    }),
  }),
}))

vi.mock("../src/main/lib/git/security/path-validation", () => ({
  assertRegisteredWorktree,
}))

import { filesRouter } from "../src/main/lib/trpc/routers/files"
import { setBetaFeatureEnabled } from "../src/main/lib/beta-features/settings"
import type { WorkspaceFileSearchEvent } from "../src/shared/workspace-search"
import { randomUUID } from "node:crypto"

const roots: string[] = []
const caller = filesRouter.createCaller({ getWindow: () => null })
let previousConfigDir: string | undefined

beforeEach(() => {
  vi.clearAllMocks()
  scanState.opens = 0
  scanState.beforeOpen = null
  scanState.identityPath = ""
  scanState.identityDelta = 0n
  state.trashed = []
  state.subChatId = null
  state.registeredRoots.clear()
  state.userDataPath = mkdtempSync(join(tmpdir(), "flapstack-files-router-"))
  roots.push(state.userDataPath)
  previousConfigDir = process.env.FLAPSTACK_CONFIG_DIR
  process.env.FLAPSTACK_CONFIG_DIR = join(state.userDataPath, ".config")
  assertRegisteredWorktree.mockImplementation((path: string) => {
    if (!state.registeredRoots.has(path)) throw new Error("unregistered root")
    return {
      path,
      canonicalPath: realpathSync(path),
      deviceId: null,
      inodeId: null,
    }
  })
})

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.FLAPSTACK_CONFIG_DIR
  else process.env.FLAPSTACK_CONFIG_DIR = previousConfigDir
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("files router mutation path safety", () => {
  it("never publishes entries from a directory swapped before opening", async () => {
    const root = state.userDataPath
    const outside = mkdtempSync(join(tmpdir(), "flapstack-stream-outside-"))
    roots.push(outside)
    state.registeredRoots.add(root)
    setBetaFeatureEnabled("streamedFileSearch", true)
    mkdirSync(join(root, "nested"))
    writeFileSync(join(outside, "private-name.txt"), "outside")
    scanState.beforeOpen = async () => {
      if (scanState.opens !== 2) return
      renameSync(join(root, "nested"), join(root, "moved"))
      symlinkSync(outside, join(root, "nested"), process.platform === "win32" ? "junction" : "dir")
    }
    const events: WorkspaceFileSearchEvent[] = []
    const stream = await caller.searchStream({ requestId: randomUUID(), projectPath: root })
    const subscription = stream.subscribe({ next: (event) => events.push(event) })
    try {
      await vi.waitFor(() => expect(events.at(-1)?.status).toBe("error"))
      expect(JSON.stringify(events)).not.toContain("private-name")
    } finally {
      subscription.unsubscribe()
    }
  })

  it("rejects a symlinked session namespace before pasted content is written", async () => {
    const outside = mkdtempSync(join(tmpdir(), "flapstack-files-outside-"))
    roots.push(outside)
    symlinkSync(
      outside,
      join(state.userDataPath, "claude-sessions"),
      process.platform === "win32" ? "junction" : "dir",
    )
    state.subChatId = "sub-chat-1"

    await expect(
      caller.writePastedText({
        subChatId: "sub-chat-1",
        text: "blocked",
        filename: "paste.txt",
      }),
    ).rejects.toThrow("symbolic link")
    expect(existsSync(join(outside, "sub-chat-1", "pasted", "paste.txt"))).toBe(false)
  })

  it("rejects absolute, traversal, and symlink-parent rename targets", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-files-root-"))
    const outside = mkdtempSync(join(tmpdir(), "flapstack-files-outside-"))
    roots.push(root, outside)
    state.registeredRoots.add(root)
    mkdirSync(join(root, "nested"))
    writeFileSync(join(root, "nested", "file.txt"), "inside")
    symlinkSync(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir")

    await expect(
      caller.renameFile({
        worktreePath: root,
        relativePath: join(outside, "victim"),
        newName: "x",
      }),
    ).rejects.toThrow("relative")
    await expect(
      caller.renameFile({ worktreePath: root, relativePath: "../victim", newName: "x" }),
    ).rejects.toThrow("escapes root")
    await expect(
      caller.renameFile({ worktreePath: root, relativePath: "escape/victim", newName: "x" }),
    ).rejects.toThrow("real directory")
    expect(assertRegisteredWorktree).toHaveBeenCalledWith(root)
  })

  it("never dispatches trash for traversal or a symlinked parent", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-files-root-"))
    const outside = mkdtempSync(join(tmpdir(), "flapstack-files-outside-"))
    roots.push(root, outside)
    state.registeredRoots.add(root)
    writeFileSync(join(outside, "victim.txt"), "outside")
    symlinkSync(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir")

    await expect(
      caller.deleteFile({ worktreePath: root, relativePath: "../victim.txt" }),
    ).rejects.toThrow("escapes root")
    await expect(
      caller.deleteFile({ worktreePath: root, relativePath: "escape/victim.txt" }),
    ).rejects.toThrow("real directory")
    expect(state.trashed).toEqual([])
    expect(readFileSync(join(outside, "victim.txt"), "utf8")).toBe("outside")
  })

  it("preserves safe rename and trash behavior inside a registered worktree", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-files-root-"))
    roots.push(root)
    state.registeredRoots.add(root)
    writeFileSync(join(root, "file.txt"), "inside")

    const renamed = await caller.renameFile({
      worktreePath: root,
      relativePath: "file.txt",
      newName: "renamed.txt",
    })
    expect(renamed.newPath).toBe(join(realpathSync(root), "renamed.txt"))
    expect(readFileSync(renamed.newPath, "utf8")).toBe("inside")

    await caller.deleteFile({ worktreePath: root, relativePath: "renamed.txt" })
    expect(state.trashed).toEqual([join(realpathSync(root), "renamed.txt")])
  })

  it("reads only registered rooted relative files and rejects traversal and symlink escape", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-files-root-"))
    const outside = mkdtempSync(join(tmpdir(), "flapstack-files-outside-"))
    roots.push(root, outside)
    state.registeredRoots.add(root)
    writeFileSync(join(root, "safe.txt"), "inside")
    writeFileSync(join(outside, "secret.txt"), "secret")
    if (fileSymlinksSupported) {
      symlinkSync(join(outside, "secret.txt"), join(root, "linked.txt"))
    }

    await expect(caller.readFile({ rootPath: root, relativePath: "safe.txt" })).resolves.toBe(
      "inside",
    )
    await expect(
      caller.readFile({ rootPath: outside, relativePath: "secret.txt" }),
    ).rejects.toThrow("unregistered root")
    await expect(
      caller.readFile({ rootPath: root, relativePath: "../secret.txt" }),
    ).rejects.toThrow("escapes root")
    if (fileSymlinksSupported) {
      await expect(caller.readFile({ rootPath: root, relativePath: "linked.txt" })).rejects.toThrow(
        "real file",
      )
    }
  })
})
