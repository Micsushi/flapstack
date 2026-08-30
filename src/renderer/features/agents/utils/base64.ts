// UTF-8 safe base64 encoding (btoa doesn't support Unicode)
export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("")
  return btoa(binString)
}

// UTF-8 safe base64 decoding (atob doesn't support Unicode)
export function base64ToUtf8(base64: string): string {
  const binString = atob(base64)
  const bytes = Uint8Array.from(binString, (char) => char.codePointAt(0)!)
  return new TextDecoder().decode(bytes)
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) {
    throw new Error("Visual capture derivative is not a base64 data URL.")
  }

  const bytes = Uint8Array.from(atob(match[1]), (char) => char.codePointAt(0)!)
  return new Blob([bytes], { type: "image/png" })
}
