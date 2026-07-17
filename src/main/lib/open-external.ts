import { shell } from "electron"

// Renderer/agent/MCP output can supply arbitrary URLs. Only hand web + mail
// schemes to the OS; block file://, custom protocol handlers, javascript:, etc.
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"])

export function isSafeExternalUrl(url: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol)
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
