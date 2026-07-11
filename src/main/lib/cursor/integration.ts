import { resolveCursorAgentBinary, runCursorCli } from "./binary"

/**
 * Cursor login / integration status (Stage 2 Track D / D3).
 *
 * Primary signal is `cursor-agent status`, which prints the logged-in account
 * or "Not logged in". This is local-first (no hosted Flapstack sign-in). The
 * Cursor local-token auto-detect that Track B / U7 ports for usage overlaps
 * here and can later back a token-only fallback, but `status` is the honest,
 * documented source for connected/not-connected.
 */

export type CursorIntegrationState = "connected" | "not_logged_in" | "not_installed" | "unknown"

export type CursorIntegration = {
  state: CursorIntegrationState
  isConnected: boolean
  installed: boolean
  email: string | null
  rawOutput: string
  exitCode: number | null
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

export function normalizeCursorStatus(output: string): {
  state: CursorIntegrationState
  email: string | null
} {
  const normalized = output.toLowerCase()

  if (
    normalized.includes("not logged in") ||
    normalized.includes("please log in") ||
    /\bunauthenticated\b/.test(normalized)
  ) {
    return { state: "not_logged_in", email: null }
  }

  if (
    normalized.includes("logged in") ||
    /\bauthenticated\b/.test(normalized) ||
    normalized.includes("signed in")
  ) {
    const email = output.match(EMAIL_REGEX)?.[0] ?? null
    return { state: "connected", email }
  }

  return { state: "unknown", email: null }
}

export async function getCursorIntegration(): Promise<CursorIntegration> {
  if (!resolveCursorAgentBinary()) {
    return {
      state: "not_installed",
      isConnected: false,
      installed: false,
      email: null,
      rawOutput: "",
      exitCode: null,
    }
  }

  try {
    const result = await runCursorCli(["status"], { timeoutMs: 15_000 })
    const combined = [result.stdout, result.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
      .trim()
    const { state, email } = normalizeCursorStatus(combined)
    return {
      state,
      isConnected: state === "connected",
      installed: true,
      email,
      rawOutput: combined,
      exitCode: result.exitCode,
    }
  } catch (error) {
    return {
      state: "unknown",
      isConnected: false,
      installed: true,
      email: null,
      rawOutput: error instanceof Error ? error.message : String(error),
      exitCode: null,
    }
  }
}

export async function listCursorModels(): Promise<string[]> {
  try {
    const result = await runCursorCli(["models"], { timeoutMs: 15_000 })
    return parseCursorModels(result.stdout)
  } catch {
    return []
  }
}

/** Extract executable model ids from `cursor-agent models` display output. */
export function parseCursorModels(output: string): string[] {
  const models = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^(?:available\s+)?models?:?$/i.test(line))
    // `cursor-agent models` prints "<id> - <display name>". The CLI only
    // accepts the id, so never return the whole display line to callers.
    .map((line) => line.split(/\s+-\s+/, 1)[0]?.trim())
    .filter((model): model is string => Boolean(model))
  return [...new Set(models)]
}
