import { shell } from "electron"
import { pathToFileURL } from "node:url"
import { extname } from "node:path"

// Renderer/agent/MCP output can supply arbitrary URLs. Only hand web + mail
// schemes to the OS; block file://, custom protocol handlers, javascript:, etc.
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"])
const EXECUTABLE_EXTENSIONS = new Set([
  ".bat",
  ".cmd",
  ".com",
  ".exe",
  ".hta",
  ".js",
  ".jse",
  ".lnk",
  ".msi",
  ".ps1",
  ".scr",
  ".vbe",
  ".vbs",
  ".wsf",
  ".wsh",
])

export function isSafeExternalUrl(url: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

export function isExecutableExternalPath(filePath: string): boolean {
  return EXECUTABLE_EXTENSIONS.has(extname(filePath).toLowerCase())
}

export function isTrustedRendererNavigation(
  url: string,
  devServerUrl: string | undefined,
  rendererFilePath: string,
): boolean {
  try {
    const target = new URL(url)
    if (devServerUrl) return target.origin === new URL(devServerUrl).origin
    const rendererUrl = pathToFileURL(rendererFilePath)
    return target.protocol === "file:" && target.pathname === rendererUrl.pathname
  } catch {
    return false
  }
}

export async function openExternalSafe(url: string): Promise<boolean> {
  if (!isSafeExternalUrl(url)) {
    console.warn(`[open-external] Blocked disallowed URL scheme: ${url}`)
    return false
  }
  await shell.openExternal(url)
  return true
}
