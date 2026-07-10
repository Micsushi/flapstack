import { getReadAloudEnabled } from "./settings"

// S2.0 decision: the spoken text is harness-authored, NOT a per-reply
// summarization call. When read-aloud is on we ask the harness to emit a
// `Spoken:` / `Displayed:` split in its normal reply (Agent Hotline model,
// mirrors the user's global CLAUDE.md hotline convention). The speakable-filter
// then extracts the `Spoken:` block; the non-LLM fallback only fires when a
// reply has no `Spoken:` section. No extra model call is made for speech.

export const READ_ALOUD_INSTRUCTION = `# Read-aloud output format

Read-aloud is enabled for this chat, so your reply will be spoken with
text-to-speech. Structure every reply with two labeled sections:

Spoken:
A short, listener-ready summary of the answer. Write for the ear: plain
sentences, no code, no file paths, no diffs, no tables, no logs, no markdown.
Name options, recommendations, statuses, caveats, and next steps clearly. Avoid
vague references like "this", "that", or "the above". Keep it to one
conversational chunk; if more remains, briefly name it.

Displayed:
Everything better read than heard — code, commands, paths, diffs, logs, tables,
exact identifiers, and dense detail. Do not restate the Spoken section in full.

Keep each label alone on its own line. If there is nothing to display, omit the
Displayed section (but always include Spoken).`

/**
 * System-prompt append delivered to the harness when read-aloud is enabled.
 * Returns an empty string when read-aloud is off so normal replies are
 * untouched. Injected at harness launch (e.g. claude systemPrompt append).
 */
export function getReadAloudSystemAppend(chatId?: string): string {
  if (!getReadAloudEnabled(chatId)) return ""
  return `\n\n${READ_ALOUD_INSTRUCTION}`
}

/** Apply the same instruction where a harness only accepts a user prompt. */
export function appendReadAloudInstruction(
  prompt: string,
  enabled = getReadAloudEnabled(),
): string {
  return enabled ? `${prompt}\n\n${READ_ALOUD_INSTRUCTION}` : prompt
}
