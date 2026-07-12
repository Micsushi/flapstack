import { app, BrowserWindow, dialog, Menu, nativeImage } from "electron"
import { existsSync, readFileSync, readlinkSync, unlinkSync } from "fs"
import { createServer } from "http"
import { basename, join, resolve } from "path"
import {
  AuthManager,
  initAuthManager,
  getAuthManager as getAuthManagerFromModule,
} from "./auth-manager"
import { initAnalytics, shutdown as shutdownAnalytics, trackAppOpened } from "./lib/analytics"
import { closeDatabase, getDatabasePath, initDatabase } from "./lib/db"
import { createMainRunLauncher } from "./lib/main-run-launcher"
import { drainPendingAgentRuns, recoverInterruptedMcpRuns } from "./lib/run-launch-service"
import { runStartupCatchUp } from "./lib/usage/catch-up"
import { startDevMcpServer, type DevMcpServerHandle } from "./lib/mcp-test-control/server"
import { getAppUsageSecret } from "./lib/usage/app-secrets"
import { getUsageSecret } from "./lib/usage/secrets"
import {
  getLaunchDirectory,
  isCliInstalled,
  installCli,
  uninstallCli,
  parseLaunchDirectory,
} from "./lib/cli"
import { cleanupGitWatchers } from "./lib/git/watcher"
import { cancelAllPendingOAuth, handleMcpOAuthCallback } from "./lib/mcp-auth"
import {
  getAllMcpConfigHandler,
  hasActiveClaudeSessions,
  abortAllClaudeSessions,
} from "./lib/trpc/routers/claude"
import {
  getAllCodexMcpConfigHandler,
  hasActiveCodexStreams,
  abortAllCodexStreams,
} from "./lib/trpc/routers/codex"
import { abortAllCursorStreams, hasActiveCursorStreams } from "./lib/trpc/routers/cursor"
import { abortAllOpencodeStreams, hasActiveOpencodeStreams } from "./lib/trpc/routers/opencode"
import {
  createMainWindow,
  createWindow,
  getWindow,
  getAllWindows,
  setIsQuitting,
} from "./windows/main"
import { windowManager } from "./windows/window-manager"

import { IS_DEV, AUTH_SERVER_PORT } from "./constants"

let devMcpServer: DevMcpServerHandle | null = null

// Deep link protocol (must match package.json build.protocols.schemes)
// Use different protocol in dev to avoid conflicts with production app
const IS_MAC_PREVIEW =
  process.platform === "darwin" && !IS_DEV && basename(process.execPath) === "Flapstack Preview"
const PROTOCOL = IS_DEV ? "flapstack-dev" : IS_MAC_PREVIEW ? "flapstack-preview" : "flapstack"
const APP_DISPLAY_NAME = IS_DEV
  ? "Flapstack Dev"
  : IS_MAC_PREVIEW
    ? "Flapstack Preview"
    : "Flapstack"

if (process.platform === "darwin" && IS_DEV) {
  const expectedCheckout = process.env.FLAPSTACK_DEV_CHECKOUT?.trim()
  if (!expectedCheckout || resolve(expectedCheckout) !== resolve(app.getAppPath())) {
    console.error("[Dev] Refusing unverified macOS launch. Start with: npm run dev")
    app.exit(1)
  }
}

function hasActiveAgentSessions(): boolean {
  return (
    hasActiveClaudeSessions() ||
    hasActiveCodexStreams() ||
    hasActiveCursorStreams() ||
    hasActiveOpencodeStreams()
  )
}

function abortAllAgentSessions(): void {
  abortAllClaudeSessions()
  abortAllCodexStreams()
  abortAllCursorStreams()
  abortAllOpencodeStreams()
}

// Set dev mode userData path BEFORE requestSingleInstanceLock()
// This ensures dev and prod have separate instance locks
if (IS_DEV) {
  const { join } = require("path")
  const instance = process.env.FLAPSTACK_DEV_INSTANCE?.trim()
  const suffix = instance
    ? `Flapstack Dev ${instance.replace(/[^a-zA-Z0-9_-]/g, "-")}`
    : "Flapstack Dev"
  const devUserData = join(app.getPath("userData"), "..", suffix)
  app.setPath("userData", devUserData)
  app.setName(APP_DISPLAY_NAME)
  console.log("[Dev] Using separate userData path:", devUserData)
} else if (IS_MAC_PREVIEW) {
  const previewUserData = join(app.getPath("userData"), "..", "Flapstack Preview")
  app.setPath("userData", previewUserData)
  app.setName(APP_DISPLAY_NAME)
  console.log("[Preview] Using separate userData path:", previewUserData)
}

