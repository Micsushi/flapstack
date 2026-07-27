import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildSingleInstanceLaunchData,
  clearPendingLaunchDirectoriesForTests,
  dispatchSecondInstanceLaunch,
  queueLaunchDirectoryFromArgv,
  resolveLaunchDirectoryFromArgv,
  takePendingLaunchDirectory,
} from "../src/main/lib/cli-launch"
import { CLI_OPEN_DIRECTORY_CHANNEL } from "../src/shared/cli-launch"

describe("CLI launch-directory handling", () => {
  beforeEach(() => clearPendingLaunchDirectoriesForTests())

  it("canonicalizes cold packaged and development argv with spaces and Unicode", () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack CLI launch "))
    const project = join(root, "spaced 日本語 project")
    mkdirSync(project)

    expect(
      resolveLaunchDirectoryFromArgv(["Flapstack.exe", "--no-focus", project], {
        defaultApp: false,
      }),
    ).toBe(realpathSync(project))
    expect(
      resolveLaunchDirectoryFromArgv(["electron.exe", "app-entry", project], {
        defaultApp: true,
      }),
    ).toBe(realpathSync(project))
  })

  it("rejects missing paths and files without queuing them", () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-cli-invalid-"))
    const file = join(root, "not-a-directory.txt")
    writeFileSync(file, "no")

    expect(
      queueLaunchDirectoryFromArgv(["Flapstack.exe", join(root, "missing")], {
        defaultApp: false,
      }),
    ).toBeNull()
    expect(queueLaunchDirectoryFromArgv(["Flapstack.exe", file], { defaultApp: false })).toBeNull()
    expect(takePendingLaunchDirectory()).toBeNull()
  })

  it("retains cold launch directories until the renderer consumes them", () => {
    const project = mkdtempSync(join(tmpdir(), "flapstack-cli-cold-"))

    expect(queueLaunchDirectoryFromArgv(["Flapstack.exe", project], { defaultApp: false })).toBe(
      realpathSync(project),
    )
    expect(takePendingLaunchDirectory()).toBe(realpathSync(project))
    expect(takePendingLaunchDirectory()).toBeNull()
  })

  it("queues and signals a warm launch before activating the existing window", () => {
    const project = mkdtempSync(join(tmpdir(), "flapstack-cli-warm-"))
    const calls: string[] = []
    const window = {
      isMinimized: () => true,
      restore: vi.fn(() => calls.push("restore")),
      focus: vi.fn(() => calls.push("focus")),
      webContents: {
        send: vi.fn((channel: string) => calls.push(`send:${channel}`)),
      },
    }

    expect(
      dispatchSecondInstanceLaunch({
        commandLine: ["Flapstack.exe", project],
        defaultApp: false,
        additionalData: {},
        windows: [window],
        createWindow: vi.fn(),
      }),
    ).toMatchObject({ directory: realpathSync(project), activated: true })
    expect(calls).toEqual([`send:${CLI_OPEN_DIRECTORY_CHANNEL}`, "restore", "focus"])
    expect(takePendingLaunchDirectory()).toBe(realpathSync(project))
  })

  it.each([
    [{ FLAPSTACK_NO_FOCUS: "1" }, []],
    [{ FLAPSTACK_START_MINIMIZED: "1" }, []],
    [{}, ["--no-focus"]],
    [{}, ["--start-minimized"]],
  ])("does not activate a warm automation launch for env %o and argv %o", (env, flags) => {
    const project = mkdtempSync(join(tmpdir(), "flapstack-cli-background-"))
    const window = {
      isMinimized: () => true,
      restore: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() },
    }
    const additionalData = buildSingleInstanceLaunchData(["Flapstack.exe", ...flags, project], env)

    expect(
      dispatchSecondInstanceLaunch({
        commandLine: ["Flapstack.exe", ...flags, project],
        defaultApp: false,
        additionalData,
        windows: [window],
        createWindow: vi.fn(),
      }),
    ).toMatchObject({ directory: realpathSync(project), activated: false })
    expect(window.webContents.send).toHaveBeenCalledWith(CLI_OPEN_DIRECTORY_CHANNEL)
    expect(window.restore).not.toHaveBeenCalled()
    expect(window.focus).not.toHaveBeenCalled()
  })

  it("honors a warm no-focus flag even when Electron omits additional data", () => {
    const project = mkdtempSync(join(tmpdir(), "flapstack-cli-no-payload-"))
    const window = {
      isMinimized: () => true,
      restore: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() },
    }

    expect(
      dispatchSecondInstanceLaunch({
        commandLine: ["Flapstack.exe", "--no-focus", project],
        defaultApp: false,
        windows: [window],
        createWindow: vi.fn(),
      }),
    ).toMatchObject({ directory: realpathSync(project), activated: false })
    expect(window.restore).not.toHaveBeenCalled()
    expect(window.focus).not.toHaveBeenCalled()
  })
})
