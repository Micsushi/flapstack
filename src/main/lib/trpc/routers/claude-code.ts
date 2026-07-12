import { eq, sql } from "drizzle-orm"
import { safeStorage, shell } from "electron"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { z } from "zod"
import { getAuthManager } from "../../../index"
import { getClaudeShellEnvironment } from "../../claude"
import { getExistingClaudeToken } from "../../claude-token"
import { decodePlaintextClaudeToken } from "../../claude-credential-storage"
import { anthropicAccounts, anthropicSettings, claudeCodeCredentials, getDatabase } from "../../db"
import { createId } from "../../db/utils"
import { publicProcedure, router } from "../index"

const execFileAsync = promisify(execFile)

/**
 * Encrypt token using Electron's safeStorage
 */
function encryptToken(token: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn("[ClaudeCode] Encryption not available, storing as base64")
    return Buffer.from(token).toString("base64")
  }
  return safeStorage.encryptString(token).toString("base64")
}

/**
 * Decrypt token using Electron's safeStorage
 */
function decryptToken(encrypted: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return decodePlaintextClaudeToken(encrypted)
  }
  const buffer = Buffer.from(encrypted, "base64")
  return safeStorage.decryptString(buffer)
}

/**
 * Store OAuth token - now uses multi-account system
 * If setAsActive is true, also sets this account as active
 */