// Increase V8 old-space limit for renderer/main processes to reduce OOM frequency
// under heavy multi-chat workloads. Must be set before app readiness/window creation.
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=8192")

// Initialize Sentry before app is ready (production only)
if (app.isPackaged && !IS_DEV) {
  const sentryDsn = import.meta.env.MAIN_VITE_SENTRY_DSN
  if (sentryDsn) {
    import("@sentry/electron/main")
      .then((Sentry) => {
        Sentry.init({
          dsn: sentryDsn,
        })
        console.log("[App] Sentry initialized")
      })
      .catch((error) => {
        console.warn("[App] Failed to initialize Sentry:", error)
      })
  } else {
    console.log("[App] Skipping Sentry initialization (no DSN configured)")
  }
} else {
  console.log("[App] Skipping Sentry initialization (dev mode)")
}

// Flapstack is local-first; no hosted desktop account backend is configured.
export function getBaseUrl(): string {
  return ""
}

export function getAppUrl(): string {
  return process.env.ELECTRON_RENDERER_URL || ""
}

// Auth manager singleton (use the one from auth-manager module)
let authManager: AuthManager
let pendingRunTimer: NodeJS.Timeout | null = null
let pendingRunDrainActive = false

export function getAuthManager(): AuthManager {
  // First try to get from module, fallback to local variable for backwards compat
  return getAuthManagerFromModule() || authManager
}

// Handle auth code from deep link (exported for IPC handlers)
export async function handleAuthCode(code: string): Promise<void> {
  console.log("[Auth] Ignoring hosted app auth code; desktop sign-in is disabled", Boolean(code))
}

// Handle deep link
function handleDeepLink(url: string): void {
  console.log("[DeepLink] Received:", url)

  try {
    const parsed = new URL(url)

    // Handle MCP OAuth callback: flapstack://mcp-oauth?code=xxx&state=yyy
    if (parsed.pathname === "/mcp-oauth" || parsed.host === "mcp-oauth") {
      const code = parsed.searchParams.get("code")
      const state = parsed.searchParams.get("state")
      if (code && state) {
        handleMcpOAuthCallback(code, state)
        return
      }
    }
  } catch (e) {
    console.error("[DeepLink] Failed to parse:", e)
  }
}

// Register protocol BEFORE app is ready
console.log("[Protocol] ========== PROTOCOL REGISTRATION ==========")
console.log("[Protocol] Protocol:", PROTOCOL)
console.log("[Protocol] Is dev mode (process.defaultApp):", process.defaultApp)
console.log("[Protocol] process.execPath:", process.execPath)
console.log("[Protocol] process.argv:", process.argv)

/**
 * Register the app as the handler for our custom protocol.
 * On macOS, this may not take effect immediately on first install -
 * Launch Services caches protocol handlers and may need time to update.
 */
function registerProtocol(): boolean {
  let success = false

  if (process.defaultApp) {
    // Dev mode: need to pass execPath and script path
    if (process.argv.length >= 2) {
      success = app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]!])
      console.log(`[Protocol] Dev mode registration:`, success ? "success" : "failed")
    } else {
      console.warn("[Protocol] Dev mode: insufficient argv for registration")
    }
  } else {
    // Production mode
    success = app.setAsDefaultProtocolClient(PROTOCOL)
    console.log(`[Protocol] Production registration:`, success ? "success" : "failed")
  }

  return success
}

// Store initial registration result (set in app.whenReady())
let initialRegistration = false

// Verify registration (this checks if OS recognizes us as the handler)
function verifyProtocolRegistration(): void {
  const isDefault = process.defaultApp
    ? app.isDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]!])
    : app.isDefaultProtocolClient(PROTOCOL)

  console.log(`[Protocol] Verification - isDefaultProtocolClient: ${isDefault}`)

  if (!isDefault && initialRegistration) {
    console.warn("[Protocol] Registration returned success but verification failed.")
    console.warn(
      "[Protocol] This is common on first install - macOS Launch Services may need time to update.",
    )
    console.warn("[Protocol] The protocol should work after app restart.")
  }
}

