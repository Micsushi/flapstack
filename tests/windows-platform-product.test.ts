import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  WindowsPlatformProvider,
  renderWindowsCliLauncher,
  windowsCliManagementSupported,
  windowsPathContains,
  windowsUserPathScript,
} from "../src/main/lib/platform/windows"

describe("Windows product platform behavior", () => {
  it("uses Windows PowerShell by default instead of COMSPEC", () => {
    const previousComspec = process.env.COMSPEC
    process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe"
    try {
      const provider = new WindowsPlatformProvider()
      expect(provider.getDefaultShell()).toMatch(/powershell\.exe$/i)
      expect(provider.getShellConfig()).toMatchObject({
        executable: expect.stringMatching(/powershell\.exe$/i),
      })
      expect(provider.getShellConfig().execArgs("Write-Output ok")).toEqual([
        "-NoLogo",
        "-NoProfile",
        "-Command",
        "Write-Output ok",
      ])
    } finally {
      if (previousComspec === undefined) delete process.env.COMSPEC
      else process.env.COMSPEC = previousComspec
    }
  })

  it("rejects a relative SystemRoot for privileged environment changes", () => {
    const previousSystemRoot = process.env.SystemRoot
    const previousWindir = process.env.WINDIR
    process.env.SystemRoot = ".\\untrusted-project"
    delete process.env.WINDIR
    try {
      expect(new WindowsPlatformProvider().getShellConfig().executable).toBe(
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      )
    } finally {
      if (previousSystemRoot === undefined) delete process.env.SystemRoot
      else process.env.SystemRoot = previousSystemRoot
      if (previousWindir === undefined) delete process.env.WINDIR
      else process.env.WINDIR = previousWindir
    }
  })

  it("renders a launcher bound to the actual packaged executable", () => {
    const launcher = renderWindowsCliLauncher(
      "@echo off\r\npowershell.exe -EncodedCommand __FLAPSTACK_ENCODED_COMMAND__\r\n",
      "C:\\Program Files\\Flapstack ü\\Flapstack.exe",
    )
    expect(launcher).not.toContain("Flapstack ü")
    expect(launcher).not.toContain("__FLAPSTACK_ENCODED_COMMAND__")
    expect(launcher).toMatch(/^[\x00-\x7f]*$/)
  })

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
      writeFileSync(executable, '@echo off\r\n> "%~1\\launched.txt" echo launched\r\n', "ascii")
      const template = readFileSync(
        join(process.cwd(), "resources", "cli", "flapstack.cmd"),
        "utf8",
      )
      writeFileSync(launcher, renderWindowsCliLauncher(template, executable), "ascii")

      try {
        const result = spawnSync(
          process.env.COMSPEC ?? "C:\\Windows\\System32\\cmd.exe",
          ["/d", "/s", "/c", `""${launcher}" "${selectedDirectory}""`],
          { encoding: "utf8", windowsVerbatimArguments: true },
        )
        expect(result.status, result.stderr || result.stdout).toBe(0)
        for (let attempt = 0; attempt < 50 && !existsSync(marker); attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        expect(readFileSync(marker, "utf8").trim()).toBe("launched")
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )

  it("persists and removes only the exact user CLI directory without setx", () => {
    const marker = "C:\\Users\\Sushi\\.local\\bin\\.flapstack-path-added"
    const addScript = windowsUserPathScript("add", "C:\\Users\\Sushi\\.local\\bin", marker)
    const removeScript = windowsUserPathScript("remove", "C:\\Users\\Sushi\\.local\\bin")

    expect(addScript).toContain("[Environment]::SetEnvironmentVariable")
    expect(addScript).toContain("OrdinalIgnoreCase")
    expect(addScript).toContain(marker)
    expect(addScript.indexOf("Set-Content")).toBeLessThan(
      addScript.indexOf("[Environment]::SetEnvironmentVariable"),
    )
    expect(addScript).not.toMatch(/\bsetx\b/i)
    expect(removeScript).toContain("[Environment]::SetEnvironmentVariable")
    expect(removeScript).toContain("OrdinalIgnoreCase")
    expect(addScript).toContain("SendMessageTimeout")
    expect(addScript).toContain("'Environment'")
    expect(removeScript).toContain("SendMessageTimeout")
  })

  it("recognizes an installed CLI PATH entry with a trailing separator", () => {
    expect(
      windowsPathContains(
        "C:\\Users\\Sushi\\.local\\bin",
        "C:\\Windows;C:\\Users\\Sushi\\.local\\bin\\",
      ),
    ).toBe(true)
  })

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

  it("refuses to install an Electron development launcher that cannot reopen the app", async () => {
    const home = mkdtempSync(join(tmpdir(), "flapstack-cli-dev-home-"))
    const source = join(home, "flapstack.cmd")
    writeFileSync(source, "__FLAPSTACK_EXECUTABLE__", "utf8")
    const previousDefaultApp = process.defaultApp
    process.defaultApp = true
    try {
      class TestWindowsProvider extends WindowsPlatformProvider {
        protected override getHome(): string {
          return home
        }
      }
      const provider = new TestWindowsProvider()
      await expect(provider.installCli(source)).resolves.toEqual({
        success: false,
        error: "Install the flapstack command from a packaged app build.",
      })
      expect(existsSync(join(home, ".local", "bin", "flapstack.cmd"))).toBe(false)
    } finally {
      process.defaultApp = previousDefaultApp
    }
  })

  it("repairs an interrupted uninstall when the launcher is already missing", async () => {
    const home = mkdtempSync(join(tmpdir(), "flapstack-cli-recovery-"))
    const installDirectory = join(home, ".local", "bin")
    mkdirSync(installDirectory, { recursive: true })
    writeFileSync(join(installDirectory, ".flapstack-path-added"), "added\n", "utf8")

    class TestWindowsProvider extends WindowsPlatformProvider {
      removedPath = false
      protected override getHome(): string {
        return home
      }
      override async execCommand() {
        this.removedPath = true
        return { stdout: "removed\r\n", stderr: "" }
      }
    }

    const provider = new TestWindowsProvider()
    await expect(provider.uninstallCli()).resolves.toEqual({ success: true })
    expect(provider.removedPath).toBe(true)
    expect(existsSync(join(installDirectory, ".flapstack-path-added"))).toBe(false)
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