function storeOAuthToken(oauthToken: string, setAsActive = true): string {
  const authManager = getAuthManager()
  const user = authManager.getUser()

  const encryptedToken = encryptToken(oauthToken)
  const db = getDatabase()
  const newId = createId()

  // Store in new multi-account table
  db.insert(anthropicAccounts)
    .values({
      id: newId,
      oauthToken: encryptedToken,
      displayName: "Anthropic Account",
      connectedAt: new Date(),
      desktopUserId: user?.id ?? null,
    })
    .run()

  if (setAsActive) {
    // Set as active account
    db.insert(anthropicSettings)
      .values({
        id: "singleton",
        activeAccountId: newId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: anthropicSettings.id,
        set: {
          activeAccountId: newId,
          updatedAt: new Date(),
        },
      })
      .run()
  }

  // Also update legacy table for backward compatibility
  db.delete(claudeCodeCredentials).where(eq(claudeCodeCredentials.id, "default")).run()

  db.insert(claudeCodeCredentials)
    .values({
      id: "default",
      oauthToken: encryptedToken,
      connectedAt: new Date(),
      userId: user?.id ?? null,
    })
    .run()

  return newId
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function openClaudeAuthTerminal(): Promise<string> {
  const shellEnv = getClaudeShellEnvironment()
  const pathPrefix = shellEnv.PATH || process.env.PATH || ""
  const command = [
    `export PATH=${shellSingleQuote(pathPrefix)}:$PATH`,
    "clear",
    "echo 'Flapstack: starting Claude Code authentication...'",
    "echo",
    "claude auth login",
    "status=$?",
    "echo",
    "if [ $status -eq 0 ]; then echo 'Claude auth command finished. Return to Flapstack and click Check connection.'; else echo 'Claude auth command exited with code '$status'. Fix the message above, then try again.'; fi",
    "echo",
    "echo 'This terminal can stay open.'",
  ].join("; ")

  if (process.platform === "darwin") {
    const script = [
      `tell application "Terminal"`,
      `activate`,
      `do script "${escapeAppleScriptString(command)}"`,
      `end tell`,
    ].join("\n")
    await execFileAsync("osascript", ["-e", script])
    return "Terminal"
  }

  if (process.platform === "win32") {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Start-Process powershell -ArgumentList '-NoExit','-Command',${JSON.stringify(command)}`,
    ])
    return "PowerShell"
  }

  const linuxLaunchers = ["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal"]
  for (const launcher of linuxLaunchers) {
    try {
      if (launcher === "gnome-terminal") {
        await execFileAsync(launcher, ["--", "bash", "-lc", `${command}; exec bash -l`])
      } else if (launcher === "konsole") {
        await execFileAsync(launcher, ["-e", "bash", "-lc", `${command}; exec bash -l`])
      } else {
        await execFileAsync(launcher, [
          "-e",
          `bash -lc ${shellSingleQuote(`${command}; exec bash -l`)}`,
        ])
      }
      return launcher
    } catch {
      // Try the next common terminal launcher.
    }
  }

  throw new Error("Could not open a terminal. Run `claude auth login` in your terminal.")
}

const CLAUDE_AUTH_STATUS_TTL_MS = 10_000
let claudeAuthStatusCache: { checkedAt: number; loggedIn: boolean } | null = null

async function hasLoggedInClaudeCli(): Promise<boolean> {
  if (
    claudeAuthStatusCache &&
    Date.now() - claudeAuthStatusCache.checkedAt < CLAUDE_AUTH_STATUS_TTL_MS
  ) {
    return claudeAuthStatusCache.loggedIn
  }

  let loggedIn = false
  try {
    const shellEnv = getClaudeShellEnvironment()
    const { stdout } = await execFileAsync("claude", ["auth", "status"], {
      env: { ...process.env, ...shellEnv },
    })
    const status = JSON.parse(stdout) as { loggedIn?: boolean }
    loggedIn = status.loggedIn === true
  } catch {
    loggedIn = false
  }
  claudeAuthStatusCache = { checkedAt: Date.now(), loggedIn }
  return loggedIn
}

/**
 * Claude Code OAuth router for desktop
 * Uses server only for sandbox creation, stores token locally
 */
export const claudeCodeRouter = router({
  /**
   * Check if user has existing CLI config (API key or proxy)
   * If true, user can skip OAuth onboarding
   * Based on PR #29 by @sa4hnd
   */
  hasExistingCliConfig: publicProcedure.query(() => {
    const shellEnv = getClaudeShellEnvironment()
    const hasSystemToken = !!getExistingClaudeToken()?.trim()
    const hasConfig = !!(
      shellEnv.ANTHROPIC_API_KEY ||
      shellEnv.ANTHROPIC_AUTH_TOKEN ||
      shellEnv.ANTHROPIC_BASE_URL ||
      hasSystemToken
    )
    return {
      hasConfig,
      hasApiKey: !!(shellEnv.ANTHROPIC_API_KEY || shellEnv.ANTHROPIC_AUTH_TOKEN),
      baseUrl: shellEnv.ANTHROPIC_BASE_URL || null,
      hasSystemToken,
    }
  }),

  /**
   * Check if user has Claude Code connected (local check)
   * Now uses multi-account system - checks for active account
   */
  getIntegration: publicProcedure.query(async () => {
    const db = getDatabase()
    const systemToken = getExistingClaudeToken()?.trim()

    if (await hasLoggedInClaudeCli()) {
      return {
        isConnected: true,
        connectedAt: null,
        accountId: "system-claude-code",
        displayName: "Claude Code CLI",
      }
    }

    // First try multi-account system
    const settings = db
      .select()
      .from(anthropicSettings)
      .where(eq(anthropicSettings.id, "singleton"))
      .get()

    if (settings?.activeAccountId) {
      const account = db
        .select()
        .from(anthropicAccounts)
        .where(eq(anthropicAccounts.id, settings.activeAccountId))
        .get()

      if (account) {
        try {
          if (decryptToken(account.oauthToken).trim()) {
            return {
              isConnected: true,
              connectedAt: account.connectedAt?.toISOString() ?? null,
              accountId: account.id,
              displayName: account.displayName,
            }
          }
        } catch {
          // Keep checking other local auth sources. Encrypted-but-unreadable is not connected.
        }
      }
    }

    // Fallback to legacy table
    const cred = db
      .select()
      .from(claudeCodeCredentials)
      .where(eq(claudeCodeCredentials.id, "default"))
      .get()

    let hasUsableStoredToken = Boolean(systemToken)
    if (cred?.oauthToken) {
      try {
        hasUsableStoredToken = Boolean(decryptToken(cred.oauthToken).trim())
      } catch {
        hasUsableStoredToken = false
      }
    }

    return {
      isConnected: hasUsableStoredToken,
      connectedAt: cred?.connectedAt?.toISOString() ?? null,
      accountId: systemToken && !cred?.oauthToken ? "system-claude-code" : null,
      displayName: systemToken && !cred?.oauthToken ? "Claude Code CLI" : null,
    }
  }),

  /**
   * Hosted sandbox OAuth is disabled in Flapstack.
   */
  startAuth: publicProcedure.mutation(async () => {
    if (true) {
      throw new Error("Hosted Claude Code sandbox auth is disabled in Flapstack")
    }
    return {
      sandboxId: "",
      sandboxUrl: "",
      sessionId: "",
    }
  }),

  /**
   * Poll for OAuth URL - calls sandbox directly
   */
  pollStatus: publicProcedure
    .input(
      z.object({
        sandboxUrl: z.string(),
        sessionId: z.string(),
      }),
    )
    .query(async ({ input }) => {
      void input
      return {
        state: "error" as const,
        oauthUrl: null,
        error: "Hosted Claude Code sandbox auth is disabled in Flapstack",
      }
    }),

  /**
   * Submit OAuth code - calls sandbox directly, stores token locally
   */
  submitCode: publicProcedure
    .input(
      z.object({
        sandboxUrl: z.string(),
        sessionId: z.string(),
        code: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      void input
      throw new Error("Hosted Claude Code sandbox auth is disabled in Flapstack")
    }),

  /**
   * Import an existing OAuth token from the local machine
   */
  importToken: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const oauthToken = input.token.trim()

      storeOAuthToken(oauthToken)

      console.log("[ClaudeCode] Token imported locally")
      return { success: true }
    }),

  /**
   * Check for existing Claude token in system credentials
   */
  getSystemToken: publicProcedure.query(() => {
    const token = getExistingClaudeToken()?.trim() ?? null
    return { token }
  }),

  /**
   * Import Claude token from system credentials
   */
  importSystemToken: publicProcedure.mutation(async () => {
    const token = getExistingClaudeToken()?.trim()
    if (token) {
      storeOAuthToken(token)
      console.log("[ClaudeCode] Token imported from system")
      return { success: true }
    }

    if (await hasLoggedInClaudeCli()) {
      console.log("[ClaudeCode] Using authenticated local Claude CLI")
      return { success: true }
    }

    throw new Error("Claude CLI is not logged in. Complete `claude auth login`, then retry.")
  }),

  /**
   * Open a local terminal to run Claude Code's interactive auth flow.
   */
  startLocalCliAuth: publicProcedure.mutation(async () => {
    const terminal = await openClaudeAuthTerminal()
    return { success: true, terminal }
  }),

  /**
   * Get decrypted OAuth token (local)
   * Now uses multi-account system - gets token from active account
   */
  getToken: publicProcedure.query(() => {
    const db = getDatabase()

    // First try multi-account system
    const settings = db
      .select()
      .from(anthropicSettings)
      .where(eq(anthropicSettings.id, "singleton"))
      .get()

    if (settings?.activeAccountId) {
      const account = db
        .select()
        .from(anthropicAccounts)
        .where(eq(anthropicAccounts.id, settings.activeAccountId))
        .get()

      if (account) {
        try {
          const token = decryptToken(account.oauthToken)
          return { token, error: null }
        } catch (error) {
          console.error("[ClaudeCode] Decrypt error:", error)
          return { token: null, error: "Failed to decrypt token" }
        }
      }
    }

    // Fallback to legacy table
    const cred = db
      .select()
      .from(claudeCodeCredentials)
      .where(eq(claudeCodeCredentials.id, "default"))
      .get()

    if (!cred?.oauthToken) {
      return { token: null, error: "Not connected" }
    }

    try {
      const token = decryptToken(cred.oauthToken)
      return { token, error: null }
    } catch (error) {
      console.error("[ClaudeCode] Decrypt error:", error)
      return { token: null, error: "Failed to decrypt token" }
    }
  }),

  /**
   * Disconnect - delete active account from multi-account system
   */
  disconnect: publicProcedure.mutation(() => {
    const db = getDatabase()

    // Get active account
    const settings = db
      .select()
      .from(anthropicSettings)
      .where(eq(anthropicSettings.id, "singleton"))
      .get()

    if (settings?.activeAccountId) {
      // Remove active account
      db.delete(anthropicAccounts).where(eq(anthropicAccounts.id, settings.activeAccountId)).run()

      // Try to set another account as active
      const firstRemaining = db.select().from(anthropicAccounts).limit(1).get()

      if (firstRemaining) {
        db.update(anthropicSettings)
          .set({
            activeAccountId: firstRemaining.id,
            updatedAt: new Date(),
          })
          .where(eq(anthropicSettings.id, "singleton"))
          .run()
      } else {
        db.update(anthropicSettings)
          .set({
            activeAccountId: null,
            updatedAt: new Date(),
          })
          .where(eq(anthropicSettings.id, "singleton"))
          .run()
      }
    }

    // Also clear legacy table
    db.delete(claudeCodeCredentials).where(eq(claudeCodeCredentials.id, "default")).run()

    console.log("[ClaudeCode] Disconnected")
    return { success: true }
  }),

  /**
   * Open OAuth URL in browser
   */
  openOAuthUrl: publicProcedure.input(z.string()).mutation(async ({ input: url }) => {
    await shell.openExternal(url)
    return { success: true }
  }),
})
