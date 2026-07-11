import { describe, expect, it, vi } from "vitest"
import {
  persistCursorCredentialsWithStores,
  selectNewestCredentials,
  writeCursorCredentialsToDatabase,
} from "../src/main/lib/usage/providers/cursor/token"
import { parseCursorTimestamp } from "../src/main/lib/usage/providers/cursor/source-internal"

function jwt(exp: number): string {
  return `header.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.signature`
}

describe("Cursor rotating credential persistence", () => {
  it("rolls back the access token when the refresh-token statement fails", () => {
    const values = new Map<string, string>([
      ["cursorAuth/accessToken", "old-access"],
      ["cursorAuth/refreshToken", "old-refresh"],
    ])
    const db = {
      prepare: () => ({
        run: (key: string, value: string) => {
          values.set(key, value)
          if (key === "cursorAuth/refreshToken") throw new Error("second statement failed")
        },
      }),
      transaction:
        (fn: () => void): (() => void) =>
        () => {
          const snapshot = new Map(values)
          try {
            return fn()
          } catch (error) {
            values.clear()
            for (const [key, value] of snapshot) values.set(key, value)
            throw error
          }
        },
    }
    expect(() => writeCursorCredentialsToDatabase(db, "new-access", "new-refresh")).toThrow(
      "second statement failed",
    )
    expect(Object.fromEntries(values)).toEqual({
      "cursorAuth/accessToken": "old-access",
      "cursorAuth/refreshToken": "old-refresh",
    })
  })

  it("uses the Keychain fallback when SQLite is locked", () => {
    const keychain = vi.fn().mockReturnValue(true)
    expect(() =>
      persistCursorCredentialsWithStores("new-access", "new-refresh", {
        sqlite: () => {
          throw new Error("database is locked")
        },
        keychain,
      }),
    ).not.toThrow()
    expect(keychain).toHaveBeenCalledOnce()
  })

  it("surfaces failure when neither complete store accepts the pair", () => {
    expect(() =>
      persistCursorCredentialsWithStores("new-access", "new-refresh", {
        sqlite: () => {
          throw new Error("database is locked")
        },
        keychain: () => false,
      }),
    ).toThrow("Unable to persist rotated Cursor credentials: database is locked")
  })

  it("selects the credential with the latest JWT expiry", () => {
    const selected = selectNewestCredentials(
      { token: jwt(1_700_000_000), refreshToken: "sqlite-refresh" },
      { token: jwt(1_800_000_000), refreshToken: "keychain-refresh" },
    )

    expect(selected).toMatchObject({ source: "keychain", refreshToken: "keychain-refresh" })
  })

  it("parses numeric Cursor epoch seconds and milliseconds without shifting the date", () => {
    expect(parseCursorTimestamp("1783814400")?.toISOString()).toBe("2026-07-12T00:00:00.000Z")
    expect(parseCursorTimestamp("1783814400000")?.toISOString()).toBe("2026-07-12T00:00:00.000Z")
  })
})
