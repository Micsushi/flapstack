import { z } from "zod"

export const CHAT_TITLE_STYLES = ["concise", "balanced", "descriptive"] as const
export type ChatTitleStyle = (typeof CHAT_TITLE_STYLES)[number]

export const AUTOMATIC_USER_CHAT_TAG_KEYS = ["bug-fix", "manual-testing"] as const
export type AutomaticUserChatTagKey = (typeof AUTOMATIC_USER_CHAT_TAG_KEYS)[number]

export const AGENT_CHAT_LABEL_KEYS = [
  "coordinator",
  "reviewer",
  "worker",
  "researcher",
  "planner",
  "verifier",
] as const
export type AgentChatLabelKey = (typeof AGENT_CHAT_LABEL_KEYS)[number]

export const AUTOMATIC_CHAT_TAG_KEYS = [
  ...AUTOMATIC_USER_CHAT_TAG_KEYS,
  ...AGENT_CHAT_LABEL_KEYS,
] as const
export type AutomaticChatTagKey = (typeof AUTOMATIC_CHAT_TAG_KEYS)[number]

export type AutomaticChatTagCandidate = {
  key: AutomaticChatTagKey
  confidence: number
}

export type GeneratedChatMetadata = {
  title: string
  tags: AutomaticChatTagCandidate[]
}

const automaticUserChatTagKeys = new Set<string>(AUTOMATIC_USER_CHAT_TAG_KEYS)
const agentChatLabelKeys = new Set<string>(AGENT_CHAT_LABEL_KEYS)

export function isAutomaticUserChatTagKey(key: string): key is AutomaticUserChatTagKey {
  return automaticUserChatTagKeys.has(key)
}

export function isAgentChatLabelKey(key: string): key is AgentChatLabelKey {
  return agentChatLabelKeys.has(key)
}

const TITLE_WORD_LIMITS: Record<ChatTitleStyle, number> = {
  concise: 5,
  balanced: 8,
  descriptive: 12,
}

const generatedChatMetadataSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    tags: z
      .array(
        z
          .object({
            key: z.enum(AUTOMATIC_CHAT_TAG_KEYS),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(AUTOMATIC_CHAT_TAG_KEYS.length),
  })
  .strict()

export function chatTitleWordLimit(style: ChatTitleStyle): number {
  return TITLE_WORD_LIMITS[style]
}

export function buildChatMetadataPrompt(input: {
  userMessage: string
  titleStyle: ChatTitleStyle
  includeTags: boolean
}): string {
  const maxWords = chatTitleWordLimit(input.titleStyle)
  const message = metadataSourceMessage(input.userMessage)
  return `Create metadata for a coding-agent chat from its first user message.

settings:
title_style: ${input.titleStyle}
title_max_words: ${maxWords}
include_tags: ${input.includeTags}

title policy:
- Summarize the actual task or question. Never copy the message verbatim.
- Be direct and specific. Prefer an action plus its subject when the message asks for work.
- Preserve clear intent phrases such as "familiarize yourself with the repo"; do not prefix them with generic verbs such as Discuss.
- Omit conversational filler, provider names unless central, and generic words such as request or help.
- Use the message's language. Use sentence case, no ending punctuation, quotes, emoji, or tag text.
- A coordinator role may appear in the title only when coordinating other agents is the main job.

tag policy:
- Return only these keys: bug-fix, manual-testing, coordinator, reviewer, worker, researcher, planner, verifier.
- bug-fix and manual-testing are user-visible Chat tags. Agent roles are agent-only labels and must never be created as user tags.
- bug-fix: the main task explicitly repairs incorrect or broken behavior.
- manual-testing: the main task is explicitly a manual testing or manual fixing pass.
- coordinator: the chat coordinates, delegates to, or supervises other agents.
- reviewer: the chat reviews or audits work.
- worker: the chat implements or codes the requested work.
- researcher: the chat researches or investigates a question.
- planner: the chat plans or designs work before implementation.
- verifier: the chat verifies or tests completed work.
- Return at most one agent-role tag: coordinator, reviewer, worker, researcher, planner, or verifier.
- Mentioning a tag, describing this tagging feature, attaching a screenshot, or discussing a hypothetical does not qualify.
- Give an honest confidence from 0 to 1. Omit uncertain tags. Return no tags when include_tags is false.

output:
Return JSON only with exactly this shape:
{"title":"string","tags":[{"key":"bug-fix","confidence":0.98}]}

first_message_json:
${JSON.stringify(message.slice(0, 4_000))}`
}

export function parseGeneratedChatMetadata(
  raw: string,
  titleStyle: ChatTitleStyle,
): GeneratedChatMetadata | null {
  try {
    const parsed = generatedChatMetadataSchema.safeParse(
      JSON.parse(
        raw
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, ""),
      ),
    )
    if (!parsed.success) return null
    const title = sanitizeChatTitle(parsed.data.title, titleStyle)
    if (!title) return null

    const byKey = new Map<AutomaticChatTagKey, AutomaticChatTagCandidate>()
    for (const tag of parsed.data.tags) {
      const existing = byKey.get(tag.key)
      if (!existing || tag.confidence > existing.confidence) byKey.set(tag.key, tag)
    }
    return { title, tags: [...byKey.values()] }
  } catch {
    return null
  }
}

