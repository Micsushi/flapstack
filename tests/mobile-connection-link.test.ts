import { expect, it } from "vitest"
import {
  mobileConnectionLink,
  parseMobileConnectionLink,
} from "../src/shared/mobile-connection-link"
const offer = {
  protocolVersion: 1 as const,
  endpoint: "https://100.78.162.80:4317",
  certificateFingerprint: "sha256:" + "a".repeat(64),
  oneTimeToken: "b".repeat(43),
  createdAt: 100000,
  expiresAt: 200000,
}
it("round-trips the exact host QR offer and rejects origin/parameter substitution", () => {
  const link = mobileConnectionLink(offer)
  expect(parseMobileConnectionLink(link)).toEqual(offer)
  expect(() => parseMobileConnectionLink(link.replace("100.78.162.80", "100.92.31.124"))).toThrow()
  expect(() => parseMobileConnectionLink(link + "&pair=other")).toThrow()
  expect(() => parseMobileConnectionLink(link + "#other")).toThrow()
})
