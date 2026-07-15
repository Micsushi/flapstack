import { eq, sql } from "drizzle-orm"
import { safeStorage, shell } from "electron"
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promisify, stripVTControlCharacters } from "node:util"
import { z } from "zod"
import { getAuthManager } from "../../../index"
import { getBundledClaudeBinaryPath, getClaudeShellEnvironment } from "../../claude"
import { parseClaudeAuthOutput } from "../../claude/local-auth-output"
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
    const { stdout } = await execFileAsync(getBundledClaudeBinaryPath(), ["auth", "status"], {
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

type LocalClaudeAuthState =
  "starting" | "browser_open" | "waiting_for_code" | "verifying" | "success" | "error"

type LocalClaudeAuthStatus = {
  flowId: string
  state: LocalClaudeAuthState
  message: string
  oauthUrl: string | null
  needsCode: boolean
}

type LocalClaudeAuthSession = {
  status: LocalClaudeAuthStatus
  child: ChildProcessWithoutNullStreams
  timeout: ReturnType<typeof setTimeout> | null
  browserFallback: ReturnType<typeof setTimeout> | null
  cancelled: boolean
  output: string
}

let localClaudeAuthSession: LocalClaudeAuthSession | null = null

function setLocalClaudeAuthStatus(
  session: LocalClaudeAuthSession,
  update: Partial<Omit<LocalClaudeAuthStatus, "flowId">>,
): void {
  session.status = { ...session.status, ...update }
}

function stopLocalClaudeAuthSession(session: LocalClaudeAuthSession): void {
  session.cancelled = true
  if (session.timeout) clearTimeout(session.timeout)
  if (session.browserFallback) clearTimeout(session.browserFallback)
  if (session.child.exitCode == null && session.child.signalCode == null) {
    session.child.kill("SIGTERM")
  }
}

function consumeLocalClaudeAuthOutput(session: LocalClaudeAuthSession, chunk: Buffer): void {
  const rawText = chunk.toString()
  const text = stripVTControlCharacters(rawText)
  session.output = `${session.output}${rawText}\n${text}`.slice(-40_000)
  const parsed = parseClaudeAuthOutput(session.output)

  if (parsed.verifying) {
    setLocalClaudeAuthStatus(session, {
      state: "verifying",
      message: "Verifying your Claude connection…",
    })
    return
  }

  if (parsed.waitingForCode) {
    setLocalClaudeAuthStatus(session, {
      state: "waiting_for_code",
      message:
        "Finish sign-in in your browser. Paste the authorization code only if Claude shows one.",
      oauthUrl: parsed.oauthUrl ?? session.status.oauthUrl,
      needsCode: true,
    })
    return
  }

  if (parsed.oauthUrl) {
    setLocalClaudeAuthStatus(session, {
      state: "browser_open",
      message: "Finish signing in to Claude in your browser.",
      oauthUrl: parsed.oauthUrl,
    })
  }
}

async function finishLocalClaudeAuthSession(
  session: LocalClaudeAuthSession,
  exitCode: number | null,
): Promise<void> {
  if (session.cancelled) return
  if (session.timeout) clearTimeout(session.timeout)
  if (session.browserFallback) clearTimeout(session.browserFallback)
  await new Promise((resolve) => setTimeout(resolve, 400))

  claudeAuthStatusCache = null
  const token = getExistingClaudeToken()?.trim()
  const loggedIn = await hasLoggedInClaudeCli()
  if (loggedIn) {
    if (token) storeOAuthToken(token)
    setLocalClaudeAuthStatus(session, {
      state: "success",
      message: "Claude Code connected.",
      needsCode: false,
    })
    return
  }

  setLocalClaudeAuthStatus(session, {
    state: "error",
    message:
      exitCode === 0
        ? "Claude login finished, but no usable credentials were found. Try again."
        : "Claude login did not complete. Try again.",
    needsCode: false,
  })
}

function startLocalClaudeAuthSession(): LocalClaudeAuthStatus {
  if (localClaudeAuthSession) stopLocalClaudeAuthSession(localClaudeAuthSession)

  claudeAuthStatusCache = null
  const flowId = randomUUID()
  const shellEnv = getClaudeShellEnvironment()
  const child = spawn(getBundledClaudeBinaryPath(), ["auth", "login"], {
    env: { ...process.env, ...shellEnv },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const status: LocalClaudeAuthStatus = {
    flowId,
    state: "starting",
    message: "Opening Claude sign-in…",
    oauthUrl: null,
    needsCode: false,
  }
  const session: LocalClaudeAuthSession = {
    status,
    child,
    cancelled: false,
    output: "",
    timeout: null,
    browserFallback: null,
  }
  localClaudeAuthSession = session

  session.timeout = setTimeout(
    () => {
      if (session.cancelled || session.status.state === "success") return
      setLocalClaudeAuthStatus(session, {
        state: "error",
        message: "Claude login timed out. Try again.",
        needsCode: false,
      })
      stopLocalClaudeAuthSession(session)
    },
    10 * 60 * 1000,
  )
  session.browserFallback = setTimeout(() => {
    if (session.status.state !== "starting") return
    setLocalClaudeAuthStatus(session, {
      state: "browser_open",
      message: "Finish signing in to Claude in your browser.",
    })
  }, 2_000)

  child.stdout.on("data", (chunk: Buffer) => consumeLocalClaudeAuthOutput(session, chunk))
  child.stderr.on("data", (chunk: Buffer) => consumeLocalClaudeAuthOutput(session, chunk))
  child.on("error", () => {
    if (session.cancelled) return
    if (session.timeout) clearTimeout(session.timeout)
    if (session.browserFallback) clearTimeout(session.browserFallback)
    setLocalClaudeAuthStatus(session, {
      state: "error",
      message:
        "Flapstack could not start Claude login. Check that the bundled Claude CLI is available.",
      needsCode: false,
    })
  })
  child.on("close", (code) => void finishLocalClaudeAuthSession(session, code))

  return status
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

  /** Start Claude Code OAuth in the background. The renderer owns the visible flow. */
  startLocalCliAuth: publicProcedure.mutation(() => startLocalClaudeAuthSession()),

  getLocalCliAuthStatus: publicProcedure
    .input(z.object({ flowId: z.string().uuid() }))
    .query(({ input }) => {
      if (!localClaudeAuthSession || localClaudeAuthSession.status.flowId !== input.flowId) {
        return {
          flowId: input.flowId,
          state: "error" as const,
          message: "This Claude login session expired. Start again.",
          oauthUrl: null,
          needsCode: false,
        }
      }
      return localClaudeAuthSession.status
    }),

  submitLocalCliAuthCode: publicProcedure
    .input(z.object({ flowId: z.string().uuid(), code: z.string().trim().min(1).max(10_000) }))
    .mutation(({ input }) => {
      const session = localClaudeAuthSession
      if (!session || session.status.flowId !== input.flowId || session.cancelled) {
        throw new Error("This Claude login session expired. Start again.")
      }
      if (session.child.exitCode != null || session.child.signalCode != null) {
        throw new Error("Claude login already finished. Start again.")
      }
      session.child.stdin.write(`${input.code.trim()}\n`)
      setLocalClaudeAuthStatus(session, {
        state: "verifying",
        message: "Verifying your Claude connection…",
        needsCode: false,
      })
      return session.status
    }),

  openLocalCliAuthBrowser: publicProcedure
    .input(z.object({ flowId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const session = localClaudeAuthSession
      if (!session || session.status.flowId !== input.flowId || !session.status.oauthUrl) {
        throw new Error("Claude sign-in URL is not ready yet.")
      }
      await shell.openExternal(session.status.oauthUrl)
      return { success: true }
    }),

  cancelLocalCliAuth: publicProcedure
    .input(z.object({ flowId: z.string().uuid() }))
    .mutation(({ input }) => {
      const session = localClaudeAuthSession
      if (session?.status.flowId === input.flowId) {
        stopLocalClaudeAuthSession(session)
        localClaudeAuthSession = null
      }
      return { success: true }
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
