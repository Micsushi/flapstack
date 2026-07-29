import { APP_META, type ExternalApp } from "../../../shared/external-apps"
import { spawn, type ChildProcess } from "node:child_process"

export type ExternalAppLaunch =
  | { kind: "reveal"; path: string }
  | { kind: "default"; path: string }
  | { kind: "spawn"; command: string; args: string[] }

const WINDOWS_COMMANDS: Partial<Record<ExternalApp, string>> = {
  cursor: "cursor",
  vscode: "code",
  "vscode-insiders": "code-insiders",
  windsurf: "windsurf",
  sublime: "subl",
  terminal: "wt.exe",
  "github-desktop": "github",
  trae: "trae",
  intellij: "idea",
  webstorm: "webstorm",
  pycharm: "pycharm",
  phpstorm: "phpstorm",
  rubymine: "rubymine",
  goland: "goland",
  clion: "clion",
  rider: "rider",
  datagrip: "datagrip",
  fleet: "fleet",
  rustrover: "rustrover",
}

const LINUX_COMMANDS: Partial<Record<ExternalApp, string>> = {
  cursor: "cursor",
  vscode: "code",
  "vscode-insiders": "code-insiders",
  zed: "zed",
  windsurf: "windsurf",
  sublime: "subl",
  ghostty: "ghostty",
}

type SpawnProcess = typeof spawn

export interface ExternalAppProbe {
  command: string
  args: string[]
}

export function getPlatformFolderLabel(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "Finder" : "Open in folder"
}

export function getExternalAppProbe(
  platform: NodeJS.Platform,
  app: ExternalApp,
): ExternalAppProbe | null {
  if (app === "finder") return null
  if (platform === "darwin") {
    return {
      command: "open",
      args: ["-Ra", APP_META[app].macAppName],
    }
  }

  const command = platform === "win32" ? WINDOWS_COMMANDS[app] : LINUX_COMMANDS[app]
  if (!command) return null
  return {
    command: platform === "win32" ? "where.exe" : "which",
    args: [command],
  }
}

export function assertOpenPathSucceeded(result: string, targetPath: string): void {
  const error = result.trim()
  if (error) throw new Error(`${error}: ${targetPath}`)
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function quoteWindowsArgument(value: string): string {
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`
}

function waitForWrapper(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => {
      if (signal) reject(new Error(`External application launcher terminated by ${signal}`))
      else if (code !== 0)
        reject(new Error(`External application launcher exited with code ${code ?? "unknown"}`))
      else resolve()
    })
  })
}

/**
 * Launch an external application without passing user paths through a command shell.
 * Windows PATH entries are often .cmd shims, so a UTF-16LE encoded PowerShell wrapper
 * resolves the shim and starts cmd.exe with CREATE_NO_WINDOW.
 */
export async function spawnExternalCommand(
  platform: NodeJS.Platform,
  command: string,
  args: string[],
  options: {
    spawn?: SpawnProcess
    windowsShell?: string
    cwd?: string
    env?: NodeJS.ProcessEnv
  } = {},
): Promise<void> {
  const spawnProcess = options.spawn ?? spawn
  if (platform === "win32") {
    const argumentLine = args.map(quoteWindowsArgument).join(" ")
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$requested = ${quotePowerShellLiteral(command)}`,
      "$resolved = if ([System.IO.Path]::IsPathRooted($requested)) {",
      "  (Get-Item -LiteralPath $requested -ErrorAction Stop).FullName",
      "} else {",
      "  (Get-Command -Name $requested -CommandType Application,ExternalScript -ErrorAction Stop | Select-Object -First 1).Source",
      "}",
      "$extension = [System.IO.Path]::GetExtension($resolved)",
      "if ($extension -in @('.cmd', '.bat')) {",
      "  $commandLine = '\"' + $resolved + '\"'",
      ...(argumentLine ? [`  $commandLine += ' ' + ${quotePowerShellLiteral(argumentLine)}`] : []),
      "  $startInfo = New-Object System.Diagnostics.ProcessStartInfo",
      "  $startInfo.FileName = $env:ComSpec",
      "  $startInfo.Arguments = '/d /s /c \"' + $commandLine + '\"'",
      "  $startInfo.UseShellExecute = $false",
      "  $startInfo.CreateNoWindow = $true",
      "  $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden",
      "  $process = [System.Diagnostics.Process]::Start($startInfo)",
      "  $process.WaitForExit()",
      '  if ($process.ExitCode -ne 0) { throw "Command shim exited with code $($process.ExitCode)" }',
      "} else {",
      ...(argumentLine
        ? [
            `  Start-Process -FilePath $resolved -ArgumentList ${quotePowerShellLiteral(argumentLine)} -ErrorAction Stop | Out-Null`,
          ]
        : ["  Start-Process -FilePath $resolved -ErrorAction Stop | Out-Null"]),
      "}",
    ].join("; ")
    const encoded = Buffer.from(script, "utf16le").toString("base64")
    const child = spawnProcess(
      options.windowsShell ?? "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      {
        cwd: options.cwd,
        env: options.env,
        stdio: "ignore",
        windowsHide: true,
      },
    )
    await waitForWrapper(child)
    return
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: "ignore",
    })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}

export function resolveExternalAppLaunch(
  platform: NodeJS.Platform,
  app: ExternalApp,
  targetPath: string,
): ExternalAppLaunch {
  if (app === "finder") return { kind: "reveal", path: targetPath }
  if (platform === "darwin") {
    return {
      kind: "spawn",
      command: "open",
      args: ["-a", APP_META[app].macAppName, targetPath],
    }
  }
  const command = platform === "win32" ? WINDOWS_COMMANDS[app] : LINUX_COMMANDS[app]
  if (!command) return { kind: "default", path: targetPath }
  return {
    kind: "spawn",
    command,
    args: platform === "win32" && app === "terminal" ? ["-d", targetPath] : [targetPath],
  }
}
