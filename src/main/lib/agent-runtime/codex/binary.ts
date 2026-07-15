import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"
import { app } from "electron"

export const PINNED_CODEX_APP_SERVER_VERSION = "0.144.1"
export const CODEX_RUNTIME_ADAPTER_VERSION = "1"

export function resolveCodexRuntimeCommand(): string {
  const binaryName = process.platform === "win32" ? "codex.exe" : "codex"
  const resourcesDir = app.isPackaged
    ? join(process.resourcesPath, "bin")
    : join(app.getAppPath(), "resources", "bin", `${process.platform}-${process.arch}`)
  const bundled = join(resourcesDir, binaryName)
  if (existsSync(bundled)) return bundled

  if (!app.isPackaged) {
    for (const directory of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
      const candidate = join(directory, binaryName)
      if (existsSync(candidate)) return candidate
    }
  }

  throw new Error(
    app.isPackaged
      ? `[codex-runtime] Pinned Codex binary missing from ${bundled}.`
      : `[codex-runtime] Codex binary missing from ${bundled} and PATH.`,
  )
}
