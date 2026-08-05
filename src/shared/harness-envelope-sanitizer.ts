const COMPLETE_ENVELOPES = [
  /(^|\n)\[FLAPSTACK STARTUP CONTEXT\][\s\S]*?\[\/FLAPSTACK STARTUP CONTEXT\]\s*/gim,
  /(^|\n)\[FLAPSTACK DEFAULTS\][\s\S]*?\[\/FLAPSTACK DEFAULTS\]\s*/gim,
  /(^|\n)\[FLAPSTACK THREAD DEFAULTS\][\s\S]*?\[\/FLAPSTACK THREAD DEFAULTS\]\s*/gim,
  /(^|\n)\[USER REQUEST\][\s\S]*?\[\/USER REQUEST\]\s*/gim,
  /(^|\n)\[FILE:[^\]]*\][\s\S]*?\[\/FILE\]\s*/gim,
  /(^|\n)--- FLAPSTACK (INTERNAL|COMPACT) CONTEXT \(DO NOT QUOTE\) ---[\s\S]*?--- END FLAPSTACK \2 CONTEXT ---\s*/gim,
  /(^|\n)--- FLAPSTACK RESPONSE CONTRACT ---[\s\S]*?--- END FLAPSTACK RESPONSE CONTRACT ---\s*/gim,
  /(^|\n)--- USER REQUEST ---[\s\S]*?--- END USER REQUEST ---\s*/gim,
  /(^|\n)--- BEGIN LOADED FILE:[^\n]*---[\s\S]*?--- END LOADED FILE ---\s*/gim,
]

const INCOMPLETE_ENVELOPE =
  /(^|\n)(?:\[(?:FLAPSTACK(?: STARTUP CONTEXT| DEFAULTS| THREAD DEFAULTS)|USER REQUEST|FILE:[^\]]*)\]|--- (?:FLAPSTACK (?:INTERNAL|COMPACT) CONTEXT(?: \(DO NOT QUOTE\))?|FLAPSTACK RESPONSE CONTRACT|USER REQUEST|BEGIN LOADED FILE:[^\n]*) ---)[\s\S]*$/i

// A per-turn nonce boundary means BEGIN/END USER REQUEST markers can't be matched by a fixed
// regex: only a BEGIN whose 32-hex nonce is later followed by an END USER REQUEST marker carrying
// that same nonce closes the envelope. An END with a different (decoy) nonce doesn't close it, so
// a BEGIN with no same-nonce END anywhere after it is still an unfinished, streaming envelope and
// must stay hidden through the end of the current chunk even if a mismatched END is present.
const NONCE_ENVELOPE_BEGIN = /(^|\n)--- BEGIN USER REQUEST ([0-9a-f]{32}) ---\s*/gim
const INCOMPLETE_NONCE_ENVELOPE =
  /(^|\n)--- BEGIN USER REQUEST (?<nonce>[0-9a-f]{32}) ---(?![\s\S]*--- END USER REQUEST \k<nonce> ---)[\s\S]*$/gim

function stripCompleteNonceEnvelopes(text: string): string {
  let result = ""
  let cursor = 0
  NONCE_ENVELOPE_BEGIN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = NONCE_ENVELOPE_BEGIN.exec(text))) {
    const matchStart = match.index + match[1].length
    const nonce = match[2]
    const bodyStart = NONCE_ENVELOPE_BEGIN.lastIndex
    const endMatch = new RegExp(`--- END USER REQUEST ${nonce} ---\\s*`, "i").exec(
      text.slice(bodyStart),
    )
    if (!endMatch) continue
    result += text.slice(cursor, matchStart)
    cursor = bodyStart + endMatch.index + endMatch[0].length
    NONCE_ENVELOPE_BEGIN.lastIndex = cursor
  }
  return result + text.slice(cursor)
}

const FIXED_OPENING_MARKERS = [
  "[FLAPSTACK STARTUP CONTEXT]",
  "[FLAPSTACK DEFAULTS]",
  "[FLAPSTACK THREAD DEFAULTS]",
  "[USER REQUEST]",
  "--- FLAPSTACK INTERNAL CONTEXT (DO NOT QUOTE) ---",
  "--- FLAPSTACK COMPACT CONTEXT (DO NOT QUOTE) ---",
  "--- FLAPSTACK RESPONSE CONTRACT ---",
  "--- USER REQUEST ---",
]

const DISTINCTIVE_MARKER_PREFIXES = [
  "[FLAP",
  "[USER",
  "[FILE:",
  "--- FLAP",
  "--- USER",
  "--- BEGIN",
]

function stripTrailingMarkerPrefix(text: string): string {
  const markerStart = text.lastIndexOf("\n") + 1
  const line = text.slice(markerStart)
  if (!line) return text
  const upperLine = line.toUpperCase()
  const hasDistinctivePrefix = DISTINCTIVE_MARKER_PREFIXES.some((prefix) =>
    upperLine.startsWith(prefix),
  )
  if (!hasDistinctivePrefix) return text
  const fixedPrefix = FIXED_OPENING_MARKERS.some((marker) => marker.startsWith(upperLine))
  const variablePrefix =
    /^\[FILE(?::[^\]\n]*)?$/i.test(line) ||
    (/^--- BEGIN LOADED FILE:/i.test(line) && !/---\s*$/i.test(line)) ||
    "--- BEGIN LOADED FILE:".startsWith(upperLine) ||
    /^--- BEGIN USER REQUEST(?: [0-9a-f]{0,32})?$/i.test(line) ||
    "--- BEGIN USER REQUEST".startsWith(upperLine)
  return fixedPrefix || variablePrefix ? text.slice(0, markerStart) : text
}

/**
 * Removes exact Flapstack prompt envelopes when a provider echoes them into
 * visible reasoning or prose. It intentionally leaves ordinary model text
 * untouched and hides an unfinished trailing envelope while it is streaming.
 */
export function sanitizeHarnessEnvelopeEcho(text: string): string {
  let sanitized = text
  for (const pattern of COMPLETE_ENVELOPES) sanitized = sanitized.replace(pattern, "$1")
  sanitized = stripCompleteNonceEnvelopes(sanitized)
  sanitized = sanitized.replace(INCOMPLETE_ENVELOPE, "$1")
  sanitized = sanitized.replace(INCOMPLETE_NONCE_ENVELOPE, "$1")
  sanitized = stripTrailingMarkerPrefix(sanitized)
  sanitized = sanitized.replace(
    /^\s*(?:\[\/(?:FLAPSTACK STARTUP CONTEXT|FLAPSTACK DEFAULTS|FLAPSTACK THREAD DEFAULTS|USER REQUEST|FILE)\]|--- END (?:FLAPSTACK (?:INTERNAL|COMPACT) CONTEXT|FLAPSTACK DEFAULTS|FLAPSTACK RESPONSE CONTRACT|USER REQUEST|LOADED FILE) ---)\s*$/gim,
    "",
  )
  sanitized = sanitized.replace(/^\s*\[\]\s*$/gm, "")
  return sanitized.replace(/\n{3,}/g, "\n\n").trim()
}