console.log("[Protocol] =============================================")

// Note: app.on("open-url") will be registered in app.whenReady()

// SVG favicon as data URI for auth callback pages (matches web app favicon)
const FAVICON_SVG = `<svg width="32" height="32" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="1024" height="1024" fill="#0033FF"/><path fill-rule="evenodd" clip-rule="evenodd" d="M800.165 148C842.048 148 876 181.952 876 223.835V686.415C876 690.606 872.606 694 868.415 694H640.915C636.729 694 633.335 697.394 633.335 701.585V868.415C633.335 872.606 629.936 876 625.75 876H223.835C181.952 876 148 842.048 148 800.165V702.59C148 697.262 150.807 692.326 155.376 689.586L427.843 526.1C434.031 522.388 431.956 513.238 425.327 512.118L423.962 512H155.585C151.394 512 148 508.606 148 504.415V337.585C148 333.394 151.394 330 155.585 330H443.75C447.936 330 451.335 326.606 451.335 322.415V155.585C451.335 151.394 454.729 148 458.915 148H800.165ZM458.915 330C454.729 330 451.335 333.394 451.335 337.585V686.415C451.335 690.606 454.729 694 458.915 694H625.75C629.936 694 633.335 690.606 633.335 686.415V337.585C633.335 333.394 629.936 330 625.75 330H458.915Z" fill="#F4F4F4"/></svg>`
const FAVICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`

// Start local HTTP server for auth callbacks
// This catches http://localhost:{AUTH_SERVER_PORT}/auth/callback?code=xxx and /callback (for MCP OAuth)
const server = createServer((req, res) => {
  const url = new URL(req.url || "", `http://localhost:${AUTH_SERVER_PORT}`)

  // Serve favicon
  if (url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg") {
    res.writeHead(200, { "Content-Type": "image/svg+xml" })
    res.end(FAVICON_SVG)
    return
  }

  if (url.pathname === "/auth/callback") {
    const code = url.searchParams.get("code")
    console.log("[Auth Server] Received callback with code:", code?.slice(0, 8) + "...")

    if (code) {
      // Handle the auth code
      handleAuthCode(code)

      // Send success response and close the browser tab
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
  <title>Flapstack - Authentication</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #09090b;
      --text: #fafafa;
      --text-muted: #71717a;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #ffffff;
        --text: #09090b;
        --text-muted: #71717a;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
    }
    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .logo {
      width: 24px;
      height: 24px;
      margin-bottom: 8px;
    }
    h1 {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 4px;
    }
    p {
      font-size: 12px;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <svg class="logo" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill-rule="evenodd" clip-rule="evenodd" d="M14.3333 0C15.2538 0 16 0.746192 16 1.66667V11.8333C16 11.9254 15.9254 12 15.8333 12H10.8333C10.7413 12 10.6667 12.0746 10.6667 12.1667V15.8333C10.6667 15.9254 10.592 16 10.5 16H1.66667C0.746192 16 0 15.2538 0 14.3333V12.1888C0 12.0717 0.0617409 11.9632 0.162081 11.903L6.15043 8.30986C6.28644 8.22833 6.24077 8.02716 6.09507 8.00256L6.06511 8H0.166667C0.0746186 8 0 7.92538 0 7.83333V4.16667C0 4.07462 0.0746193 4 0.166667 4H6.5C6.59205 4 6.66667 3.92538 6.66667 3.83333V0.166667C6.66667 0.0746193 6.74129 0 6.83333 0H14.3333ZM6.83333 4C6.74129 4 6.66667 4.07462 6.66667 4.16667V11.8333C6.66667 11.9254 6.74129 12 6.83333 12H10.5C10.592 12 10.6667 11.9254 10.6667 11.8333V4.16667C10.6667 4.07462 10.592 4 10.5 4H6.83333Z" fill="#0033FF"/>
    </svg>
    <h1>Authentication successful</h1>
    <p>You can close this tab</p>
  </div>
  <script>setTimeout(() => window.close(), 1000)</script>
</body>
</html>`)
    } else {
      res.writeHead(400, { "Content-Type": "text/plain" })
      res.end("Missing code parameter")
    }
  } else if (url.pathname === "/callback") {
    // Handle MCP OAuth callback
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    console.log(
      "[Auth Server] Received MCP OAuth callback with code:",
      code?.slice(0, 8) + "...",
      "state:",
      state?.slice(0, 8) + "...",
    )

    if (code && state) {
      // Handle the MCP OAuth callback
      handleMcpOAuthCallback(code, state)

      // Send success response and close the browser tab
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
  <title>Flapstack - MCP Authentication</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #09090b;
      --text: #fafafa;
      --text-muted: #71717a;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #ffffff;
        --text: #09090b;
        --text-muted: #71717a;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
    }
    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .logo {
      width: 24px;
      height: 24px;
      margin-bottom: 8px;
    }
    h1 {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 4px;
    }
    p {
      font-size: 12px;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <svg class="logo" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill-rule="evenodd" clip-rule="evenodd" d="M14.3333 0C15.2538 0 16 0.746192 16 1.66667V11.8333C16 11.9254 15.9254 12 15.8333 12H10.8333C10.7413 12 10.6667 12.0746 10.6667 12.1667V15.8333C10.6667 15.9254 10.592 16 10.5 16H1.66667C0.746192 16 0 15.2538 0 14.3333V12.1888C0 12.0717 0.0617409 11.9632 0.162081 11.903L6.15043 8.30986C6.28644 8.22833 6.24077 8.02716 6.09507 8.00256L6.06511 8H0.166667C0.0746186 8 0 7.92538 0 7.83333V4.16667C0 4.07462 0.0746193 4 0.166667 4H6.5C6.59205 4 6.66667 3.92538 6.66667 3.83333V0.166667C6.66667 0.0746193 6.74129 0 6.83333 0H14.3333ZM6.83333 4C6.74129 4 6.66667 4.07462 6.66667 4.16667V11.8333C6.66667 11.9254 6.74129 12 6.83333 12H10.5C10.592 12 10.6667 11.9254 10.6667 11.8333V4.16667C10.6667 4.07462 10.592 4 10.5 4H6.83333Z" fill="#0033FF"/>
    </svg>
    <h1>MCP Server authenticated</h1>
    <p>You can close this tab</p>
  </div>
  <script>setTimeout(() => window.close(), 1000)</script>
</body>
</html>`)
    } else {
      res.writeHead(400, { "Content-Type": "text/plain" })
      res.end("Missing code or state parameter")
    }
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" })
    res.end("Not found")
  }
})

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.warn(
      `[Auth Server] Port ${AUTH_SERVER_PORT} is already in use; auth callback server is disabled for this process.`,
    )
    return
  }

  console.error("[Auth Server] Failed:", error)
})

