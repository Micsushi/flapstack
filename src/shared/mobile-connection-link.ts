import { mobilePairingOfferSchema, type MobilePairingOffer } from "./mobile-control"

export function mobileConnectionLink(offer: MobilePairingOffer): string {
  const payload = new TextEncoder().encode(JSON.stringify(mobilePairingOfferSchema.parse(offer)))
  let binary = ""
  for (const byte of payload) binary += String.fromCharCode(byte)
  const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
  return `${new URL(offer.endpoint).origin}/?pair=${encoded}`
}

export function parseMobileConnectionLink(input: string): MobilePairingOffer {
  if (input.length > 16_384) throw new Error("Connection link is too long.")
  const url = new URL(input.trim())
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== "/" ||
    url.searchParams.size !== 1
  )
    throw new Error("Paste the connection link copied from the host.")
  const encoded = url.searchParams.get("pair")
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("Connection link is invalid.")
  const offer = mobilePairingOfferSchema.parse(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")), (character) =>
          character.charCodeAt(0),
        ),
      ),
    ),
  )
  if (url.origin !== new URL(offer.endpoint).origin || new URL(offer.endpoint).pathname !== "/")
    throw new Error("Connection link does not match its host offer.")
  return offer
}
