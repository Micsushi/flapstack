import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  userDataPath: "/tmp/flapstack-files-router-initial",
  subChatId: null as string | null,
  trashed: [] as string[],
}))

const assertRegisteredWorktree = vi.hoisted(() => vi.fn())

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
          get: () => (state.subChatId === null ? undefined : { id: state.subChatId }),
        }),
      }),
    }),
  }),
}))

vi.mock("../src/main/lib/git/security/path-validation", () => ({
  assertRegisteredWorktree,
}))

import { filesRouter } from "../src/main/lib/trpc/routers/files"

const roots: string[] = []
const caller = filesRouter.createCaller({ getWindow: () => null })

beforeEach(() => {
  vi.clearAllMocks()
  state.trashed = []
  state.subChatId = null
  state.userDataPath = mkdtempSync(join(tmpdir(), "flapstack-files-router-"))
  roots.push(state.userDataPath)
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("files router mutation path safety", () => {
  it("requires a durable, single-segment sub-chat identity before writing pasted text", async () => {
    await expect(caller.writePastedText({ subChatId: "missing", text: "blocked" })).rejects.toThrow(
      "Sub-chat not found",
    )

    state.subChatId = "../escape"
    await expect(
      caller.writePastedText({ subChatId: "../escape", text: "blocked" }),
    ).rejects.toThrow("path separators")

    state.subChatId = "sub-chat-1"
    const result = await caller.writePastedText({
      subChatId: "sub-chat-1",
      text: "inside",
      filename: "paste.txt",
    })
    expect(result.filePath).toBe(
      join(
        realpathSync(state.userDataPath),
        "claude-sessions",
        "sub-chat-1",
        "pasted",
        "paste.txt",
      ),
    )
    expect(readFileSync(result.filePath, "utf8")).toBe("inside")
  })

  it("rejects a symlinked session namespace before pasted content is written", async () => {
    const outside = mkdtempSync(join(tmpdir(), "flapstack-files-outside-"))
    roots.push(outside)
    symlinkSync(outside, join(state.userDataPath, "claude-sessions"))
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
    mkdirSync(join(root, "nested"))
    writeFileSync(join(root, "nested", "file.txt"), "inside")
    symlinkSync(outside, join(root, "escape"))

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
    writeFileSync(join(outside, "victim.txt"), "outside")
    symlinkSync(outside, join(root, "escape"))

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
})
