import { eq } from "drizzle-orm"
import {
  anthropicAccounts,
  anthropicSettings,
  claudeCodeCredentials,
  type getDatabase,
} from "../db"

/** A selected credential failure must never silently select another identity. */
export function resolveClaudeAccountToken(
  db: ReturnType<typeof getDatabase>,
  decrypt: (ciphertext: string, migrate: (ciphertext: string) => void) => string,
  readSystemToken: () => string | null,
): string | null {
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
    if (!account?.oauthToken)
      throw new Error(
        "Selected Claude account is unavailable; reconnect it or select another account",
      )
    return decrypt(account.oauthToken, (oauthToken) => {
      db.update(anthropicAccounts)
        .set({ oauthToken })
        .where(eq(anthropicAccounts.id, account.id))
        .run()
    })
  }

  const legacy = db
    .select()
    .from(claudeCodeCredentials)
    .where(eq(claudeCodeCredentials.id, "default"))
    .get()
  if (legacy?.oauthToken) {
    return decrypt(legacy.oauthToken, (oauthToken) => {
      db.update(claudeCodeCredentials)
        .set({ oauthToken })
        .where(eq(claudeCodeCredentials.id, "default"))
        .run()
    })
  }
  return readSystemToken()?.trim() || null
}
