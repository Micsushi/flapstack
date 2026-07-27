import { createHash } from "node:crypto"

export type ProtocolReceiptSource = "initial-argv" | "second-instance" | "open-url"

export type ProtocolReceipt = {
  sequence: number
  receivedAt: string
  source: ProtocolReceiptSource
  accepted: boolean
  protocol: string | null
  host: string | null
  pathname: string | null
  queryKeys: string[]
  urlFingerprint: string
  activated: boolean | null
  windowCountAfter: number | null
}

let sequence = 0
let lastReceipt: ProtocolReceipt | null = null

export function protocolUrlFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function recordProtocolReceipt(
  value: string,
  expectedProtocol: string,
  source: ProtocolReceiptSource,
  now: () => Date = () => new Date(),
): ProtocolReceipt {
  let parsed: URL | null = null
  try {
    parsed = new URL(value)
  } catch {
    // Invalid inputs remain observable by fingerprint only.
  }
  const receipt: ProtocolReceipt = {
    sequence: (sequence += 1),
    receivedAt: now().toISOString(),
    source,
    accepted: parsed?.protocol === `${expectedProtocol}:`,
    protocol: parsed?.protocol.replace(/:$/, "") ?? null,
    host: parsed?.host || null,
    pathname: parsed?.pathname || null,
    queryKeys: parsed ? [...new Set(parsed.searchParams.keys())].sort() : [],
    urlFingerprint: protocolUrlFingerprint(value),
    activated: null,
    windowCountAfter: null,
  }
  lastReceipt = receipt
  return receipt
}

export function recordProtocolDispatch(activated: boolean, windowCountAfter: number): void {
  if (!lastReceipt || lastReceipt.source !== "second-instance") return
  lastReceipt = { ...lastReceipt, activated, windowCountAfter }
}

export function getLastProtocolReceipt(): ProtocolReceipt | null {
  return lastReceipt ? { ...lastReceipt, queryKeys: [...lastReceipt.queryKeys] } : null
}

export function resetProtocolReceiptsForTests(): void {
  sequence = 0
  lastReceipt = null
}
