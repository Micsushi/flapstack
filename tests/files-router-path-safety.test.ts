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
  chatId: "chat-1",
  registeredRoots: new Set<string>(),
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

const roots: string[] = []
const caller = filesRouter.createCaller({ getWindow: () => null })

beforeEach(() => {
  vi.clearAllMocks()
  state.trashed = []
  state.subChatId = null
  state.registeredRoots.clear()
  state.userDataPath = mkdtempSync(join(tmpdir(), "flapstack-files-router-"))
  roots.push(state.userDataPath)
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
    state.registeredRoots.add(root)
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
    state.registeredRoots.add(root)
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
    symlinkSync(join(outside, "secret.txt"), join(root, "linked.txt"))

    await expect(caller.readFile({ rootPath: root, relativePath: "safe.txt" })).resolves.toBe(
      "inside",
    )
    await expect(
      caller.readFile({ rootPath: outside, relativePath: "secret.txt" }),
    ).rejects.toThrow("unregistered root")
    await expect(
      caller.readFile({ rootPath: root, relativePath: "../secret.txt" }),
    ).rejects.toThrow("escapes root")
    await expect(caller.readFile({ rootPath: root, relativePath: "linked.txt" })).rejects.toThrow(
      "real file",
    )
  })

  it("reads an absolute plan path only through its durable sub-chat namespace", async () => {
    state.subChatId = "sub-chat-1"
    const sessionRoot = join(state.userDataPath, "claude-sessions", state.subChatId)
    mkdirSync(sessionRoot, { recursive: true })
    const planPath = join(sessionRoot, "plan.md")
    writeFileSync(planPath, "durable plan")
    const outside = mkdtempSync(join(tmpdir(), "flapstack-files-outside-"))
    roots.push(outside)
    const outsidePath = join(outside, "plan.md")
    writeFileSync(outsidePath, "secret")

    await expect(caller.readFile({ subChatId: state.subChatId, filePath: planPath })).resolves.toBe(
      "durable plan",
    )
    await expect(
      caller.readFile({ subChatId: state.subChatId, filePath: realpathSync(planPath) }),
    ).resolves.toBe("durable plan")
    await expect(
      caller.readFile({ subChatId: state.subChatId, filePath: outsidePath }),
    ).rejects.toThrow("outside the durable sub-chat namespace")
  })
})
