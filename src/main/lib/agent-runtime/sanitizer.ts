import { createHash } from "node:crypto"

const SECRET_KEY =
  /(?:secret|token|password|credential|api[_-]?key|private[_-]?key|authorization|cookie)/i
const PRIVATE_KEY = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const CREDENTIAL = /\b(?:sk|sess|token|ghp|gho|github_pat|xox[baprs])-[-A-Za-z0-9_]{4,}\b/gi
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
const ASSIGNMENT =
  /\b([A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?token|password|secret|authorization|cookie))\b\s*[:=]\s*([^\s,;]+)/gi
const POSIX_MACHINE_PATH =
  /(?:\/Users\/[^\s/]+|\/home\/[^\s/]+|\/tmp|\/var\/folders\/[^\s/]+)(?:\/[^\s"'<>)]*)?/g
const WINDOWS_MACHINE_PATH = /\b[A-Za-z]:\\Users\\[^\s\\]+(?:\\[^\s"'<>)]*)?/g

export type RuntimeSanitizeMode = "diagnostic" | "agent-content"

export function sanitizeRuntimeText(
  value: string,
  options: { maxLength?: number; mode?: RuntimeSanitizeMode } = {},
): string {
  const mode = options.mode ?? "diagnostic"
  const maxLength = Math.max(1, options.maxLength ?? 4_096)
  let safe = value
    .replace(PRIVATE_KEY, "[redacted-private-key]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(CREDENTIAL, "[redacted-credential]")
    .replace(JWT, "[redacted-jwt]")
    .replace(ASSIGNMENT, (_match, key: string) => `${key}=[redacted]`)
  if (mode === "diagnostic") {
    safe = safe
      .replace(POSIX_MACHINE_PATH, "[redacted-path]")
      .replace(WINDOWS_MACHINE_PATH, "[redacted-path]")
      .replace(/[\r\n\t]+/g, " ")
  }
  return safe.slice(0, maxLength)
}

export function sanitizeRuntimeValue(
  value: unknown,
  options: {
    maxDepth?: number
    maxEntries?: number
    maxString?: number
    mode?: RuntimeSanitizeMode
  } = {},
  depth = 0,
): unknown {
  const maxDepth = options.maxDepth ?? 6
  const maxEntries = options.maxEntries ?? 100
  if (depth > maxDepth) return "[truncated-depth]"
  if (value === null || value === undefined || typeof value === "boolean") return value ?? null
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") {
    return sanitizeRuntimeText(value, {
      maxLength: options.maxString ?? 4_096,
      mode: options.mode,
    })
  }
  if (Array.isArray(value)) {
    return value.slice(0, maxEntries).map((item) => sanitizeRuntimeValue(item, options, depth + 1))
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, maxEntries)
        .map(([key, field]) => [
          key.slice(0, 256),
          SECRET_KEY.test(key) ? "[redacted]" : sanitizeRuntimeValue(field, options, depth + 1),
        ]),
    )
  }
  return sanitizeRuntimeText(String(value), {
    maxLength: options.maxString ?? 4_096,
    mode: options.mode,
  })
}

export function sanitizeRuntimeDedupKey(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) return null
  const safe = sanitizeRuntimeText(normalized, {
    maxLength: 2_048,
    mode: "diagnostic",
  })
  if (safe === normalized && safe.length <= 2_048) return safe
  return `redacted:${createHash("sha256").update(normalized).digest("hex")}`
}

export function isRuntimeSecretKey(key: string): boolean {
  return SECRET_KEY.test(key)
}
