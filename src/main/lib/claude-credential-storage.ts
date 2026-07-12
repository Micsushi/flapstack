const CHROMIUM_ENCRYPTED_PREFIXES = ["v10", "v11"]

export function decodePlaintextClaudeToken(encoded: string): string {
  const decoded = Buffer.from(encoded, "base64")
  const prefix = decoded.subarray(0, 3).toString("ascii")

  if (CHROMIUM_ENCRYPTED_PREFIXES.includes(prefix)) {
    throw new Error("Claude credential is encrypted but secure storage is unavailable")
  }

  const token = decoded.toString("utf8")
  if (!token || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(token)) {
    throw new Error("Claude credential contains invalid control characters")
  }

  return token
}
