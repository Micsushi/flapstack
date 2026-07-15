const REDACTED = "[REDACTED]"
export const PROJECT_VAULT_BARE_SECRET_SOURCE = String.raw`\b(?:(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{20,})\b`

export function containsProjectVaultSecret(content: string): boolean {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) return true
  if (new RegExp(PROJECT_VAULT_BARE_SECRET_SOURCE).test(content)) return true
  if (/\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i.test(content)) return true
  return /\b(?:[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)|api[-_ ]?key|access[-_ ]?token|password)\s*[:=]\s*(?!\[?redacted\]?|<[^>]+>|\$\{?\w+\}?|example\b|changeme\b)["']?[A-Za-z0-9._~+/=-]{12,}/i.test(
    content,
  )
}

export function redactProjectVaultSecrets(content: string): string {
  const redacted = content
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      REDACTED,
    )
    .replace(new RegExp(PROJECT_VAULT_BARE_SECRET_SOURCE, "g"), REDACTED)
    .replace(/(\bAuthorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, `$1${REDACTED}`)
    .replace(
      /(\b(?:[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)|api[-_ ]?key|access[-_ ]?token|password)\s*[:=]\s*)["']?[A-Za-z0-9._~+/=-]{12,}/gi,
      `$1${REDACTED}`,
    )
  return containsProjectVaultSecret(redacted) ? REDACTED : redacted
}

export function assertProjectVaultContentSafe(content: string): void {
  if (containsProjectVaultSecret(content)) {
    throw new Error("Project vault content contains a detected secret. Remove it before saving.")
  }
}
