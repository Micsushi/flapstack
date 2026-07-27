/**
 * Windows Platform Provider
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, unlink, rmdir, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { BasePlatformProvider } from "./base"
import type { ShellConfig, PathConfig, CliConfig, EnvironmentConfig } from "./types"
import { isPreviewExecutable } from "../mcp-test-control/lifecycle"

const CLI_PATH_MARKER = ".flapstack-path-added"
const CLI_OWNER_MARKER = ".flapstack-cli-owner"
const CLI_OWNER_VERSION = "flapstack-cli-v1"
const WINDOWS_ENVIRONMENT_BROADCAST = [
  "try {",
  "  Add-Type -Namespace Flapstack -Name NativeMethods -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"user32.dll\", CharSet=System.Runtime.InteropServices.CharSet.Unicode, SetLastError=true)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);'",
  "  $broadcastResult = [UIntPtr]::Zero",
  "  [Flapstack.NativeMethods]::SendMessageTimeout([IntPtr]::new(0xffff), 0x1A, [UIntPtr]::Zero, 'Environment', 0x2, 5000, [ref]$broadcastResult) | Out-Null",
  "} catch { }",
]

function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function windowsPathContains(
  directory: string,
  pathValue = process.env.PATH ?? process.env.Path ?? "",
): boolean {
  const normalized = (value: string) =>
    path.win32
      .normalize(value)
      .replace(/[\\/]+$/, "")
      .toLowerCase()
  const expected = normalized(directory)
  return pathValue
    .split(";")
    .filter(Boolean)
    .some((entry) => normalized(entry) === expected)
}

export function renderWindowsCliLauncher(template: string, executablePath: string): string {
  if (!template.includes("__FLAPSTACK_ENCODED_COMMAND__")) {
    throw new Error("Windows CLI launcher template is missing its encoded-command placeholder")
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$executable = ${powerShellLiteral(executablePath)}`,
    "$directory = [Environment]::GetEnvironmentVariable('FLAPSTACK_CLI_DIRECTORY', 'Process')",
    "if ([string]::IsNullOrWhiteSpace($directory) -or -not (Test-Path -LiteralPath $directory -PathType Container)) { throw 'Invalid directory' }",
    `$argument = '"' + $directory + '"'`,
    "Start-Process -FilePath $executable -ArgumentList $argument",
  ].join("; ")
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  const launcher = template.replaceAll("__FLAPSTACK_ENCODED_COMMAND__", encoded)
  if (!/^[\x00-\x7f]*$/.test(launcher)) {
    throw new Error("Windows CLI launcher must remain ASCII-only")
  }
  return launcher
}

export function windowsCliManagementSupported(
  input: { defaultApp: boolean; executablePath: string } = {
    defaultApp: Boolean(process.defaultApp),
    executablePath: process.execPath,
  },
): boolean {
  return !input.defaultApp && !isPreviewExecutable(input.executablePath)
}

function launcherOwnershipValue(contents: string): string {
  return `${CLI_OWNER_VERSION}:${createHash("sha256").update(contents).digest("hex")}`
}

function isOwnedWindowsCliLauncher(installPath: string, ownerPath: string): boolean {
  if (!existsSync(installPath) || !existsSync(ownerPath)) return false
  try {
    return (
      readFileSync(ownerPath, "utf8").trim() ===
      launcherOwnershipValue(readFileSync(installPath, "utf8"))
    )
  } catch {
    return false
  }
}

export function windowsUserPathScript(
  action: "add" | "remove",
  directory: string,
  ownershipMarkerPath?: string,
): string {
  const literal = powerShellLiteral(directory)
  const common = [
    "$ErrorActionPreference = 'Stop'",
    `$directory = ${literal}`,
    "$current = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "$segments = @($current -split ';' | Where-Object { $_ })",
    "$comparison = [StringComparer]::OrdinalIgnoreCase",
  ]
  if (action === "add") {
    const markerWrite = ownershipMarkerPath
      ? `  Set-Content -LiteralPath ${powerShellLiteral(ownershipMarkerPath)} -Value 'added' -NoNewline`
      : null
    return [
      ...common,
      "$present = $segments | Where-Object { $comparison.Equals($_.TrimEnd('\\'), $directory.TrimEnd('\\')) } | Select-Object -First 1",
      "if ($present) { Write-Output 'present' } else {",
      markerWrite,
      "  $updated = @($segments + $directory) -join ';'",
      "  [Environment]::SetEnvironmentVariable('Path', $updated, 'User')",
      ...WINDOWS_ENVIRONMENT_BROADCAST,
      "  Write-Output 'added'",
      "}",
    ]
      .filter((line): line is string => line !== null)
      .join("; ")
  }
  return [
    ...common,
    "$updatedSegments = @($segments | Where-Object { -not $comparison.Equals($_.TrimEnd('\\'), $directory.TrimEnd('\\')) })",
    "if ($updatedSegments.Count -eq $segments.Count) { Write-Output 'absent' } else {",
    "  [Environment]::SetEnvironmentVariable('Path', ($updatedSegments -join ';'), 'User')",
    ...WINDOWS_ENVIRONMENT_BROADCAST,
    "  Write-Output 'removed'",
    "}",
  ].join("; ")
}

export class WindowsPlatformProvider extends BasePlatformProvider {
  readonly platform = "win32" as const
  readonly displayName = "Windows"

  getShellConfig(): ShellConfig {
    const configuredSystemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows"
    const systemRoot = path.win32.isAbsolute(configuredSystemRoot)
      ? configuredSystemRoot
      : "C:\\Windows"
    const powershellPath = path.win32.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    )

    return {
      executable: powershellPath,
      loginArgs: [], // Windows shells don't have login mode like Unix
      execArgs: (command: string) => ["-NoLogo", "-NoProfile", "-Command", command],
    }
  }

  getPathConfig(): PathConfig {
    const home = this.getHome()
    const systemRoot = process.env.SystemRoot || "C:\\Windows"

    return {
      separator: ";",
      commonPaths: [
        // Git for Windows
        "C:\\Program Files\\Git\\cmd",
        "C:\\Program Files\\Git\\bin",
        "C:\\Program Files\\Git\\usr\\bin",
        // Node.js
        "C:\\Program Files\\nodejs",
        // System
        path.join(systemRoot, "System32"),
        systemRoot,
      ],
      localBin: path.join(home, ".local", "bin"),
      packageManagerPaths: [
        path.join(home, "AppData", "Roaming", "npm"),
        path.join(home, ".bun", "bin"),
        path.join(home, ".cargo", "bin"),
        path.join(home, "scoop", "shims"),
        path.join(home, "AppData", "Local", "pnpm"),
      ],
    }
  }

  getCliConfig(): CliConfig {
    // Install to ~/.local/bin which is already included in buildExtendedPath()
    // This avoids needing to modify the system PATH
    const home = this.getHome()

    return {
      installPath: path.join(home, ".local", "bin", "flapstack.cmd"),
      scriptName: "flapstack.cmd",
      requiresAdmin: false, // Install to user directory, no admin needed
    }
  }

  getEnvironmentConfig(): EnvironmentConfig {
    const home = this.getHome()

    return {
      homeVar: "USERPROFILE",
      userVar: "USERNAME",
      additionalVars: {
        USERPROFILE: home,
        HOME: home,
        APPDATA: path.join(home, "AppData", "Roaming"),
        LOCALAPPDATA: path.join(home, "AppData", "Local"),
        TEMP: process.env.TEMP || path.join(home, "AppData", "Local", "Temp"),
        TMP: process.env.TMP || path.join(home, "AppData", "Local", "Temp"),
      },
    }
  }

  override getDefaultShell(): string {
    return this.getShellConfig().executable
  }

  override async detectShell(): Promise<string> {
    // Windows doesn't have a per-user shell preference like Unix
    // Just return the default
    return this.getDefaultShell()
  }

  override async detectLocale(): Promise<string> {
    // Windows uses different locale mechanism
    // Try environment first
    if (process.env.LANG) {
      return process.env.LANG
    }

    // Could query Windows locale via PowerShell, but for simplicity use default
    return "en_US.UTF-8"
  }

  async installCli(
    sourcePath: string,
  ): Promise<{ success: boolean; error?: string; pathHint?: string }> {
    if (process.defaultApp) {
      return {
        success: false,
        error: "Install the flapstack command from a packaged app build.",
      }
    }
    if (!windowsCliManagementSupported()) {
      return {
        success: false,
        error: "Flapstack Preview cannot install or replace the production flapstack command.",
      }
    }
    const cliConfig = this.getCliConfig()
    const installPath = cliConfig.installPath
    const installDir = path.dirname(installPath)
    const markerPath = path.join(installDir, CLI_PATH_MARKER)
    const ownerPath = path.join(installDir, CLI_OWNER_MARKER)

    if (!existsSync(sourcePath)) {
      return { success: false, error: "CLI script not found in app bundle" }
    }

    try {
      await mkdir(installDir, { recursive: true })
      const template = await readFile(sourcePath, "utf8")
      const launcher = renderWindowsCliLauncher(template, process.execPath)
      if (existsSync(installPath) && !isOwnedWindowsCliLauncher(installPath, ownerPath)) {
        return {
          success: false,
          error: "The flapstack command already exists and is not owned by this app.",
        }
      }
      await writeFile(installPath, launcher, "ascii")
      await writeFile(ownerPath, `${launcherOwnershipValue(launcher)}\n`, "ascii")

      const script = windowsUserPathScript("add", installDir, markerPath)
      const encoded = Buffer.from(script, "utf16le").toString("base64")
      const { stdout } = await this.execCommand(
        this.getShellConfig().executable,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        { timeout: 10_000 },
      )
      if (stdout.trim() === "added") await writeFile(markerPath, "added\n", "utf8")

      if (!windowsPathContains(installDir)) {
        process.env.PATH = [process.env.PATH ?? process.env.Path ?? "", installDir]
          .filter(Boolean)
          .join(";")
      }

      console.log("[CLI] Installed flapstack command to", installPath)
      return { success: true }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Installation failed"
      console.error("[CLI] Failed to install:", error)
      return { success: false, error: errorMessage }
    }
  }

  async uninstallCli(): Promise<{ success: boolean; error?: string }> {
    if (!windowsCliManagementSupported()) {
      return {
        success: false,
        error: "Flapstack Preview cannot uninstall the production flapstack command.",
      }
    }
    const cliConfig = this.getCliConfig()
    const installPath = cliConfig.installPath
    const installDir = path.dirname(installPath)
    const markerPath = path.join(installDir, CLI_PATH_MARKER)
    const ownerPath = path.join(installDir, CLI_OWNER_MARKER)

    try {
      const launcherExists = existsSync(installPath)
      const markerExists = existsSync(markerPath)
      const ownerExists = existsSync(ownerPath)
      if (launcherExists && !isOwnedWindowsCliLauncher(installPath, ownerPath)) {
        return {
          success: false,
          error: "The flapstack command is not owned by this app and was not removed.",
        }
      }
      if (!launcherExists && !markerExists && !ownerExists) {
        console.log("[CLI] CLI command not installed, nothing to uninstall")
        return { success: true }
      }

      if (markerExists) {
        const script = windowsUserPathScript("remove", installDir)
        const encoded = Buffer.from(script, "utf16le").toString("base64")
        await this.execCommand(
          this.getShellConfig().executable,
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
          { timeout: 10_000 },
        )
      }

      if (launcherExists) await unlink(installPath)
      if (ownerExists) await unlink(ownerPath)
      if (markerExists) await unlink(markerPath)
      try {
        await rmdir(installDir)
      } catch {
        // Directory not empty or other error, that's okay
      }

      console.log("[CLI] Uninstalled flapstack command")
      return { success: true }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Uninstallation failed"
      console.error("[CLI] Failed to uninstall:", error)
      return { success: false, error: errorMessage }
    }
  }

  isCliInstalled(sourcePath: string): boolean {
    if (!windowsCliManagementSupported()) return false
    const cliConfig = this.getCliConfig()
    const installDir = path.dirname(cliConfig.installPath)
    try {
      return (
        isOwnedWindowsCliLauncher(cliConfig.installPath, path.join(installDir, CLI_OWNER_MARKER)) &&
        windowsPathContains(installDir)
      )
    } catch {
      return false
    }
  }
}
