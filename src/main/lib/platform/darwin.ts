/**
 * macOS Platform Provider
 */

import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, readlinkSync } from "node:fs"
import * as path from "node:path"
import { BasePlatformProvider } from "./base"
import type { ShellConfig, PathConfig, CliConfig, EnvironmentConfig } from "./types"
import { isPreviewExecutable } from "../mcp-test-control/lifecycle"

const INSTALL_CLI_SCRIPT = [
  "on run argv",
  "set installPath to item 1 of argv",
  "set sourcePath to item 2 of argv",
  "set expectedTarget to item 3 of argv",
  String.raw`set installCommand to "set -eu; destination=" & quoted form of installPath & "; source=" & quoted form of sourcePath & "; expected=" & quoted form of expectedTarget & "; if [ -n \"$expected\" ]; then [ -L \"$destination\" ] && [ \"$(readlink \"$destination\")\" = \"$expected\" ]; else [ ! -e \"$destination\" ] && [ ! -L \"$destination\" ]; fi; /bin/rm -f \"$destination\"; /bin/ln -s \"$source\" \"$destination\""`,
  "do shell script installCommand with administrator privileges",
  "end run",
].join("\n")

const UNINSTALL_CLI_SCRIPT = [
  "on run argv",
  "set installPath to item 1 of argv",
  "set expectedTarget to item 2 of argv",
  String.raw`set uninstallCommand to "set -eu; destination=" & quoted form of installPath & "; expected=" & quoted form of expectedTarget & "; [ -L \"$destination\" ] && [ \"$(readlink \"$destination\")\" = \"$expected\" ]; /bin/rm -f \"$destination\""`,
  "do shell script uninstallCommand with administrator privileges",
  "end run",
].join("\n")

export function darwinCliManagementSupported(
  input: { defaultApp: boolean; executablePath: string } = {
    defaultApp: Boolean(process.defaultApp),
    executablePath: process.execPath,
  },
): boolean {
  return !input.defaultApp && !isPreviewExecutable(input.executablePath)
}

function installedCliTarget(installPath: string): string | null {
  try {
    if (!lstatSync(installPath).isSymbolicLink()) return null
    return readlinkSync(installPath)
  } catch {
    return null
  }
}

function resolvesToFlapstackBundle(
  installPath: string,
  target: string,
  readBundleIdentifier: (infoPlist: string) => string | null,
): boolean {
  try {
    const resolvedTarget = path.resolve(path.dirname(installPath), target)
    const cliDirectory = path.dirname(resolvedTarget)
    const resourcesDirectory = path.dirname(cliDirectory)
    const contentsDirectory = path.dirname(resourcesDirectory)
    const appBundle = path.dirname(contentsDirectory)
    const infoPlist = path.join(contentsDirectory, "Info.plist")
    if (
      path.basename(resolvedTarget) !== "flapstack" ||
      path.basename(cliDirectory) !== "cli" ||
      path.basename(resourcesDirectory) !== "Resources" ||
      path.basename(contentsDirectory) !== "Contents" ||
      path.extname(appBundle) !== ".app" ||
      !lstatSync(appBundle).isDirectory() ||
      !lstatSync(resolvedTarget).isFile() ||
      !lstatSync(infoPlist).isFile()
    ) {
      return false
    }
    return readBundleIdentifier(infoPlist) === "dev.flapstack.app"
  } catch {
    return false
  }
}

export class DarwinPlatformProvider extends BasePlatformProvider {
  readonly platform = "darwin" as const
  readonly displayName = "macOS"

  getShellConfig(): ShellConfig {
    const shell = process.env.SHELL || "/bin/zsh"

    return {
      executable: shell,
      loginArgs: ["-l"],
      execArgs: (command: string) => ["-c", command],
    }
  }

  getPathConfig(): PathConfig {
    const home = this.getHome()

    return {
      separator: ":",
      commonPaths: [
        // Homebrew (Apple Silicon)
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        // Homebrew (Intel)
        "/usr/local/bin",
        "/usr/local/sbin",
        // System
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        // MacPorts
        "/opt/local/bin",
        "/opt/local/sbin",
      ],
      localBin: path.join(home, ".local", "bin"),
      packageManagerPaths: [
        path.join(home, ".bun", "bin"),
        path.join(home, ".cargo", "bin"),
        path.join(home, ".deno", "bin"),
        // NVM managed Node.js (common pattern)
        path.join(home, ".nvm", "versions", "node", "*", "bin"),
      ],
    }
  }

  getCliConfig(): CliConfig {
    return {
      installPath: "/usr/local/bin/flapstack",
      scriptName: "flapstack",
      requiresAdmin: true, // /usr/local/bin requires admin on macOS
    }
  }

