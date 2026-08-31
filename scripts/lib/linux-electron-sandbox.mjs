import { statSync } from "node:fs"

export function linuxDevNeedsNoSandbox({
  platform = process.platform,
  sandboxPath,
  stat = statSync,
} = {}) {
  if (platform !== "linux") return false
  try {
    const info = stat(sandboxPath)
    return info.uid !== 0 || (info.mode & 0o4000) === 0
  } catch {
    return true
  }
}
