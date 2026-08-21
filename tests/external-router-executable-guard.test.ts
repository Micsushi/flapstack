import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  userDataPath: "/tmp/flapstack-external-initial",
  revealed: [] as string[],
  openedWithDefaultHandler: [] as string[],
  spawned: [] as Array<{ command: string; args: string[] }>,
  editorLookupSucceeds: true,
}))

vi.mock("electron", () => ({
  app: { getPath: () => state.userDataPath, isPackaged: false },
  clipboard: { writeText: () => {} },
  shell: {
    showItemInFolder: (path: string) => {
      state.revealed.push(path)
    },
    openPath: async (path: string) => {
      state.openedWithDefaultHandler.push(path)
      return ""
    },
  },
}))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return {
    ...actual,
    execFileSync: (...args: unknown[]) => {
      if (!state.editorLookupSucceeds) throw new Error("editor not installed")
      return Buffer.from(String(args[0]))
    },
  }
})

vi.mock("../src/main/lib/external/app-launch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/lib/external/app-launch")>()
  return {
    ...actual,
    spawnExternalCommand: async (
      _platform: NodeJS.Platform,
      command: string,
      args: string[],
    ): Promise<void> => {
      state.spawned.push({ command, args })
    },
  }
})

import { closeDatabase } from "../src/main/lib/db"
import * as schema from "../src/main/lib/db/schema"
import {
  bindRegisteredFilesystemRoot,
  PathValidationError,
} from "../src/main/lib/git/security/path-validation"
import {
  externalRouter,
  openWithDefaultHandler,
  resolveRegisteredExternalTarget,
} from "../src/main/lib/trpc/routers/external"

let container = ""
let worktreePath = ""
let outsideScriptPath = ""
const caller = externalRouter.createCaller({ getWindow: () => null })

/** Tracked, non-executed source files that the editor and reveal paths must allow. */
const SCRIPT_SOURCES = ["build.cmd", "deploy.ps1", "setup.bat"] as const

function scriptPath(name: string): string {
  return join(worktreePath, name)
}

beforeEach(() => {
  container = mkdtempSync(join(tmpdir(), "flapstack-external-guard-"))
  state.userDataPath = join(container, "user-data")
  state.revealed = []
  state.openedWithDefaultHandler = []
  state.spawned = []
  state.editorLookupSucceeds = true
  worktreePath = join(container, "worktree")
  mkdirSync(state.userDataPath)
  mkdirSync(worktreePath)
  for (const name of SCRIPT_SOURCES) writeFileSync(scriptPath(name), "echo tracked source\n")
  writeFileSync(join(worktreePath, "index.ts"), "export {}\n")
  outsideScriptPath = join(container, "outside.ps1")
  writeFileSync(outsideScriptPath, "outside\n")

  const databasePath = join(state.userDataPath, "agents.db")
  const sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
    .run("project-1", "Project", worktreePath)
  sqlite.close()
  process.env.FLAPSTACK_DB_PATH = databasePath
  bindRegisteredFilesystemRoot(worktreePath)
})

afterEach(() => {
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  rmSync(container, { recursive: true, force: true })
})

describe("external executable guard", () => {
  it("opens tracked script sources in an editor without any default-handler dispatch", async () => {
    for (const name of SCRIPT_SOURCES) {
      state.spawned = []
      await expect(caller.openFileInEditor({ path: scriptPath(name) })).resolves.toMatchObject({
        success: true,
      })
      expect(state.spawned).toHaveLength(1)
      expect(state.spawned[0].args.join(" ")).toContain(name)
    }
    expect(state.openedWithDefaultHandler).toEqual([])
  })

  it("reveals tracked script sources in the platform file manager", async () => {
    for (const name of SCRIPT_SOURCES) {
      await expect(caller.openInFinder(scriptPath(name))).resolves.toEqual({ success: true })
      await expect(caller.openInApp({ path: scriptPath(name), app: "finder" })).resolves.toEqual({
        success: true,
      })
    }
    expect(state.revealed).toHaveLength(SCRIPT_SOURCES.length * 2)
    for (const name of SCRIPT_SOURCES) {
      expect(state.revealed.filter((path) => path.endsWith(name))).toHaveLength(2)
    }
    expect(state.openedWithDefaultHandler).toEqual([])
  })

  it("still refuses to hand executables to the OS default handler", async () => {
    for (const name of [...SCRIPT_SOURCES, "installer.msi", "tool.exe", "shortcut.lnk"]) {
      await expect(openWithDefaultHandler(scriptPath(name))).rejects.toThrow(
        /cannot be opened with the system default application/,
      )
    }
    expect(state.openedWithDefaultHandler).toEqual([])

    await expect(openWithDefaultHandler(join(worktreePath, "index.ts"))).resolves.toBeUndefined()
    expect(state.openedWithDefaultHandler).toEqual([join(worktreePath, "index.ts")])
  })

  it("rejects the editor default-handler fallback for executables but allows plain sources", async () => {
    state.editorLookupSucceeds = false

    await expect(caller.openFileInEditor({ path: scriptPath("deploy.ps1") })).rejects.toThrow(
      /cannot be opened with the system default application/,
    )
    expect(state.spawned).toEqual([])
    expect(state.openedWithDefaultHandler).toEqual([])

    await expect(
      caller.openFileInEditor({ path: join(worktreePath, "index.ts") }),
    ).resolves.toMatchObject({ success: true, editor: "default" })
    expect(state.openedWithDefaultHandler).toEqual([join(worktreePath, "index.ts")])
  })

  it("keeps every path confined to registered project roots", async () => {
    await expect(caller.openFileInEditor({ path: outsideScriptPath })).rejects.toThrow(
      /outside registered project roots/,
    )
    await expect(caller.openInFinder(outsideScriptPath)).rejects.toThrow(
      /outside registered project roots/,
    )
    expect(state.revealed).toEqual([])
    expect(state.spawned).toEqual([])
  })

  it("normalizes a missing parent into a path validation error", () => {
    expect(() =>
      resolveRegisteredExternalTarget(join(worktreePath, "missing-parent", "file.txt")),
    ).toThrowError(PathValidationError)
    try {
      resolveRegisteredExternalTarget(join(worktreePath, "missing-parent", "file.txt"))
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_TARGET" })
    }
  })
})