  getEnvironmentConfig(): EnvironmentConfig {
    const home = this.getHome()

    return {
      homeVar: "HOME",
      userVar: "USER",
      additionalVars: {
        TMPDIR: process.env.TMPDIR || "/tmp",
        __CF_USER_TEXT_ENCODING: process.env.__CF_USER_TEXT_ENCODING || "",
      },
    }
  }

  override getDefaultShell(): string {
    return process.env.SHELL || "/bin/zsh"
  }

  protected readBundleIdentifier(infoPlist: string): string | null {
    try {
      return execFileSync("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", infoPlist], {
        encoding: "utf8",
        windowsHide: true,
      }).trim()
    } catch {
      return null
    }
  }

  override async detectShell(): Promise<string> {
    // Try SHELL env var first (most reliable)
    if (process.env.SHELL) {
      return process.env.SHELL
    }

    // Try to get from Directory Services
    try {
      const { stdout } = await this.execCommand("sh", [
        "-c",
        `dscl . -read /Users/$(whoami) UserShell 2>/dev/null`,
      ])
      const match = stdout.match(/UserShell:\s*(.+)/)
      if (match?.[1]) {
        return match[1].trim()
      }
    } catch {
      // Ignore errors
    }

    return "/bin/zsh"
  }

  override async detectLocale(): Promise<string> {
    // Check environment first
    if (process.env.LANG?.includes("UTF-8")) {
      return process.env.LANG
    }
    if (process.env.LC_ALL?.includes("UTF-8")) {
      return process.env.LC_ALL
    }

    // Try to get from locale command
    try {
      const { stdout } = await this.execCommand("sh", [
        "-c",
        "locale 2>/dev/null | grep LANG= | cut -d= -f2",
      ])
      const trimmed = stdout.trim()
      if (trimmed?.includes("UTF-8")) {
        return trimmed
      }
    } catch {
      // Ignore errors
    }

    return "en_US.UTF-8"
  }

  async installCli(sourcePath: string): Promise<{ success: boolean; error?: string }> {
    if (!darwinCliManagementSupported()) {
      return {
        success: false,
        error: process.defaultApp
          ? "Install the flapstack command from a packaged app build."
          : "Flapstack Preview cannot install or replace the production flapstack command.",
      }
    }
    const cliConfig = this.getCliConfig()
    const installPath = cliConfig.installPath

    if (!existsSync(sourcePath)) {
      return { success: false, error: "CLI script not found in app bundle" }
    }

    try {
      const currentTarget = installedCliTarget(installPath)
      if (
        (existsSync(installPath) || currentTarget !== null) &&
        (currentTarget === null ||
          !resolvesToFlapstackBundle(installPath, currentTarget, (plist) =>
            this.readBundleIdentifier(plist),
          ))
      ) {
        return {
          success: false,
          error: "The flapstack command already exists and is not owned by this app.",
        }
      }

      await this.execCommand(
        "/usr/bin/osascript",
        ["-e", INSTALL_CLI_SCRIPT, "--", installPath, sourcePath, currentTarget ?? ""],
        { timeout: 120_000 },
      )

      console.log("[CLI] Installed flapstack command to", installPath)
      return { success: true }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Installation failed"
      console.error("[CLI] Failed to install:", error)
      return { success: false, error: errorMessage }
    }
  }

  async uninstallCli(): Promise<{ success: boolean; error?: string }> {
    if (!darwinCliManagementSupported()) {
      return {
        success: false,
        error: "Flapstack Preview cannot uninstall the production flapstack command.",
      }
    }
    const cliConfig = this.getCliConfig()
    const installPath = cliConfig.installPath

    try {
      const currentTarget = installedCliTarget(installPath)
      if (!existsSync(installPath) && currentTarget === null) {
        console.log("[CLI] CLI command not installed, nothing to uninstall")
        return { success: true }
      }
      if (
        currentTarget === null ||
        !resolvesToFlapstackBundle(installPath, currentTarget, (plist) =>
          this.readBundleIdentifier(plist),
        )
      ) {
        return {
          success: false,
          error: "The flapstack command is not owned by this app and was not removed.",
        }
      }

      await this.execCommand(
        "/usr/bin/osascript",
        ["-e", UNINSTALL_CLI_SCRIPT, "--", installPath, currentTarget],
        { timeout: 120_000 },
      )

      console.log("[CLI] Uninstalled flapstack command")
      return { success: true }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Uninstallation failed"
      console.error("[CLI] Failed to uninstall:", error)
      return { success: false, error: errorMessage }
    }
  }

  isCliInstalled(sourcePath: string): boolean {
    if (!darwinCliManagementSupported()) return false
    const cliConfig = this.getCliConfig()
    try {
      const target = installedCliTarget(cliConfig.installPath)
      if (target === null) return false
      return path.resolve(path.dirname(cliConfig.installPath), target) === path.resolve(sourcePath)
    } catch {
      return false
    }
  }
}