export function sanitizeChatTitle(title: string, style: ChatTitleStyle): string | null {
  const clean = title
    .replace(/^\s*(?:title|chat title)\s*:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!clean || clean.toLocaleLowerCase() === "new chat") return null
  return clean.split(" ").slice(0, chatTitleWordLimit(style)).join(" ").slice(0, 80).trim() || null
}

export function inferHighConfidenceChatTags(userMessage: string): AutomaticChatTagCandidate[] {
  const opening = metadataSourceMessage(userMessage)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500)
    .toLocaleLowerCase()
  const tags: AutomaticChatTagCandidate[] = []

  if (
    /^(?:please\s+)?(?:fix|debug|repair|resolve)\b/.test(opening) ||
    /^(?:this\s+)?(?:bug|regression|crash|error)\b/.test(opening)
  ) {
    tags.push({ key: "bug-fix", confidence: 0.99 })
  } else if (
    /\b(?:please|can you|could you)\s+(?:fix|debug|repair)\b.{0,80}\b(?:bug|issue|error|crash|regression|broken)\b/.test(
      opening,
    )
  ) {
    tags.push({ key: "bug-fix", confidence: 0.97 })
  } else if (
    /\b(?:broken|not working|crash(?:es|ed|ing)?|error|fail(?:s|ed|ing)?|regression)\b/.test(
      opening,
    ) &&
    /\b(?:please|can you|could you|need|fix|debug|repair|investigate|look into)\b/.test(opening)
  ) {
    tags.push({ key: "bug-fix", confidence: 0.88 })
  }

  if (/^(?:this\s+is\s+)?manual\s+(?:test(?:ing)?|fix(?:ing)?)\b/.test(opening)) {
    tags.push({ key: "manual-testing", confidence: 0.99 })
  } else if (/\bmanual\s+(?:test(?:ing)?|fix(?:ing)?)\b/.test(opening)) {
    tags.push({ key: "manual-testing", confidence: 0.85 })
  }

  const role = inferAgentRoleTag(
    opening,
    tags.some((tag) => tag.key === "manual-testing"),
  )
  if (role) tags.push(role)

  return tags
}

function inferAgentRoleTag(
  opening: string,
  isManualPass: boolean,
): AutomaticChatTagCandidate | null {
  const explicitRole = opening.match(
    /^(?:(?:please|you)\s+)?(?:act|serve|work)\s+as\s+(?:(?:the|a|an|one)\s+)?(?:[\p{L}-]+\s+){0,2}(coordinator|reviewer|worker|implementer|coder|researcher|planner|verifier|tester)\b/u,
  )?.[1]
  const declaredRole = opening.match(
    /^(?:you are|(?:this\s+)?(?:chat|thread)\s+is)\s+(?:(?:the|a|an|one)\s+)?(?:[\p{L}-]+\s+){0,3}(coordinator|reviewer|worker|implementer|coder|researcher|planner|verifier|tester)\b/u,
  )?.[1]
  const role = explicitRole ?? declaredRole
  if (role) {
    if (role === "worker" || role === "implementer" || role === "coder") {
      if (/\b(?:review|reviewing|audit|auditing)\b/.test(opening))
        return { key: "reviewer", confidence: 0.98 }
      if (/\b(?:research|researching|investigate|investigating)\b/.test(opening))
        return { key: "researcher", confidence: 0.98 }
      if (/\b(?:plan|planning|design|designing)\b/.test(opening))
        return { key: "planner", confidence: 0.98 }
      if (!isManualPass && /\b(?:verify|verifying|test|testing)\b/.test(opening))
        return { key: "verifier", confidence: 0.98 }
      return { key: "worker", confidence: 0.99 }
    }
    if (role === "tester") return { key: "verifier", confidence: 0.99 }
    return { key: role as AutomaticChatTagKey, confidence: 0.99 }
  }

  if (
    /^(?:please\s+)?(?:coordinate|delegate|supervise|orchestrate)\b.{0,80}\b(?:agents|sub-?agents)\b/.test(
      opening,
    )
  )
    return { key: "coordinator", confidence: 0.97 }
  if (/^(?:please\s+)?(?:review|audit)\b/.test(opening))
    return { key: "reviewer", confidence: 0.97 }
  if (/^(?:please\s+)?(?:implement|code)\b/.test(opening))
    return { key: "worker", confidence: 0.97 }
  if (/^(?:please\s+)?(?:research|investigate)\b/.test(opening))
    return { key: "researcher", confidence: 0.97 }
  if (/^(?:please\s+)?(?:plan|design)\b/.test(opening)) return { key: "planner", confidence: 0.97 }
  if (!isManualPass && /^(?:please\s+)?(?:verify|test|check)\b/.test(opening))
    return { key: "verifier", confidence: 0.97 }
  if (/\b(?:delegate|sub-?agents|parallel agents)\b/.test(opening))
    return { key: "coordinator", confidence: 0.82 }
  return null
}

