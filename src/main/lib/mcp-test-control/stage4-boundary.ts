import { createHash } from "node:crypto"
import { redactSecretLikeText } from "./shell"

export function sanitizeStage4ControlBoundary(value: unknown, key = ""): unknown {
  if (/secret|token|password|api[-_]?key|credential/i.test(key)) return "[redacted]"
  if (typeof value === "string") {
    return redactAbsolutePaths(redactStage4SecretText(value))
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeStage4ControlBoundary(item))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeStage4ControlBoundary(entryValue, entryKey),
      ]),
    )
  }
  return value
}

export function sanitizeStage4ControlError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  const sanitized = sanitizeStage4ControlBoundary(message)
  return new Error(
    typeof sanitized === "string" ? sanitized.slice(0, 2_000) : "Stage 4 control failed.",
  )
}

function redactStage4SecretText(value: string): string {
  return redactSecretLikeText(value)
    .replace(
      /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
      "[private-key redacted]",
    )
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*/g, "[private-key redacted]")
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,})\b/g,
      "[github-token redacted]",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.(?:[A-Za-z0-9_-]{5,})?(?=$|[^A-Za-z0-9_-])/g,
      "[jwt redacted]",
    )
    .replace(
      /((?:api[-_]?key|secret|password|credential|token)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    )
    .replace(/((?:authorization|cookie)\s*[:=]\s*)(?!\[redacted\])[^\s,;]+/gi, "$1[redacted]")
}

function redactAbsolutePaths(value: string): string {
  const quoted = value.replace(
    /(["'])([A-Za-z]:[\\/][^"'<>|\r\n]+|\\\\[^"'<>|\r\n]+|\/[^"'\r\n]+)\1/g,
    (_match, quote: string, pathValue: string) => `${quote}${pathMarker(pathValue)}${quote}`,
  )
  return quoted
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^<>"'|\r\n,;)}\]]+/g, (pathValue) =>
      pathMarker(pathValue.trimEnd()),
    )
    .replace(/(?<![:\w])\/(?:[^/\s"'<>|,;)}\]]+\/)+[^/\s"'<>|,;)}\]]+/g, (pathValue) =>
      pathMarker(pathValue),
    )
    .replace(/(?<![:/\w])\/(?!\/)[^/\s"'<>|,;)}\]]+\/(?=$|[\s"'<>|,;)}\]])/g, (pathValue) =>
      pathMarker(pathValue),
    )
    .replace(/(?<![:/\w])\/(?!\/)[^/\s"'<>|,;)}\]]+(?=$|[\s"'<>|,;)}\]])/g, (pathValue) =>
      pathMarker(pathValue),
    )
}

function pathMarker(pathValue: string): string {
  const segments = pathValue.split(/[\\/]/).filter(Boolean)
  const leaf = segments.at(-1) || ""
  const extension = leaf.match(/\.([A-Za-z0-9]{1,10})$/)?.[1]?.toLowerCase()
  const hint = extension ? `file.${extension}` : "directory"
  const fingerprint = createHash("sha256").update(pathValue).digest("hex").slice(0, 10)
  return `[path:${hint}:${fingerprint}]`
}
