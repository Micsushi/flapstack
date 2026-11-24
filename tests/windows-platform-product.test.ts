import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  WindowsPlatformProvider,
  renderWindowsCliLauncher,
  windowsCliManagementSupported,
} from "../src/main/lib/platform/windows"

async function removeDirectoryWithRetry(directory: string): Promise<void> {
  let cleanupError: unknown
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      rmSync(directory, { recursive: true, force: true })
      return
    } catch (error) {
      cleanupError = error
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  throw cleanupError
}

describe("Windows product platform behavior", () => {
  it("allows only packaged production to manage the production CLI", () => {
    expect(
      windowsCliManagementSupported({
        defaultApp: false,
        executablePath: "C:\\Program Files\\Flapstack\\Flapstack.exe",
      }),
    ).toBe(true)
    expect(
      windowsCliManagementSupported({
        defaultApp: false,
        executablePath: "C:\\Program Files\\Flapstack Preview\\Flapstack Preview.exe",
      }),
    ).toBe(false)
    expect(
      windowsCliManagementSupported({
        defaultApp: true,
        executablePath: "C:\\repo\\node_modules\\electron\\dist\\electron.exe",
      }),
    ).toBe(false)
  })

  it.runIf(process.platform === "win32")(
    "executes an ASCII launcher with Unicode executable and directory paths through cmd.exe",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "flapstack-cli-Unicode-雪-"))
      const executableDirectory = join(root, "app ü")
      const selectedDirectory = join(root, "project 雪 & spaces")
      const executable = join(executableDirectory, "capture.cmd")
      const launcher = join(root, "flapstack.cmd")
      const marker = join(selectedDirectory, "launched.txt")
      mkdirSync(executableDirectory, { recursive: true })
      mkdirSync(selectedDirectory, { recursive: true })
      writeFileSync(
        executable,
        ["@echo off", '> "%~1\\launched.txt" echo launched', "exit /b 0", ""].join("\r\n"),
        "ascii",
      )
      const template = readFileSync(
        join(process.cwd(), "resources", "cli", "flapstack.cmd"),
        "utf8",
      )
      writeFileSync(launcher, renderWindowsCliLauncher(template, executable), "ascii")

      try {
        const result = spawnSync(
          process.env.COMSPEC ?? "C:\\Windows\\System32\\cmd.exe",
          ["/d", "/s", "/c", `""${launcher}" "${selectedDirectory}""`],
          {
            encoding: "utf8",
            windowsHide: true,
            windowsVerbatimArguments: true,
          },
        )
        expect(result.status, result.stderr || result.stdout).toBe(0)
        // cmd creates the redirected file before echo writes its completion marker.
        for (let attempt = 0; attempt < 50; attempt += 1) {
          if (existsSync(marker) && readFileSync(marker, "utf8").trim() === "launched") break
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        expect(readFileSync(marker, "utf8").trim()).toBe("launched")
      } finally {
        await removeDirectoryWithRetry(root)
      }
    },
  )

  it("installs an executable-bound launcher only after persisting its user PATH", async () => {
    const home = mkdtempSync(join(tmpdir(), "flapstack-cli-home-"))
    const source = join(home, "flapstack.cmd")
    writeFileSync(
      source,
      "@echo off\r\npowershell.exe -EncodedCommand __FLAPSTACK_ENCODED_COMMAND__\r\n",
      "utf8",
    )
    const previousPath = process.env.PATH

    class TestWindowsProvider extends WindowsPlatformProvider {
      readonly commands: string[][] = []
      protected override getHome(): string {
        return home
      }
      override async execCommand(command: string, args: string[]) {
        this.commands.push([command, ...args])
        return { stdout: this.commands.length === 1 ? "added\r\n" : "removed\r\n", stderr: "" }
      }
    }

    try {
      const provider = new TestWindowsProvider()
      await expect(provider.installCli(source)).resolves.toEqual({ success: true })
      const installed = join(home, ".local", "bin", "flapstack.cmd")
      expect(readFileSync(installed, "utf8")).toMatch(/^[\x00-\x7f]*$/)
      expect(readFileSync(installed, "utf8")).not.toContain(process.execPath)
      expect(existsSync(join(home, ".local", "bin", ".flapstack-cli-owner"))).toBe(true)
      expect(provider.isCliInstalled(source)).toBe(true)
      expect(provider.commands[0]).toEqual([
        provider.getShellConfig().executable,
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        expect.any(String),
      ])

      await expect(provider.uninstallCli()).resolves.toEqual({ success: true })
      expect(existsSync(installed)).toBe(false)
      expect(provider.commands).toHaveLength(2)
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
    }
  })

  it("never overwrites or uninstalls an unowned flapstack launcher", async () => {
    const home = mkdtempSync(join(tmpdir(), "flapstack-cli-unowned-"))
    const installDirectory = join(home, ".local", "bin")
    const installPath = join(installDirectory, "flapstack.cmd")
    const source = join(home, "source.cmd")
    mkdirSync(installDirectory, { recursive: true })
    writeFileSync(installPath, "@echo third-party\r\n", "ascii")
    writeFileSync(source, "__FLAPSTACK_ENCODED_COMMAND__", "ascii")

    class TestWindowsProvider extends WindowsPlatformProvider {
      protected override getHome(): string {
        return home
      }
    }

    const provider = new TestWindowsProvider()
    await expect(provider.installCli(source)).resolves.toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining("not owned") }),
    )
    await expect(provider.uninstallCli()).resolves.toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining("not owned") }),
    )
    expect(readFileSync(installPath, "ascii")).toBe("@echo third-party\r\n")
  })
})