server.listen(AUTH_SERVER_PORT, () => {
  console.log(`[Auth Server] Listening on http://localhost:${AUTH_SERVER_PORT}`)
})

// Clean up stale lock files from crashed instances
// Returns true if locks were cleaned, false otherwise
function cleanupStaleLocks(): boolean {
  const userDataPath = app.getPath("userData")
  const lockPath = join(userDataPath, "SingletonLock")

  if (!existsSync(lockPath)) return false

  try {
    // SingletonLock is a symlink like "hostname-pid"
    const lockTarget = readlinkSync(lockPath)
    const match = lockTarget.match(/-(\d+)$/)
    if (match) {
      const pid = parseInt(match[1], 10)
      try {
        // Check if process is running (signal 0 doesn't kill, just checks)
        process.kill(pid, 0)
        // Process exists, lock is valid
        console.log("[App] Lock held by running process:", pid)
        return false
      } catch {
        // Process doesn't exist, clean up stale locks
        console.log("[App] Cleaning stale locks (pid", pid, "not running)")
        const filesToRemove = ["SingletonLock", "SingletonSocket", "SingletonCookie"]
        for (const file of filesToRemove) {
          const filePath = join(userDataPath, file)
          if (existsSync(filePath)) {
            try {
              unlinkSync(filePath)
            } catch (e) {
              console.warn("[App] Failed to remove", file, e)
            }
          }
        }
        return true
      }
    }
  } catch (e) {
    console.warn("[App] Failed to check lock file:", e)
  }
  return false
}

