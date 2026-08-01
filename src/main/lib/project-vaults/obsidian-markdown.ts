import { posix } from "node:path"

const MAX_NOTE_BYTES = 1_048_576
const MAX_LINKS = 10_000
const ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,199}$/u
const TYPE_PATTERN = /^[a-z][a-z0-9-]{0,79}$/
const SECRET_KEY_PATTERN = /(?:secret|token|password|api[-_]?key|private[-_]?key|credential)/i

export type ObsidianNoteDiagnostic = {
  code:
    | "frontmatter-malformed"
    | "identity-invalid"
    | "secret-frontmatter"
    | "malformed-link"
    | "path-escape"
    | "link-limit"
  message: string
  line: number | null
}

export type ObsidianNoteLink = {
  kind: "wikilink" | "embed" | "markdown"
  target: string
  normalizedTarget: string
  heading: string | null
  blockId: string | null
  alias: string | null
  line: number
}

export type ParsedObsidianNote = {
  source: string
  relativePath: string
  identity: { id: string; type: string | null; section?: string } | null
  aliases: string[]
  tags: string[]
  frontmatter: { raw: string; start: number; end: number } | null
  headings: Array<{ depth: number; text: string; slug: string; line: number }>
  blocks: Array<{ id: string; line: number }>
  links: ObsidianNoteLink[]
  diagnostics: ObsidianNoteDiagnostic[]
}

/**
 * Byte-preserving, non-executing parser for the declared Obsidian subset.
 * It projects only bounded metadata; callers retain `source` as the authority.
 */
export function parseObsidianNote(source: string, relativePath: string): ParsedObsidianNote {
  if (Buffer.byteLength(source, "utf8") > MAX_NOTE_BYTES) {
    throw new Error("Obsidian note exceeds the 1 MiB size limit.")
  }
  if (source.includes("\0")) throw new Error("Obsidian note contains a NUL encoding marker.")
  const safeRelativePath = normalizeNotePath(relativePath)
  if (!safeRelativePath || safeRelativePath.startsWith("../")) {
    throw new Error("Obsidian note path must stay inside the vault root.")
  }

  const diagnostics: ObsidianNoteDiagnostic[] = []
  const parsedFrontmatter = readFrontmatter(source, diagnostics)
  const bodyOffset = parsedFrontmatter?.end ?? 0
  const body = source.slice(bodyOffset)
  const masked = maskCode(body)
  const lineAt = lineLocator(source)
  const headings: ParsedObsidianNote["headings"] = []
  const blocks: ParsedObsidianNote["blocks"] = []

  for (const match of masked.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) {
    const text = match[2]!.trim()
    headings.push({
      depth: match[1]!.length,
      text,
      slug: obsidianSlug(text),
      line: lineAt(bodyOffset + match.index!),
    })
  }
  for (const match of masked.matchAll(/(?:^|[ \t])\^([A-Za-z0-9][A-Za-z0-9_-]{0,199})[ \t]*$/gm)) {
    blocks.push({ id: match[1]!, line: lineAt(bodyOffset + match.index!) })
  }

  const links: ObsidianNoteLink[] = []
  const occupied: Array<[number, number]> = []
  for (const match of masked.matchAll(/(!)?\[\[([^\]\r\n]{1,1024})\]\]/g)) {
    if (links.length >= MAX_LINKS) {
      diagnostics.push({
        code: "link-limit",
        message: `Only the first ${MAX_LINKS} link candidates are indexed.`,
        line: lineAt(bodyOffset + match.index!),
      })
      break
    }
    occupied.push([match.index!, match.index! + match[0].length])
    const parts = splitObsidianTarget(match[2]!)
    const normalized = normalizeLinkTarget(parts.target, safeRelativePath, "wikilink")
    if (!normalized.ok) {
      diagnostics.push({
        code: "path-escape",
        message: `Unsafe Obsidian link target was ignored: ${parts.target}`,
        line: lineAt(bodyOffset + match.index!),
      })
      continue
    }
    links.push({
      kind: match[1] ? "embed" : "wikilink",
      target: parts.target,
      normalizedTarget: normalized.value,
      heading: parts.heading,
      blockId: parts.blockId,
      alias: parts.alias,
      line: lineAt(bodyOffset + match.index!),
    })
  }

  for (const match of masked.matchAll(/(!)?\[([^\]\r\n]{0,1024})\]\(([^)\r\n]{1,2048})\)/g)) {
    if (occupied.some(([start, end]) => match.index! >= start && match.index! < end)) continue
    if (match[1]) continue
    const destination = stripMarkdownDestinationTitle(match[3]!)
    if (/^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith("//")) continue
    const parts = splitMarkdownTarget(destination)
    const normalized = normalizeLinkTarget(parts.target, safeRelativePath, "markdown")
    if (!normalized.ok) {
      diagnostics.push({
        code: "path-escape",
        message: `Unsafe Markdown link target was ignored: ${parts.target}`,
        line: lineAt(bodyOffset + match.index!),
      })
      continue
    }
    links.push({
      kind: "markdown",
      target: parts.target,
      normalizedTarget: normalized.value,
      heading: parts.heading,
      blockId: null,
      alias: match[2]!.trim() || null,
      line: lineAt(bodyOffset + match.index!),
    })
  }

  detectMalformedLinks(masked, bodyOffset, lineAt, diagnostics)
  links.sort((left, right) => left.line - right.line)
  const inlineTags = [
    ...masked.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu),
  ].map((match) => match[1]!)
  return {
    source,
    relativePath: safeRelativePath,
    identity: parsedFrontmatter?.identity ?? null,
    aliases: parsedFrontmatter?.aliases ?? [],
    tags: boundedUnique([...(parsedFrontmatter?.tags ?? []), ...inlineTags]),
    frontmatter: parsedFrontmatter
      ? { raw: parsedFrontmatter.raw, start: 0, end: parsedFrontmatter.end }
      : null,
    headings,
    blocks,
    links,
    diagnostics,
  }
}

