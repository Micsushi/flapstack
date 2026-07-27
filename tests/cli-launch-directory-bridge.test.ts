import { mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearPendingLaunchDirectoriesForTests,
  dispatchSecondInstanceLaunch,
  queueLaunchDirectoryFromArgv,
  takePendingLaunchDirectory,
} from "../src/main/lib/cli-launch"
import { subscribeCliLaunchDirectories } from "../src/renderer/lib/cli-launch-directory"
import { CLI_OPEN_DIRECTORY_CHANNEL } from "../src/shared/cli-launch"

describe("CLI launch-directory renderer bridge", () => {
  beforeEach(() => clearPendingLaunchDirectoriesForTests())

  it("drains a cold launch after the renderer subscribes", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "flapstack-cli-cold-bridge-"))
    queueLaunchDirectoryFromArgv(["Flapstack.exe", projectPath], { defaultApp: false })
    const opened: string[] = []

    const unsubscribe = subscribeCliLaunchDirectories({
      subscribe: () => vi.fn(),
      openNext: async () => {
        const path = takePendingLaunchDirectory()
        return path ? { path } : null
      },
      onOpened: async (project) => {
        opened.push(project.path)
      },
      onError: vi.fn(),
    })

    await vi.waitFor(() => expect(opened).toEqual([realpathSync(projectPath)]))
    unsubscribe()
  })

  it("delivers a warm background launch from main into renderer project navigation", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "flapstack-cli-bridge-"))
    let signal: (() => void) | null = null
    const opened: string[] = []
    const unsubscribe = subscribeCliLaunchDirectories({
      subscribe: (callback) => {
        signal = callback
        return vi.fn()
      },
      openNext: async () => {
        const path = takePendingLaunchDirectory()
        return path ? { path } : null
      },
      onOpened: async (project) => {
        opened.push(project.path)
      },
      onError: vi.fn(),
    })
    const window = {
      isMinimized: () => true,
      restore: vi.fn(),
      focus: vi.fn(),
      webContents: {
        send: vi.fn((channel: string) => {
          if (channel === CLI_OPEN_DIRECTORY_CHANNEL) signal?.()
        }),
      },
    }

    dispatchSecondInstanceLaunch({
      commandLine: ["Flapstack.exe", "--no-focus", projectPath],
      defaultApp: false,
      windows: [window],
      createWindow: vi.fn(),
    })

    await vi.waitFor(() => expect(opened).toEqual([realpathSync(projectPath)]))
    expect(window.restore).not.toHaveBeenCalled()
    expect(window.focus).not.toHaveBeenCalled()
    unsubscribe()
  })

  it("continues draining queued directories after one project fails to open", async () => {
    const firstPath = mkdtempSync(join(tmpdir(), "flapstack-cli-bridge-failed-"))
    const secondPath = mkdtempSync(join(tmpdir(), "flapstack-cli-bridge-next-"))
    const queue = [{ path: firstPath }, { path: secondPath }]
    const opened: string[] = []
    const onError = vi.fn()

    const unsubscribe = subscribeCliLaunchDirectories({
      subscribe: () => vi.fn(),
      openNext: async () => queue.shift() ?? null,
      onOpened: async (project) => {
        if (project.path === firstPath) throw new Error("project open failed")
        opened.push(project.path)
      },
      onError,
    })

    await vi.waitFor(() => expect(opened).toEqual([secondPath]))
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "project open failed" }),
    )
    unsubscribe()
  })
})