// Prevent multiple instances
let gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // Maybe stale lock - try cleanup and retry once
  const cleaned = cleanupStaleLocks()
  if (cleaned) {
    gotTheLock = app.requestSingleInstanceLock()
  }
  if (!gotTheLock) {
    app.quit()
  }
}

if (gotTheLock) {
  // Handle second instance launch (also handles deep links on Windows/Linux)
  app.on("second-instance", (_event, commandLine) => {
    // Check for deep link in command line args
    const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`))
    if (url) {
      handleDeepLink(url)
    }

    // Focus on the first available window
    const windows = getAllWindows()
    if (windows.length > 0) {
      const window = windows[0]!
      if (window.isMinimized()) window.restore()
      window.focus()
    } else {
      // No windows open, create a new one
      createMainWindow()
    }
  })

  // App ready
  app.whenReady().then(async () => {
    if (IS_DEV) {
      app.setName(APP_DISPLAY_NAME)
    }

    // Register protocol handler (must be after app is ready)
    initialRegistration = registerProtocol()

    // Handle deep link on macOS (app already running)
    app.on("open-url", (event, url) => {
      console.log("[Protocol] open-url event received:", url)
      event.preventDefault()
      handleDeepLink(url)
    })

    // Set app user model ID for Windows (different in dev to avoid taskbar conflicts)
    if (process.platform === "win32") {
      app.setAppUserModelId(IS_DEV ? "dev.flapstack.app.dev" : "dev.flapstack.app")
    }

    console.log(`[App] Starting ${APP_DISPLAY_NAME}...`)

    // Verify protocol registration after app is ready
    // This helps diagnose first-install issues where the protocol isn't recognized yet
    verifyProtocolRegistration()

    // Get Claude Code version for About panel
    let claudeCodeVersion = "unknown"
    try {
      const isDev = !app.isPackaged
      const versionPath = isDev
        ? join(app.getAppPath(), "resources/bin/VERSION")
        : join(process.resourcesPath, "bin/VERSION")

      if (existsSync(versionPath)) {
        const versionContent = readFileSync(versionPath, "utf-8")
        claudeCodeVersion = versionContent.split("\n")[0]?.trim() || "unknown"
      }
    } catch (error) {
      console.warn("[App] Failed to read Claude Code version:", error)
    }

    // Set About panel options with Claude Code version
    app.setAboutPanelOptions({
      applicationName: APP_DISPLAY_NAME,
      applicationVersion: app.getVersion(),
      version: `Claude Code ${claudeCodeVersion}`,
      copyright: "Copyright © 2026 Flapstack contributors",
    })

    // Track devtools unlock state (hidden feature - 5 clicks on Beta tab)
    let devToolsUnlocked = false

    // Menu icons: PNG template for settings (auto light/dark via "Template" suffix),
    // macOS native SF Symbol for terminal
    const settingsMenuIcon = nativeImage.createFromPath(
      join(__dirname, "../../build/settingsTemplate.png"),
    )
    const terminalMenuIcon =
      process.platform === "darwin"
        ? nativeImage.createFromNamedImage("terminal")?.resize({ width: 12, height: 12 })
        : null

    // Function to build and set application menu
    const buildMenu = () => {
      // Show devtools menu item only in dev mode or when unlocked
      const showDevTools = !app.isPackaged || devToolsUnlocked
      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: APP_DISPLAY_NAME,
          submenu: [
            {
              label: `About ${APP_DISPLAY_NAME}`,
              click: () => app.showAboutPanel(),
            },
            { type: "separator" },
            {
              label: "Settings...",
              ...(settingsMenuIcon && { icon: settingsMenuIcon }),
              accelerator: "CmdOrCtrl+,",
              click: () => {
                const win = getWindow()
                if (win) {
                  win.webContents.send("shortcut:open-settings")
                }
              },
            },
            { type: "separator" },
            {
              label: isCliInstalled()
                ? "Uninstall 'flapstack' Command..."
                : "Install 'flapstack' Command in PATH...",
              ...(terminalMenuIcon && { icon: terminalMenuIcon }),
              click: async () => {
                const { dialog } = await import("electron")
                if (isCliInstalled()) {
                  const result = await uninstallCli()
                  if (result.success) {
                    dialog.showMessageBox({
                      type: "info",
                      message: "CLI command uninstalled",
                      detail: "The 'flapstack' command has been removed from your PATH.",
                    })
                    buildMenu()
                  } else {
                    dialog.showErrorBox("Uninstallation Failed", result.error || "Unknown error")
                  }
                } else {
                  const result = await installCli()
                  if (result.success) {
                    dialog.showMessageBox({
                      type: "info",
                      message: "CLI command installed",
                      detail:
                        "You can now use 'flapstack .' in any terminal to open Flapstack in that directory.",
                    })
                    buildMenu()
                  } else {
                    dialog.showErrorBox("Installation Failed", result.error || "Unknown error")
                  }
                }
              },
            },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            {
              label: "Quit",
              accelerator: "CmdOrCtrl+Q",
              click: async () => {
                if (hasActiveAgentSessions()) {
                  const { dialog } = await import("electron")
                  const { response } = await dialog.showMessageBox({
                    type: "warning",
                    buttons: ["Cancel", "Quit Anyway"],
                    defaultId: 0,
                    cancelId: 0,
                    title: "Active Sessions",
                    message: "There are active agent sessions running.",
                    detail: "Quitting now will interrupt them. Are you sure you want to quit?",
                  })
                  if (response === 1) {
                    abortAllAgentSessions()
                    setIsQuitting(true)
                    app.quit()
                  }
                } else {
                  app.quit()
                }
              },
            },
          ],
        },
        {
          label: "File",
          submenu: [
            {
              label: "New Chat",
              accelerator: "CmdOrCtrl+N",
              click: () => {
                console.log("[Menu] New Chat clicked (Cmd+N)")
                const win = getWindow()
                if (win) {
                  console.log("[Menu] Sending shortcut:new-agent to renderer")
                  win.webContents.send("shortcut:new-agent")
                } else {
                  console.log("[Menu] No window found!")
                }
              },
            },
            {
              label: "New Window",
              accelerator: "CmdOrCtrl+Shift+N",
              click: () => {
                console.log("[Menu] New Window clicked (Cmd+Shift+N)")
                createWindow()
              },
            },
            { type: "separator" },
            {
              label: "Close Window",
              accelerator: "CmdOrCtrl+W",
              click: () => {
                const win = getWindow()
                if (win) {
                  win.close()
                }
              },
            },
          ],
        },
        {
          label: "Edit",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "View",
          submenu: [
            // Cmd+R is disabled to prevent accidental page refresh
            // Cmd+Shift+R reloads but warns if there are active streams
            {
              label: "Force Reload",
              accelerator: "CmdOrCtrl+Shift+R",
              click: () => {
                const win = BrowserWindow.getFocusedWindow()
                if (!win) return
                if (hasActiveAgentSessions()) {
                  dialog
                    .showMessageBox(win, {
                      type: "warning",
                      buttons: ["Cancel", "Reload Anyway"],
                      defaultId: 0,
                      cancelId: 0,
                      title: "Active Sessions",
                      message: "There are active agent sessions running.",
                      detail:
                        "Reloading will interrupt them. The current progress will be saved. Are you sure you want to reload?",
                    })
                    .then(({ response }) => {
                      if (response === 1) {
                        abortAllAgentSessions()
                        win.webContents.reloadIgnoringCache()
                      }
                    })
                } else {
                  win.webContents.reloadIgnoringCache()
                }
              },
            },
            // Only show DevTools in dev mode or when unlocked via hidden feature
            ...(showDevTools ? [{ role: "toggleDevTools" as const }] : []),
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        },
        {
          label: "Window",
          submenu: [
            { role: "minimize" },
            { role: "zoom" },
            { type: "separator" },
            { role: "front" },
          ],
        },
        {
          role: "help",
          submenu: [
            {
              label: "Learn More",
              click: async () => {
                const { shell } = await import("electron")
                await shell.openExternal("https://flapstack.dev")
              },
            },
          ],
        },
      ]
      Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    }

    // macOS: Set dock menu (right-click on dock icon)
    if (process.platform === "darwin") {
      const dockIconPath = join(__dirname, "../../build/icon.png")
      if (existsSync(dockIconPath)) {
        const dockIcon = nativeImage.createFromBuffer(readFileSync(dockIconPath))
        if (!dockIcon.isEmpty()) {
          app.dock?.setIcon(dockIcon)
        }
      }

      const dockMenu = Menu.buildFromTemplate([
        {
          label: "New Window",
          click: () => {
            console.log("[Dock] New Window clicked")
            createWindow()
          },
        },
      ])
      app.dock?.setMenu(dockMenu)
    }

    // Unlock devtools and rebuild menu (called from renderer via IPC)
    const unlockDevTools = () => {
      if (!devToolsUnlocked) {
        devToolsUnlocked = true
        console.log("[App] DevTools unlocked via hidden feature")
        buildMenu()
      }
    }

    // Expose unlockDevTools globally for IPC handler
    ;(global as any).__unlockDevTools = unlockDevTools

    // Build initial menu
    buildMenu()

    // Initialize auth manager (uses singleton from auth-manager module)
    authManager = initAuthManager(!!process.env.ELECTRON_RENDERER_URL)
    console.log("[App] Auth manager initialized")

    // Initialize analytics after auth manager so we can identify user
    initAnalytics()

    // Track app opened without hosted account identity.
    trackAppOpened()

    // Initialize database
    try {
      initDatabase()
      console.log("[App] Database initialized")
      devMcpServer = await startDevMcpServer({
        enabled: IS_DEV,
        userDataPath: app.getPath("userData"),
        checkout: app.getAppPath(),
        profile: app.getName(),
      })
      recoverInterruptedMcpRuns(getDatabasePath())
      const pendingRunLauncher = createMainRunLauncher()
      const launchPendingRuns = async () => {
        if (pendingRunDrainActive) return
        pendingRunDrainActive = true
        try {
          await drainPendingAgentRuns(getDatabasePath(), pendingRunLauncher)
        } catch (error) {
          console.error("[App] Pending run launch failed:", error)
        } finally {
          pendingRunDrainActive = false
        }
      }
      pendingRunTimer = setInterval(() => void launchPendingRuns(), 500)
      void launchPendingRuns()
      void runStartupCatchUp({
        db: initDatabase(),
        getSecret: getAppUsageSecret,
      }).catch((error) => console.warn("[Usage] Startup catch-up failed:", error))
    } catch (error) {
      console.error("[App] Failed to initialize database:", error)
    }

    // Create main window
    createMainWindow()

    // Hosted auto-update is disabled for local-first Flapstack builds.

    // Warm up MCP cache 3 seconds after startup (background, non-blocking)
    // This populates the cache so all future sessions can use filtered MCP servers
    setTimeout(async () => {
      try {
        const results = await Promise.allSettled([
          getAllMcpConfigHandler(),
          getAllCodexMcpConfigHandler(),
        ])

        if (results[0].status === "rejected") {
          console.error("[App] Claude MCP warmup failed:", results[0].reason)
        }
        if (results[1].status === "rejected") {
          console.error("[App] Codex MCP warmup failed:", results[1].reason)
        }
      } catch (error) {
        console.error("[App] MCP warmup failed:", error)
      }
    }, 3000)

    // Handle directory argument from CLI (e.g., `flapstack /path/to/project`)
    parseLaunchDirectory()

    // Handle deep link from app launch (Windows/Linux)
    const deepLinkUrl = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`))
    if (deepLinkUrl) {
      handleDeepLink(deepLinkUrl)
    }

    // macOS: Re-create window when dock icon is clicked
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  })

  // Quit when all windows are closed (except on macOS)
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  // Cleanup before quit
  app.on("before-quit", async () => {
    console.log("[App] Shutting down...")
    abortAllAgentSessions()
    if (pendingRunTimer) clearInterval(pendingRunTimer)
    cancelAllPendingOAuth()
    await devMcpServer?.stop()
    devMcpServer = null
    await cleanupGitWatchers()
    await shutdownAnalytics()
    await closeDatabase()
  })

  // Handle uncaught exceptions
  process.on("uncaughtException", (error) => {
    console.error("[App] Uncaught exception:", error)
  })

  process.on("unhandledRejection", (reason, promise) => {
    console.error("[App] Unhandled rejection at:", promise, "reason:", reason)
  })
}