function readFrontmatter(
  source: string,
  diagnostics: ObsidianNoteDiagnostic[],
):
  | {
      raw: string
      end: number
      identity: ParsedObsidianNote["identity"]
      aliases: string[]
      tags: string[]
    }
  | undefined {
  const opening = source.match(/^---[ \t]*(?:\r?\n)/)
  if (!opening) return
  const tail = source.slice(opening[0].length)
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(tail)
  if (!closing) {
    diagnostics.push({
      code: "frontmatter-malformed",
      message: "Frontmatter opening marker has no bounded closing marker.",
      line: 1,
    })
    return
  }
  const end = opening[0].length + closing.index + closing[0].length
  const raw = source.slice(0, end)
  const yaml = tail.slice(0, closing.index)
  const values = parseRestrictedFrontmatter(yaml)
  if ([...values.keys()].some((key) => SECRET_KEY_PATTERN.test(key))) {
    diagnostics.push({
      code: "secret-frontmatter",
      message: "Secret-like frontmatter remains in the source but is excluded from graph metadata.",
      line: null,
    })
  }
  const rawId = firstScalar(values.get("flapstack_id") ?? values.get("flapstack-id"))
  const rawType = firstScalar(
    values.get("flapstack-kind") ??
      values.get("flapstack_kind") ??
      values.get("flapstack_type") ??
      values.get("flapstack-type"),
  )
  const rawSection = firstScalar(values.get("flapstack-section") ?? values.get("flapstack_section"))
  let identity: ParsedObsidianNote["identity"] = null
  if (rawId) {
    if (!ID_PATTERN.test(rawId) || (rawType !== null && !TYPE_PATTERN.test(rawType))) {
      diagnostics.push({
        code: "identity-invalid",
        message: "Reserved Flapstack note identity/type is malformed and was not projected.",
        line: null,
      })
    } else {
      identity = rawSection
        ? { id: rawId, type: rawType, section: rawSection }
        : { id: rawId, type: rawType }
    }
  }
  return {
    raw,
    end,
    identity,
    aliases: boundedUnique(values.get("aliases") ?? []),
    tags: boundedUnique(values.get("tags") ?? []),
  }
}

function parseRestrictedFrontmatter(yaml: string): Map<string, string[]> {
  const values = new Map<string, string[]>()
  let sequenceKey: string | null = null
  for (const line of yaml.split(/\r?\n/)) {
    const sequence = line.match(/^[ \t]+-[ \t]+(.+?)\s*$/)
    if (sequence && sequenceKey) {
      values.get(sequenceKey)!.push(unquote(sequence[1]!))
      continue
    }
    const pair = line.match(/^([A-Za-z0-9_-]{1,100})[ \t]*:[ \t]*(.*)$/)
    if (!pair) {
      sequenceKey = null
      continue
    }
    const key = pair[1]!.toLowerCase()
    const raw = pair[2]!.trim()
    sequenceKey = raw ? null : key
    if (!raw) {
      values.set(key, [])
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      values.set(
        key,
        raw
          .slice(1, -1)
          .split(",")
          .map((item) => unquote(item.trim()))
          .filter(Boolean),
      )
    } else {
      values.set(key, [unquote(raw)])
    }
  }
  return values
}

