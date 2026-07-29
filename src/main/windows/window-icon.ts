import { join } from "node:path"

export function resolveWindowIconPath(input: {
  platform: NodeJS.Platform
  isPackaged: boolean
  appPath: string
  resourcesPath: string
}): string | undefined {
  if (input.platform !== "win32") return undefined
  return input.isPackaged
    ? join(input.resourcesPath, "icon.ico")
    : join(input.appPath, "build", "icon.ico")
}
