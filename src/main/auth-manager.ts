import { AuthStore, AuthData, AuthUser } from "./auth-store"
import { app, BrowserWindow } from "electron"

export class AuthManager {
  private store: AuthStore
  private refreshTimer?: NodeJS.Timeout

  constructor(isDev: boolean = false) {
    this.store = new AuthStore(app.getPath("userData"))
    if (isDev) {
      console.log("[AuthManager] Hosted desktop sign-in disabled in dev mode")
    }
  }

  /**
   * Set callback to be called when token is refreshed
   * This allows the main process to update cookies when tokens change
   */
  setOnTokenRefresh(callback: (authData: AuthData) => void): void {
    void callback
  }

  /**
   * Exchange auth code for session tokens
   * Called after receiving code via deep link
   */
  async exchangeCode(code: string): Promise<AuthData> {
    void code
    throw new Error("Hosted desktop sign-in is disabled in Flapstack")
  }

  /**
   * Get device info for session tracking
   */
  private getDeviceInfo(): string {
    const platform = process.platform
    const arch = process.arch
    const version = app.getVersion()
    return `Flapstack ${version} (${platform} ${arch})`
  }

  /**
   * Get a valid token, refreshing if necessary
   */
  async getValidToken(): Promise<string | null> {
    return null
  }

  /**
   * Refresh the current session
   */
  async refresh(): Promise<boolean> {
    return false
  }

  /**
   * Schedule token refresh before expiration
   */
  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
    }

    const authData = this.store.load()
    if (!authData) return

    const expiresAt = new Date(authData.expiresAt).getTime()
    const now = Date.now()

    // Refresh 5 minutes before expiration
    const refreshIn = Math.max(0, expiresAt - now - 5 * 60 * 1000)

    this.refreshTimer = setTimeout(() => {
      this.refresh()
    }, refreshIn)

    console.log(`Scheduled token refresh in ${Math.round(refreshIn / 1000 / 60)} minutes`)
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return false
  }

  /**
   * Get current user
   */
  getUser(): AuthUser | null {
    return null
  }

  /**
   * Get current auth data
   */
  getAuth(): AuthData | null {
    return null
  }

  /**
   * Logout and clear stored credentials
   */
  logout(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = undefined
    }
    this.store.clear()
  }

  /**
   * Start auth flow by opening browser
   */
  startAuthFlow(mainWindow: BrowserWindow | null): void {
    void mainWindow
    console.log("[AuthManager] Hosted desktop sign-in is disabled in Flapstack")
  }

  /**
   * Update user profile on server and locally
   */
  async updateUser(updates: { name?: string }): Promise<AuthUser | null> {
    void updates
    return null
  }

  /**
   * Fetch user's subscription plan from web backend
   * Used for PostHog analytics enrichment
   */
  async fetchUserPlan(): Promise<{ email: string; plan: string; status: string | null } | null> {
    return null
  }
}

// Global singleton instance
let authManagerInstance: AuthManager | null = null

/**
 * Initialize the global auth manager instance
 * Must be called once from main process initialization
 */
export function initAuthManager(isDev: boolean = false): AuthManager {
  if (!authManagerInstance) {
    authManagerInstance = new AuthManager(isDev)
  }
  return authManagerInstance
}

/**
 * Get the global auth manager instance
 * Returns null if not initialized
 */
export function getAuthManager(): AuthManager | null {
  return authManagerInstance
}
