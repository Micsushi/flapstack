/**
 * Linux Platform Provider
 */

import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs"
import * as path from "node:path"
import { BasePlatformProvider } from "./base"
import type { ShellConfig, PathConfig, CliConfig, EnvironmentConfig } from "./types"
import { isPreviewExecutable } from "../mcp-test-control/lifecycle"

export function linuxCliManagementSupported(
  input: { defaultApp: boolean; executablePath: string } = {
    defaultApp: Boolean(process.defaultApp),
    executablePath: process.execPath,
  },
): boolean {
  return !input.defaultApp && !isPreviewExecutable(input.executablePath)
}

function installedCliTarget(installPath: string): string | null {
  try {
    return lstatSync(installPath).isSymbolicLink() ? readlinkSync(installPath) : null
  } catch {
    return null
  }
}

function expectedCliTarget(sourcePath: string): string {
  const appImage = process.env.APPIMAGE
  return appImage && path.isAbsolute(appImage) && existsSync(appImage) ? appImage : sourcePath
}

function isFlapstackCliTarget(target: string): boolean {
  const normalized = path.resolve(target)
  if (process.env.APPIMAGE && normalized === path.resolve(process.env.APPIMAGE)) return true
  return (
    path.basename(normalized) === "flapstack" &&
    path.basename(path.dirname(normalized)) === "cli" &&
    path.basename(path.dirname(path.dirname(normalized))) === "resources"
  )
}

export class LinuxPlatformProvider extends BasePlatformProvider {
  readonly platform = "linux" as const
  readonly displayName = "Linux"

  getShellConfig(): ShellConfig {
    const shell = process.env.SHELL || "/bin/bash"

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
        // System paths
        "/usr/local/bin",
        "/usr/local/sbin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        // Snap packages
        "/snap/bin",
        // Flatpak exports
        "/var/lib/flatpak/exports/bin",
        path.join(home, ".local", "share", "flatpak", "exports", "bin"),
      ],
      localBin: path.join(home, ".local", "bin"),
      packageManagerPaths: [
        path.join(home, ".bun", "bin"),
        path.join(home, ".cargo", "bin"),
        path.join(home, ".deno", "bin"),
        // NVM managed Node.js
        path.join(home, ".nvm", "versions", "node", "*", "bin"),
        // ASDF version manager
        path.join(home, ".asdf", "shims"),
        // Linuxbrew
        path.join(home, ".linuxbrew", "bin"),
        "/home/linuxbrew/.linuxbrew/bin",
      ],
    }
  }

  getCliConfig(): CliConfig {
    const home = this.getHome()
    return {
      installPath: path.join(home, ".local", "bin", "flapstack"),
      scriptName: "flapstack",
      requiresAdmin: false,
    }
  }

  getEnvironmentConfig(): EnvironmentConfig {
    const home = this.getHome()

    return {
      homeVar: "HOME",
      userVar: "USER",
      additionalVars: {
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
        XDG_DATA_HOME: process.env.XDG_DATA_HOME || path.join(home, ".local", "share"),
        XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || path.join(home, ".cache"),
        XDG_STATE_HOME: process.env.XDG_STATE_HOME || path.join(home, ".local", "state"),
      },
    }
  }

  override getDefaultShell(): string {
    return process.env.SHELL || "/bin/bash"
  }

  override async detectShell(): Promise<string> {
    // Try SHELL env var first
    if (process.env.SHELL) {
      return process.env.SHELL
    }

    // Try to get from /etc/passwd via getent
    try {
      const uid = process.getuid?.()
      if (uid !== undefined) {
        const { stdout } = await this.execCommand("sh", ["-c", `getent passwd ${uid} 2>/dev/null`])
        // getent format: user:x:uid:gid:name:home:shell
        const match = stdout.match(/:([^:]+)$/)
        if (match?.[1]) {
          return match[1].trim()
        }
      }
    } catch {
      // Ignore errors
    }

    return "/bin/bash"
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
    if (!linuxCliManagementSupported()) {
      return {
        success: false,
        error: process.defaultApp
          ? "Install the flapstack command from a packaged app build."
          : "Flapstack Preview cannot install or replace the production flapstack command.",
      }
    }
    const cliConfig = this.getCliConfig()
    const installPath = cliConfig.installPath
    const target = expectedCliTarget(sourcePath)

    if (!existsSync(target)) {
      return { success: false, error: "CLI script not found in app bundle" }
    }

    try {
      const currentTarget = installedCliTarget(installPath)
      if (existsSync(installPath) || currentTarget !== null) {
        if (currentTarget === null || !isFlapstackCliTarget(currentTarget)) {
          return {
            success: false,
            error: "The flapstack command already exists and is not owned by this app.",
          }
        }
        if (path.resolve(currentTarget) === path.resolve(target)) return { success: true }
        unlinkSync(installPath)
      }
      mkdirSync(path.dirname(installPath), { recursive: true })
      symlinkSync(target, installPath)

      console.log("[CLI] Installed flapstack command to", installPath)
      return { success: true }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Installation failed"
      console.error("[CLI] Failed to install:", error)
      return { success: false, error: errorMessage }
    }
  }

  async uninstallCli(): Promise<{ success: boolean; error?: string }> {
    if (!linuxCliManagementSupported()) {
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
      if (currentTarget === null || !isFlapstackCliTarget(currentTarget)) {
        return {
          success: false,
          error: "The flapstack command is not owned by this app.",
        }
      }
      unlinkSync(installPath)

      console.log("[CLI] Uninstalled flapstack command")
      return { success: true }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Uninstallation failed"
      console.error("[CLI] Failed to uninstall:", error)
      return { success: false, error: errorMessage }
    }
  }

  isCliInstalled(sourcePath: string): boolean {
    const cliConfig = this.getCliConfig()
    try {
      if (!existsSync(cliConfig.installPath)) return false
      const stat = lstatSync(cliConfig.installPath)
      if (!stat.isSymbolicLink()) return false
      const target = readlinkSync(cliConfig.installPath)
      return path.resolve(target) === path.resolve(expectedCliTarget(sourcePath))
    } catch {
      return false
    }
  }
}
