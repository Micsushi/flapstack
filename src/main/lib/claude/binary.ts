import { accessSync, constants, existsSync, statSync } from "node:fs"
import { delimiter, join } from "node:path"

export type ClaudeBinaryResolution = {
  path: string
  source: "bundled" | "path" | "missing"
}

function executableName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "claude.exe" : "claude"
}

function isExecutableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return false
    if (platform !== "win32") accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function resolveClaudeBinaryPath(input: {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
  platform: NodeJS.Platform
  arch: string
  searchPath?: string
}): ClaudeBinaryResolution {
  const name = executableName(input.platform)
  const bundledPath = input.isPackaged
    ? join(input.resourcesPath, "bin", name)
    : join(input.appPath, "resources", "bin", `${input.platform}-${input.arch}`, name)

  if (isExecutableFile(bundledPath, input.platform)) {
    return { path: bundledPath, source: "bundled" }
  }

  if (!input.isPackaged) {
    for (const directory of (input.searchPath ?? "").split(delimiter).filter(Boolean)) {
      const candidate = join(directory, name)
      if (isExecutableFile(candidate, input.platform)) {
        return { path: candidate, source: "path" }
      }
    }
  }

  return { path: bundledPath, source: "missing" }
}
