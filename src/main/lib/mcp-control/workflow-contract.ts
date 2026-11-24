import { z } from "zod"
import { AGENT_HARNESSES } from "../../../shared/harness-types"
import { agentProfileVersionRefSchema } from "../../../shared/agent-profiles"
import type { McpCapability, McpControlTool, McpRiskTier } from "./types"

const id = z.string().trim().min(1).max(200)
const chat = { chatId: id }
const conversation = { ...chat, subChatId: id.optional() }
const page = { offset: z.number().int().min(0).max(10_000_000).default(0) }

export const workflowSchemas = {
  fork_chat: z.object({ ...conversation, messageId: id, name: id.optional() }).strict(),
  handoff_chat: z
    .object({
      ...conversation,
      targetHarness: z.enum(AGENT_HARNESSES),
      targetModel: id,
      requestId: z.string().uuid(),
      name: id.optional(),
    })
    .strict(),
  ask_side_question: z
    .object({
      ...conversation,
      question: z.string().trim().min(1).max(12_000),
      requestId: z.string().uuid(),
      threadId: z.string().uuid().optional(),
      provider: z.enum(["claude", "codex", "ollama"]).optional(),
      model: id.optional(),
    })
    .strict(),
  set_chat_tags: z
    .object({ ...chat, tags: z.array(z.string().trim().min(1).max(32)).max(32) })
    .strict(),
  create_worktree: z
    .object({
      ...chat,
      name: id.max(100).optional(),
      baseBranch: id.regex(/^(?!-)\S+$/, "Expected a Git branch or revision.").optional(),
    })
    .strict(),
  list_changed_files: z
    .object({ ...chat, ...page, limit: z.number().int().min(1).max(100).default(50) })
    .strict(),
  read_git_diff: z
    .object({
      ...chat,
      path: z.string().min(1).max(4096).optional(),
      ...page,
      limit: z.number().int().min(1).max(32_000).default(16_000),
    })
    .strict(),
  undo_run_changes: z.object({ ...chat, runId: id }).strict(),
  speak_reply: z.object({ ...conversation, messageId: id.optional() }).strict(),
  stop_speech: z.object({}).strict(),
  update_speech_settings: z
    .object({
      ttsAdapterId: z.enum(["native-os", "kokoro"]).optional(),
      voiceId: id.nullable().optional(),
      rate: z.number().min(0.5).max(2).optional(),
      replyReadMode: z.enum(["whole", "summary"]).optional(),
      prepareReplyAudio: z.boolean().optional(),
    })
    .strict(),
  list_agent_profiles: z
    .object({ chatId: id.optional(), query: z.string().trim().max(200).default("") })
    .strict(),
  bind_agent_profile: z
    .object({ ...chat, profile: agentProfileVersionRefSchema.nullable() })
    .strict(),
}

export const desktopWorkflowToolNames: ReadonlySet<string> = new Set(Object.keys(workflowSchemas))
export const workflowInputShapes: Record<string, z.ZodRawShape | undefined> = Object.fromEntries(
  Object.entries(workflowSchemas).map(([name, schema]) => [name, schema.shape]),
)

function tool(
  name: keyof typeof workflowSchemas,
  description: string,
  tier: McpRiskTier,
  requiredCapabilities: McpCapability[] = [],
): McpControlTool {
  return { name, description, tier, requiredCapabilities, status: "implemented" }
}

export const workflowTools = [
  tool(
    "fork_chat",
    "Fork the visible conversation through the selected message into a new chat.",
    2,
    ["subagents"],
  ),
  tool(
    "handoff_chat",
    "Create a continuation chat for another provider with a compact history summary.",
    3,
    ["subagents"],
  ),
  tool(
    "ask_side_question",
    "Ask a separate question. Repeat the same request to read the answer.",
    3,
    ["subagents", "network"],
  ),
  tool(
    "set_chat_tags",
    "Replace a chat's tags by name. Pass the previous tags to restore them.",
    1,
  ),
  tool(
    "create_worktree",
    "Create and attach a managed Git worktree to a project or task chat.",
    3,
    ["git", "projectWrite", "shell"],
  ),
  tool("list_changed_files", "List a page of uncommitted files in the chat's checkout.", 0, [
    "git",
  ]),
  tool(
    "read_git_diff",
    "Read a bounded page of the chat's uncommitted diff, optionally for one file.",
    0,
    ["git"],
  ),
  tool(
    "undo_run_changes",
    "Restore a run's changes from its checkpoints, preserving later edits.",
    3,
    ["git", "projectWrite"],
  ),
  tool("speak_reply", "Read the selected or latest assistant reply aloud in the running app.", 2),
  tool("stop_speech", "Stop current desktop reply playback.", 2),
  tool(
    "update_speech_settings",
    "Change desktop read-aloud voice, adapter, rate or reply mode.",
    3,
  ),
  tool("list_agent_profiles", "List profiles available to the selected chat or caller scope.", 0),
  tool(
    "bind_agent_profile",
    "Bind an exact profile version to an unstarted chat. Pass null to clear.",
    3,
    ["subagents"],
  ),
]
