/**
 * CLI command support for flapstack
 * Allows users to open flapstack from terminal with: flapstack . or flapstack /path/to/project
 *
 * Based on PR #16 by @caffeinum (Aleksey Bykhun)
 * Flapstack CLI integration.
 */

import { app } from "electron"
import { join } from "path"
import { platform } from "./platform"
import { queueLaunchDirectoryFromArgv, takePendingLaunchDirectory } from "./cli-launch"

/**
 * Get the launch directory passed via CLI args (consumed once)
 */
export function getLaunchDirectory(): string | null {
  return takePendingLaunchDirectory()
}

/**
 * Parse CLI arguments to find a directory argument
 * Called on app startup to handle `flapstack .` or `flapstack /path/to/project`
 */
export function parseLaunchDirectory(): void {
  const directory = queueLaunchDirectoryFromArgv(process.argv, {
    defaultApp: Boolean(process.defaultApp),
  })
  if (directory) console.log("[CLI] Launch directory:", directory)
}

/**
 * Get the CLI source path (where the CLI script is bundled)
 */
function getCliSourcePath(): string {
  const cliName = platform.getCliConfig().scriptName
  if (app.isPackaged) {
    return join(process.resourcesPath, "cli", cliName)
  }
  return join(__dirname, "..", "..", "resources", "cli", cliName)
}

/**
 * Check if the CLI command is installed
 */
export function isCliInstalled(): boolean {
  return platform.isCliInstalled(getCliSourcePath())
}

/**
 * Install the CLI command
 * Platform-specific behavior is handled by the platform provider
 */
export async function installCli(): Promise<{
  success: boolean
  error?: string
}> {
  return platform.installCli(getCliSourcePath())
}

/**
 * Uninstall the CLI command
 * Platform-specific behavior is handled by the platform provider
 */
export async function uninstallCli(): Promise<{
  success: boolean
  error?: string
}> {
  return platform.uninstallCli()
}