function maskCode(source: string): string {
  const characters = [...source]
  let fenced = false
  let fenceMarker = ""
  let lineStart = 0
  for (let index = 0; index <= characters.length; index += 1) {
    if (index !== characters.length && characters[index] !== "\n") continue
    const line = characters.slice(lineStart, index).join("")
    const marker = line.match(/^[ \t]*(`{3,}|~{3,})/)?.[1]
    if (marker && (!fenced || marker[0] === fenceMarker[0])) {
      fenced = !fenced
      fenceMarker = fenced ? marker : ""
      blank(characters, lineStart, index)
    } else if (fenced) {
      blank(characters, lineStart, index)
    } else {
      maskInlineCode(characters, lineStart, index)
    }
    lineStart = index + 1
  }
  return characters.join("")
}

function maskInlineCode(characters: string[], start: number, end: number) {
  let index = start
  while (index < end) {
    if (characters[index] !== "`") {
      index += 1
      continue
    }
    let ticks = 1
    while (characters[index + ticks] === "`") ticks += 1
    const marker = "`".repeat(ticks)
    const rest = characters.slice(index + ticks, end).join("")
    const close = rest.indexOf(marker)
    if (close < 0) {
      index += ticks
      continue
    }
    const finish = index + ticks + close + ticks
    blank(characters, index, finish)
    index = finish
  }
}

function blank(characters: string[], start: number, end: number) {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== "\r" && characters[index] !== "\n") characters[index] = " "
  }
}

function splitObsidianTarget(raw: string) {
  const [reference, aliasValue] = splitOnce(raw, "|")
  const [pathAndHeading, blockValue] = splitOnce(reference, "^")
  const [target, headingValue] = splitOnce(pathAndHeading, "#")
  return {
    target: decodeTarget(target.trim()),
    heading: cleanFragment(headingValue),
    blockId: cleanFragment(blockValue),
    alias: aliasValue?.trim() || null,
  }
}

function splitMarkdownTarget(raw: string) {
  const [target, heading] = splitOnce(raw, "#")
  return { target: decodeTarget(target.trim()), heading: cleanFragment(heading) }
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const index = value.indexOf(separator)
  return index < 0 ? [value, undefined] : [value.slice(0, index), value.slice(index + 1)]
}

function decodeTarget(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeLinkTarget(
  target: string,
  currentPath: string,
  kind: "wikilink" | "markdown",
): { ok: true; value: string } | { ok: false } {
  const portable = target.replace(/\\/g, "/").normalize("NFKC")
  if (
    portable.includes("\0") ||
    portable.startsWith("/") ||
    /^[A-Za-z]:/.test(portable) ||
    portable.startsWith("//")
  ) {
    return { ok: false }
  }
  const base = kind === "markdown" ? posix.dirname(currentPath) : ""
  const resolved = posix.normalize(posix.join(base, portable || currentPath))
  if (resolved === ".." || resolved.startsWith("../")) return { ok: false }
  return { ok: true, value: resolved.toLocaleLowerCase("en-US") }
}

function normalizeNotePath(value: string): string {
  const portable = value.replace(/\\/g, "/").normalize("NFKC")
  if (portable.startsWith("/") || /^[A-Za-z]:/.test(portable)) return ""
  return posix.normalize(portable)
}

function cleanFragment(value: string | undefined): string | null {
  const cleaned = value ? decodeTarget(value).trim() : ""
  return cleaned || null
}

function stripMarkdownDestinationTitle(raw: string): string {
  const trimmed = raw.trim()
  const titled = trimmed.match(/^(\S+)(?:[ \t]+["'][^"']*["'])$/)
  return titled?.[1] ?? trimmed.replace(/^<|>$/g, "")
}

function obsidianSlug(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
}

function lineLocator(source: string) {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1)
  }
  return (offset: number) => {
    let low = 0
    let high = starts.length
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2)
      if (starts[middle]! <= offset) low = middle
      else high = middle
    }
    return low + 1
  }
}

function detectMalformedLinks(
  masked: string,
  bodyOffset: number,
  lineAt: (offset: number) => number,
  diagnostics: ObsidianNoteDiagnostic[],
) {
  const withoutCompleteWiki = masked.replace(/!?\[\[[^\]\r\n]{1,1024}\]\]/g, "")
  const wikiIndex = withoutCompleteWiki.indexOf("[[")
  const markdownIndex = /\[[^\]\r\n]*\]\([^)\r\n]*$/m.exec(masked)?.index ?? -1
  const index =
    wikiIndex < 0
      ? markdownIndex
      : markdownIndex < 0
        ? wikiIndex
        : Math.min(wikiIndex, markdownIndex)
  if (index >= 0) {
    diagnostics.push({
      code: "malformed-link",
      message: "Malformed link syntax was preserved and excluded from the graph index.",
      line: lineAt(bodyOffset + index),
    })
  }
}

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function firstScalar(value: string[] | undefined): string | null {
  const scalar = value?.[0]?.trim()
  return scalar || null
}

function boundedUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 256)
}
