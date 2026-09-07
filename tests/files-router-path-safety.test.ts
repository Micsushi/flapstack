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
const scanState = vi.hoisted(() => ({ opens: 0, beforeOpen: null as (() => Promise<void>) | null }))
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
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
  it("bounds plan reads while preserving valid empty files", async () => {
    const root = state.userDataPath
    state.registeredRoots.add(root)
    writeFileSync(join(root, "plan.md"), Buffer.alloc(2 * 1024 * 1024 + 1, 65))
    await expect(caller.readFile({ rootPath: root, relativePath: "plan.md" })).rejects.toThrow(
      "2 MiB",
    )
    writeFileSync(join(root, "plan.md"), "")
    await expect(caller.readFile({ rootPath: root, relativePath: "plan.md" })).resolves.toBe("")
  })
  it("streams a thousand-file directory within the existing scan budget and reuses its cache", async () => {
    const root = state.userDataPath
    state.registeredRoots.add(root)
    setBetaFeatureEnabled("streamedFileSearch", true)
    for (let index = 0; index < 1000; index += 1) writeFileSync(join(root, `file-${index}.ts`), "")
    const events: WorkspaceFileSearchEvent[] = []
    const stream = await caller.searchStream({
      requestId: randomUUID(),
      projectPath: root,
      limit: 500,
    })
    await new Promise<void>((resolve, reject) => {
      stream.subscribe({ next: (event) => events.push(event), complete: resolve, error: reject })
    })
    expect(events.at(-1)).toMatchObject({ status: "complete" })
    expect(events.every((event) => event.status !== "error")).toBe(true)
    expect(events.filter((event) => event.status === "partial").length).toBeLessThanOrEqual(101)
    expect(await caller.search({ projectPath: root, query: "file-999" })).toHaveLength(1)
    expect(scanState.opens).toBe(1)
  }, 15_000)

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

  it("bounds concurrent stream consumers and releases their slots", async () => {
    const root = state.userDataPath
    state.registeredRoots.add(root)
    setBetaFeatureEnabled("streamedFileSearch", true)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    scanState.beforeOpen = () => gate
    const subscriptions: Array<{ unsubscribe: () => void }> = []
    const errors: WorkspaceFileSearchEvent[] = []
    try {
      for (let index = 0; index < 21; index++) {
        const stream = await caller.searchStream({ requestId: randomUUID(), projectPath: root })
        subscriptions.push(
          stream.subscribe({
            next: (event) => {
              if (event.status === "error") errors.push(event)
            },
          }),
        )
      }
      expect(errors).toHaveLength(1)
      expect(JSON.stringify(errors)).toContain("Too many")
    } finally {
      for (const subscription of subscriptions) subscription.unsubscribe()
      release()
    }
    scanState.beforeOpen = null
    const events: WorkspaceFileSearchEvent[] = []
    const stream = await caller.searchStream({ requestId: randomUUID(), projectPath: root })
    const subscription = stream.subscribe({ next: (event) => events.push(event) })
    try {
      await vi.waitFor(() => expect(events.at(-1)?.status).toBe("complete"))
    } finally {
      subscription.unsubscribe()
    }
  })

  it("keeps streamed discovery disabled until explicitly enabled", async () => {
    await expect(
      caller.searchStream({ requestId: randomUUID(), projectPath: state.userDataPath }),
    ).rejects.toThrow("Enable streamedFileSearch")
  })

  it("streams partial results before completion while sharing a legacy query scan", async () => {
    const root = state.userDataPath
    state.registeredRoots.add(root)
    setBetaFeatureEnabled("streamedFileSearch", true)
    mkdirSync(join(root, "nested"))
    writeFileSync(join(root, "nested", "two.ts"), "two")
    writeFileSync(join(root, "one.ts"), "one")
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    scanState.beforeOpen = () => (scanState.opens === 2 ? gate : Promise.resolve())
    const events: WorkspaceFileSearchEvent[] = []
    const requestId = randomUUID()
    const stream = await caller.searchStream({ requestId, projectPath: root, query: "" })
    const subscription = stream.subscribe({ next: (event) => events.push(event) })
    try {
      await vi.waitFor(() => expect(events.some((event) => event.status === "partial")).toBe(true))
      expect(events.some((event) => event.status === "complete")).toBe(false)
      const legacy = caller.search({ projectPath: root, query: ".ts" })
      release()
      expect(await legacy).toHaveLength(2)
      await vi.waitFor(() => expect(events.at(-1)?.status).toBe("complete"))
      expect(events.every((event) => event.requestId === requestId)).toBe(true)
      expect(scanState.opens).toBe(2)
    } finally {
      release()
      subscription.unsubscribe()
    }
  })

  it("does not report success after a streamed scan fails and permits retry", async () => {
    const root = state.userDataPath
    state.registeredRoots.add(root)
    setBetaFeatureEnabled("streamedFileSearch", true)
    scanState.beforeOpen = async () => {
      throw new Error("EACCES private path")
    }
    const events: WorkspaceFileSearchEvent[] = []
    const stream = await caller.searchStream({ requestId: randomUUID(), projectPath: root })
    const subscription = stream.subscribe({ next: (event) => events.push(event) })
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe("error"))
    expect(JSON.stringify(events)).not.toContain("private path")
    expect(events.some((event) => event.status === "complete")).toBe(false)
    subscription.unsubscribe()
    scanState.beforeOpen = null
    expect(await caller.search({ projectPath: root, query: ".ts" })).toEqual([])
  })

  it("unsubscribes superseded streams without cancelling surviving consumers", async () => {
    const root = state.userDataPath
    state.registeredRoots.add(root)
    setBetaFeatureEnabled("streamedFileSearch", true)
    writeFileSync(join(root, "one.ts"), "one")
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    scanState.beforeOpen = () => gate
    const events: WorkspaceFileSearchEvent[] = []
    const stream = await caller.searchStream({ requestId: randomUUID(), projectPath: root })
    const subscription = stream.subscribe({ next: (event) => events.push(event) })
    const survivor = caller.search({ projectPath: root, query: ".ts" })
    try {
      await vi.waitFor(() => expect(scanState.opens).toBe(1))
      subscription.unsubscribe()
      release()
      expect(await survivor).toHaveLength(1)
      expect(events).toEqual([])
      expect(scanState.opens).toBe(1)
    } finally {
      release()
      subscription.unsubscribe()
    }
  })

  it("reports an unregistered search root instead of a successful empty search", async () => {
    await expect(caller.search({ projectPath: state.userDataPath, query: "" })).rejects.toThrow(
      "unregistered root",
    )
  })

  it("shares one scan across concurrent queries and invalidates cached results", async () => {
    const root = state.userDataPath
    state.registeredRoots.add(root)
    writeFileSync(join(root, "one.ts"), "one")
    const results = await Promise.all([
      caller.search({ projectPath: root, query: "one" }),
      caller.search({ projectPath: root, query: ".ts" }),
    ])
    expect(results.map((result) => result[0].label)).toEqual(["one.ts", "one.ts"])
    expect(scanState.opens).toBe(1)
    writeFileSync(join(root, "two.ts"), "two")
    await caller.clearCache({ projectPath: root })
    expect(await caller.search({ projectPath: root, query: "two" })).toHaveLength(1)
    expect(scanState.opens).toBe(2)
  })

  it("cancels one query without cancelling a shared scan still needed by another", async () => {
    const root = state.userDataPath
    state.registeredRoots.add(root)
    writeFileSync(join(root, "one.ts"), "one")
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    scanState.beforeOpen = () => gate
    const controller = new AbortController()
    const cancelledCaller = filesRouter.createCaller(
      { getWindow: () => null },
      { signal: controller.signal },
    )
    const cancelled = cancelledCaller.search({ projectPath: root, query: "" })
    const rejected = expect(cancelled).rejects.toThrow()
    const survivor = caller.search({ projectPath: root, query: "" })
    await vi.waitFor(() => expect(scanState.opens).toBe(1))
    controller.abort()
    await rejected
    release()
    expect(await survivor).toHaveLength(1)
    expect(scanState.opens).toBe(1)
  })

  it("reports excessive depth rather than caching incomplete results", async () => {
    const root = state.userDataPath
    state.registeredRoots.add(root)
    mkdirSync(join(root, ...Array.from({ length: 17 }, () => "d")), { recursive: true })
    await expect(caller.search({ projectPath: root, query: "" })).rejects.toThrow("depth limit")
  })

  it("does not cache a failed scan and permits a fresh retry", async () => {
    const root = state.userDataPath
    state.registeredRoots.add(root)
    writeFileSync(join(root, "one.ts"), "one")
    scanState.beforeOpen = async () => {
      throw new Error("EACCES: unreadable directory")
    }
    await expect(caller.search({ projectPath: root, query: "" })).rejects.toThrow("EACCES")
    scanState.beforeOpen = null
    expect(await caller.search({ projectPath: root, query: "" })).toHaveLength(1)
    expect(scanState.opens).toBe(2)
  })

  it("releases a cancelled scan so a new query starts fresh", async () => {
    const root = state.userDataPath
    state.registeredRoots.add(root)
    writeFileSync(join(root, "one.ts"), "one")
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    scanState.beforeOpen = () => gate
    const controller = new AbortController()
    const cancelledCaller = filesRouter.createCaller(
      { getWindow: () => null },
      { signal: controller.signal },
    )
    const cancelled = expect(
      cancelledCaller.search({ projectPath: root, query: "" }),
    ).rejects.toThrow()
    try {
      await vi.waitFor(() => expect(scanState.opens).toBe(1))
      controller.abort()
      await cancelled
    } finally {
      release()
      scanState.beforeOpen = null
    }
    expect(await caller.search({ projectPath: root, query: "" })).toHaveLength(1)
    expect(scanState.opens).toBe(2)
  })
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
