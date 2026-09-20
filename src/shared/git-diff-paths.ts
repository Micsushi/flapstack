/** Git's quoted paths use C escapes and octal UTF-8 bytes, not JSON escaping. */
export function decodeGitPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value
  const text = value.slice(1, -1),
    bytes: number[] = []
  const encoder = new TextEncoder()
  const escapes: Record<string, number> = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '"': 34,
    "\\": 92,
  }
  for (let index = 0; index < text.length;) {
    if (text[index] === "\\") {
      index++
      const octal = /^[0-7]{1,3}/.exec(text.slice(index))?.[0]
      if (octal) {
        bytes.push(parseInt(octal, 8))
        index += octal.length
        continue
      }
      const escaped = escapes[text[index]!]
      if (escaped === undefined) return value
      bytes.push(escaped)
      index++
    } else {
      const char = String.fromCodePoint(text.codePointAt(index)!)
      bytes.push(...encoder.encode(char))
      index += char.length
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

export function gitDiffHeaderPaths(line: string): [string, string] | null {
  const text = line.slice("diff --git ".length)
  const quoted = /^((?:"(?:[^"\\]|\\.)*")|(?:a\/.*?)) ((?:"(?:[^"\\]|\\.)*")|(?:b\/.*))$/.exec(text)
  if (!quoted) return null
  let oldPath = decodeGitPath(quoted[1]!),
    newPath = decodeGitPath(quoted[2]!)
  // Unquoted spaces are legal. Prefer the identical-path split for ordinary changes.
  if (!text.startsWith('"')) {
    for (let index = text.indexOf(" b/"); index >= 0; index = text.indexOf(" b/", index + 1)) {
      if (text.slice(2, index) === text.slice(index + 3)) {
        oldPath = text.slice(0, index)
        newPath = text.slice(index + 1)
        break
      }
    }
  }
  return oldPath.startsWith("a/") && newPath.startsWith("b/")
    ? [oldPath.slice(2), newPath.slice(2)]
    : null
}
