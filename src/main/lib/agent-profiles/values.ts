import { createHash } from "node:crypto"
export { nowEpochSeconds as epochSeconds } from "../db/timestamps"

export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}
