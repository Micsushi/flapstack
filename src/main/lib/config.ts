/**
 * Shared configuration for the desktop app
 */
import { app } from "electron"

const IS_DEV = !!process.env.ELECTRON_RENDERER_URL

export function getApiUrl(): string {
  return ""
}

/**
 * Check if running in development mode
 */
export function isDev(): boolean {
  return IS_DEV
}
