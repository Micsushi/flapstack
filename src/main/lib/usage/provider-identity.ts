import { createHash } from "node:crypto"

/** Stable, non-secret account partition for APIs that do not expose an
 * organization id. Replacing the configured admin credential cannot overwrite
 * history collected with a different credential. */
export function credentialAccountTag(kind: "openai" | "anthropic", credential: string): string {
  const fingerprint = createHash("sha256").update(credential).digest("hex").slice(0, 16)
  return `${kind}-admin-${fingerprint}`
}
