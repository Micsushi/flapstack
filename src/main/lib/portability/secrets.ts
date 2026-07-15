import { createHash } from "node:crypto"
import {
  PORTABLE_EXCLUSION_CATEGORIES,
  type PortableExclusionEntry,
  type PortableScopeId,
} from "../../../shared/portability"
import { PROJECT_VAULT_BARE_SECRET_SOURCE } from "../project-vaults/content-safety"

export const PORTABLE_SECRET_PLACEHOLDER = "__FLAPSTACK_SECRET_EXCLUDED__"

export type SecretCategory = (typeof PORTABLE_EXCLUSION_CATEGORIES)[number]

export type SecretScanOptions = {
  scopeId: PortableScopeId
  path: string
  approvedFalsePositiveHashes?: ReadonlySet<string>
}

export type SecretScanResult<T> = {
  value: T
  exclusions: PortableExclusionEntry[]
  secretFound: boolean
}

const SENSITIVE_FIELD_PATTERNS: ReadonlyArray<[RegExp, SecretCategory]> = [
  [/^(?:AWS_)?ACCESS_KEY_ID$/i, "credential"],
  [/^(?:AWS_)?SECRET_ACCESS_KEY$/i, "credential"],
  [/^(?:GOOGLE_)?(?:API_KEY|APPLICATION_CREDENTIALS)$/i, "credential"],
  [/(?:api|access|auth|refresh|bearer|oauth)[_-]?(?:key|token|secret)$/i, "token"],
  [/(?:password|passwd|credential|client[_-]?secret|private[_-]?key)$/i, "credential"],
  [/(?:session|cookie|grant|challenge|nonce)$/i, "session"],
  [/(?:webhook)(?:[_-]?url)?$/i, "webhook"],
]

const TEXT_SECRET_PATTERNS: ReadonlyArray<[RegExp, SecretCategory]> = [
  [/\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*=\s*[^\s#]+/g, "credential"],
  [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    "private-key",
  ],
  [/\b(?:sk|rk|pk)-(?:live|test|proj)?[-_A-Za-z0-9]{16,}\b/g, "token"],
  [/\b(?:ghp|github_pat|glpat|xox[baprs])[-_A-Za-z0-9]{16,}\b/g, "token"],
  [new RegExp(PROJECT_VAULT_BARE_SECRET_SOURCE, "g"), "credential"],
  [/\bBearer\s+[A-Za-z0-9._~+\/-]{16,}=*\b/gi, "token"],
  [
    /https:\/\/(?:discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com\/services)\/[^\s"']+/gi,
    "webhook",
  ],
]

const ASSIGNMENT_PATTERN =
  /(^|[\s{,;])((?:export\s+)?["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*(?:=|:)\s*)("(?:\\.|[^"\r\n])*"|'[^'\r\n]*'|[^\s#,;}]+)/gm

export function classifySensitiveField(fieldName: string): SecretCategory | null {
  for (const [pattern, category] of SENSITIVE_FIELD_PATTERNS) {
    if (pattern.test(fieldName)) return category
  }
  return null
}

export function secretCandidateHash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

export function sanitizeStructuredValue<T>(
  value: T,
  options: SecretScanOptions,
): SecretScanResult<T> {
  const exclusions: PortableExclusionEntry[] = []
  let secretFound = false

  const visit = (current: unknown, segments: string[]): unknown => {
    if (Array.isArray(current))
      return current.map((entry, index) => visit(entry, [...segments, String(index)]))
    if (current && typeof current === "object") {
      const output: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
        const fieldCategory = classifySensitiveField(key)
        const fieldPath = [...segments, key]
        if (fieldCategory && child !== null && child !== undefined && child !== "") {
          secretFound = true
          exclusions.push(exclusion(options, fieldPath, fieldCategory, "Sensitive field excluded."))
          output[key] = PORTABLE_SECRET_PLACEHOLDER
          continue
        }
        output[key] = visit(child, fieldPath)
      }
      return output
    }
    if (typeof current !== "string") return current
    const redacted = redactText(current, {
      ...options,
      path: joinLogicalPath(options.path, segments),
    })
    exclusions.push(...redacted.exclusions)
    secretFound ||= redacted.secretFound
    return redacted.value
  }

  return { value: visit(value, []) as T, exclusions, secretFound }
}

export function redactText(value: string, options: SecretScanOptions): SecretScanResult<string> {
  const exclusions: PortableExclusionEntry[] = []
  let secretFound = false
  let output = value.replace(
    ASSIGNMENT_PATTERN,
    (candidate, prefix: string, assignment: string, fieldName: string, assignedValue: string) => {
      const category = classifySensitiveField(fieldName)
      if (!category) return candidate
      const reviewedCandidate = candidate.slice(prefix.length)
      if (options.approvedFalsePositiveHashes?.has(secretCandidateHash(reviewedCandidate)))
        return candidate
      secretFound = true
      exclusions.push(exclusion(options, [], category, "Sensitive assignment excluded."))
      const quote = assignedValue.startsWith('"') ? '"' : assignedValue.startsWith("'") ? "'" : ""
      return `${prefix}${assignment}${quote}${PORTABLE_SECRET_PLACEHOLDER}${quote}`
    },
  )
  for (const [pattern, category] of TEXT_SECRET_PATTERNS) {
    pattern.lastIndex = 0
    output = output.replace(pattern, (candidate) => {
      const digest = secretCandidateHash(candidate)
      if (options.approvedFalsePositiveHashes?.has(digest)) return candidate
      secretFound = true
      exclusions.push(exclusion(options, [], category, "Detected secret text excluded."))
      return PORTABLE_SECRET_PLACEHOLDER
    })
  }
  return { value: output, exclusions: dedupeExclusions(exclusions), secretFound }
}

export function assertNoSecretText(value: string, context: string): void {
  const result = redactText(value, { scopeId: "settings", path: context })
  if (result.secretFound || result.value.includes(PORTABLE_SECRET_PLACEHOLDER)) {
    throw new Error(`Secret material is not allowed in ${context}.`)
  }
}

function exclusion(
  options: SecretScanOptions,
  segments: string[],
  category: SecretCategory,
  reason: string,
): PortableExclusionEntry {
  const path = joinLogicalPath(options.path, segments)
  return {
    scopeId: options.scopeId,
    ...(path ? { path } : {}),
    category,
    sensitivity: "secret-bearing",
    reason,
  }
}

function joinLogicalPath(base: string, segments: readonly string[]): string {
  return [base, ...segments].filter(Boolean).join("/").replaceAll("\\", "/")
}

function dedupeExclusions(entries: readonly PortableExclusionEntry[]): PortableExclusionEntry[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = `${entry.scopeId}\0${entry.path ?? ""}\0${entry.category}\0${entry.reason}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