export function fallbackChatMetadata(
  userMessage: string,
  titleStyle: ChatTitleStyle,
): GeneratedChatMetadata {
  const tags = inferHighConfidenceChatTags(userMessage)
  const normalized = metadataSourceMessage(userMessage)
    .normalize("NFKC")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()

  const action = fallbackAction(normalized, tags)
  const subjectWordBudget = Math.max(1, chatTitleWordLimit(titleStyle) - action.split(/\s+/).length)
  const subject = fallbackSubject(normalized, subjectWordBudget)
  const title = sanitizeChatTitle(`${action} ${subject}`.trim(), titleStyle)
  return { title: title ?? "New chat", tags }
}

function metadataSourceMessage(userMessage: string): string {
  const delegatedInput = userMessage.match(
    /<codex_delegation>[\s\S]*?<input>([\s\S]*?)<\/input>[\s\S]*?<\/codex_delegation>/i,
  )?.[1]
  return (delegatedInput ?? userMessage).trim()
}

function fallbackAction(message: string, tags: AutomaticChatTagCandidate[]): string {
  if (tags.some((tag) => tag.key === "coordinator")) return "Coordinate"
  if (tags.some((tag) => tag.key === "reviewer")) return "Review"
  if (tags.some((tag) => tag.key === "worker")) return "Implement"
  if (tags.some((tag) => tag.key === "researcher")) return "Research"
  if (tags.some((tag) => tag.key === "planner")) return "Plan"
  if (tags.some((tag) => tag.key === "verifier")) return "Verify"
  if (tags.some((tag) => tag.key === "manual-testing")) return "Test"
  if (tags.some((tag) => tag.key === "bug-fix")) return "Fix"
  if (/\b(?:familiari[sz](?:e|ed|ing|ation)|get familiar(?:ized)? with)\b/i.test(message))
    return "Familiarize yourself with"
  if (
    /\b(?:broken|crash(?:es|ed|ing)?|error|fail(?:s|ed|ing)?|not working|got stopped)\b/i.test(
      message,
    )
  )
    return "Investigate"
  if (/\b(?:review|audit)\b/i.test(message)) return "Review"
  if (/\b(?:why|explain|how does|how do)\b/i.test(message)) return "Explain"
  if (/\b(?:test|verify|check)\b/i.test(message)) return "Check"
  if (/\b(?:find|research|investigate|look into)\b/i.test(message)) return "Investigate"
  if (/\b(?:remove|delete)\b/i.test(message)) return "Remove"
  if (/\b(?:add|implement|build|create)\b/i.test(message)) return "Add"
  if (/\b(?:improve|change|update|redesign|configure|enable)\b/i.test(message)) return "Improve"
  return "Discuss"
}

function fallbackSubject(message: string, limit: number): string {
  const stopWords = new Set([
    "about",
    "actually",
    "also",
    "and",
    "basically",
    "because",
    "but",
    "can",
    "could",
    "different",
    "does",
    "doing",
    "for",
    "from",
    "have",
    "help",
    "here",
    "how",
    "into",
    "just",
    "like",
    "make",
    "need",
    "noticed",
    "please",
    "really",
    "should",
    "some",
    "start",
    "that",
    "the",
    "their",
    "then",
    "there",
    "these",
    "thing",
    "this",
    "those",
    "want",
    "when",
    "where",
    "what",
    "which",
    "with",
    "would",
    "you",
    "your",
    "yourself",
    "add",
    "build",
    "change",
    "check",
    "create",
    "debug",
    "delete",
    "enable",
    "explain",
    "familiarize",
    "familiarized",
    "familiarizing",
    "familiarisation",
    "familiarization",
    "familiar",
    "fix",
    "implement",
    "improve",
    "investigate",
    "remove",
    "review",
    "test",
    "update",
  ])
  const words = message.match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) ?? []
  const candidates = words
    .map((word, index) => ({ word, index, normalized: word.toLocaleLowerCase() }))
    .filter(({ normalized }) => normalized.length > 2 && !stopWords.has(normalized))
  if (candidates.length === 0) return words.slice(0, Math.max(1, limit)).join(" ") || "chat"

  const counts = new Map<string, number>()
  for (const candidate of candidates) {
    counts.set(candidate.normalized, (counts.get(candidate.normalized) ?? 0) + 1)
  }
  return candidates
    .filter(
      (candidate, index, list) =>
        list.findIndex((item) => item.normalized === candidate.normalized) === index,
    )
    .sort(
      (left, right) =>
        (counts.get(right.normalized) ?? 0) - (counts.get(left.normalized) ?? 0) ||
        left.index - right.index,
    )
    .slice(0, Math.max(1, limit))
    .sort((left, right) => left.index - right.index)
    .map(({ word }) => word)
    .join(" ")
}
