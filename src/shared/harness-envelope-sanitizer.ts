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

const TRAILING_MARKER_PREFIX =
  /(^|\n)(?:\[(?:F(?:L(?:A(?:P(?:S(?:T(?:A(?:C(?:K)?)?)?)?)?)?)?)?|U(?:S(?:E(?:R)?)?)?|FILE:?)[^\n]*|--- (?:F(?:L(?:A(?:P(?:S(?:T(?:A(?:C(?:K)?)?)?)?)?)?)?)?|U(?:S(?:E(?:R)?)?)?|B(?:E(?:G(?:I(?:N)?)?)?)?)[^\n]*)$/i

/**
 * Removes exact Flapstack prompt envelopes when a provider echoes them into
 * visible reasoning or prose. It intentionally leaves ordinary model text
 * untouched and hides an unfinished trailing envelope while it is streaming.
 */
export function sanitizeHarnessEnvelopeEcho(text: string): string {
  let sanitized = text
  for (const pattern of COMPLETE_ENVELOPES) sanitized = sanitized.replace(pattern, "$1")
  sanitized = sanitized.replace(INCOMPLETE_ENVELOPE, "$1")
  sanitized = sanitized.replace(TRAILING_MARKER_PREFIX, "$1")
  sanitized = sanitized.replace(
    /^\s*(?:\[\/(?:FLAPSTACK STARTUP CONTEXT|FLAPSTACK DEFAULTS|FLAPSTACK THREAD DEFAULTS|USER REQUEST|FILE)\]|--- END (?:FLAPSTACK (?:INTERNAL|COMPACT) CONTEXT|FLAPSTACK DEFAULTS|FLAPSTACK RESPONSE CONTRACT|USER REQUEST|LOADED FILE) ---)\s*$/gim,
    "",
  )
  sanitized = sanitized.replace(/^\s*\[\]\s*$/gm, "")
  return sanitized.replace(/\n{3,}/g, "\n\n").trim()
}
