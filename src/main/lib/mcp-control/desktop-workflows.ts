import { z } from "zod"
import { getSqliteDatabase } from "../db"
import { AgentProfileChatBindingService } from "../agent-profiles/chat-binding"
import { getSideQuestionService } from "../side-questions"
import { extractVisibleMessageParts } from "../../../shared/chat-visible-content"
import { undoRunChangeSet } from "../run-change-undo"
import { chatsRouter } from "../trpc/routers/chats"
import { speechRouter } from "../trpc/routers/speech"
import { getVoiceSettings } from "../speech/settings"
import { requestDesktopSpeech } from "../speech/desktop-playback"
import { workflowSchemas as schemas } from "./workflow-contract"
import {
  replaceWorkflowTags,
  requireWorkflowChat,
  requireWorkflowAuthority,
  workflowConversation,
  WorkflowError,
} from "./workflow-targets"
import type { McpCallerIdentity, McpControlResponse } from "./types"

const desktopContext = { getWindow: () => null }

export async function invokeDesktopWorkflow(
  name: string,
  caller: McpCallerIdentity,
  raw: unknown,
  _context: { invocationId: string; approved: boolean },
): Promise<McpControlResponse> {
  try {
    const data = await dispatch(name, caller, raw)
    return { ok: true, data }
  } catch (error) {
    if (error instanceof z.ZodError)
      return {
        ok: false,
        error: { code: "invalid-input", message: error.issues[0]?.message ?? "Invalid input." },
      }
    return {
      ok: false,
      error: {
        code: error instanceof WorkflowError ? error.code : "conflict",
        message: error instanceof Error ? error.message : "Desktop operation failed.",
      },
    }
  }
}

async function dispatch(name: string, caller: McpCallerIdentity, raw: unknown) {
  const db = getSqliteDatabase()
  const chats = chatsRouter.createCaller(desktopContext)
  const profiles = new AgentProfileChatBindingService(db)
  const target = (chatId: string) => requireWorkflowChat(db, caller, chatId)
  const conversation = (input: { chatId: string; subChatId?: string }) =>
    workflowConversation(db, input.chatId, input.subChatId)

  switch (name) {
    case "fork_chat": {
      const input = schemas.fork_chat.parse(raw)
      requireWorkflowAuthority(caller, target(input.chatId))
      const fork = await chats.forkSubChat({
        subChatId: conversation(input),
        messageId: input.messageId,
        name: input.name,
      })
      return { chatId: fork.chat.id, subChatId: fork.subChat.id, messageCount: fork.messageCount }
    }
    case "handoff_chat": {
      const input = schemas.handoff_chat.parse(raw)
      requireWorkflowAuthority(caller, target(input.chatId))
      if (profiles.get(input.chatId))
        throw new WorkflowError(
          "permission-denied",
          "A continuation cannot drop a bound Agent Profile.",
        )
      const request = {
        sourceChatId: input.chatId,
        compactSourceSubChatId: conversation(input),
        requestId: input.requestId,
        name: input.name,
        targetHarness: input.targetHarness,
        targetModel: input.targetModel,
        preference:
          input.targetHarness === "codex" || input.targetHarness === "claude-code"
            ? input.targetHarness
            : ("flapstack-native" as const),
      }
      const preview = await chats.previewRuntimeContinuation(request)
      requireWorkflowAuthority(caller, target(input.chatId))
      const result = await chats.continueWithRuntime({
        ...request,
        confirmedPreviewDigest: preview.digest,
      })
      return {
        ...result,
        summary: preview.contextText.slice(0, 16_000),
        truncated: preview.contextText.length > 16_000,
      }
    }
    case "ask_side_question": {
      const input = schemas.ask_side_question.parse(raw)
      target(input.chatId)
      const { chatId: _chatId, ...question } = input
      return getSideQuestionService().ask({ ...question, subChatId: conversation(input) })
    }
    case "set_chat_tags": {
      const input = schemas.set_chat_tags.parse(raw)
      target(input.chatId)
      return replaceWorkflowTags(db, input.chatId, input.tags)
    }
    case "create_worktree": {
      const input = schemas.create_worktree.parse(raw)
      target(input.chatId)
      if (
        db
          .prepare("SELECT 1 FROM agent_runs WHERE chat_id=? AND status IN ('queued','running')")
          .get(input.chatId)
      ) {
        throw new WorkflowError(
          "conflict",
          "Wait for the chat's active runs before changing its checkout.",
        )
      }
      const chat = await chats.createWorktreeForExistingChat({
        id: input.chatId,
        baseBranch: input.baseBranch ?? "HEAD",
        branchType: "local",
        name: input.name,
      })
      return {
        chatId: chat.id,
        path: chat.worktreePath,
        branch: chat.branch,
        baseBranch: chat.baseBranch,
      }
    }
    case "list_changed_files":
    case "read_git_diff": {
      const input =
        name === "list_changed_files"
          ? schemas.list_changed_files.parse(raw)
          : schemas.read_git_diff.parse(raw)
      target(input.chatId)
      const result = await chats.getParsedDiff({ chatId: input.chatId, includeContents: false })
      target(input.chatId)
      if ("error" in result && result.error) throw new WorkflowError("conflict", result.error)
      if (result.unchanged) throw new WorkflowError("conflict", "Refresh the changed-file list.")
      if (name === "list_changed_files") {
        const page = result.files.slice(input.offset, input.offset + input.limit)
        return {
          files: page.map(({ oldPath, newPath, additions, deletions, isBinary }) => ({
            oldPath,
            newPath,
            additions,
            deletions,
            isBinary,
          })),
          total: result.files.length,
          diffHash: result.diffHash,
        }
      }
      const path = "path" in input ? input.path : undefined
      const files = path
        ? result.files.filter((file) => file.newPath === path || file.oldPath === path)
        : result.files
      if (path && !files.length)
        throw new WorkflowError("not-found", "File has no uncommitted diff.")
      const text = files.map((file) => file.diffText).join("\n")
      return {
        diff: text.slice(input.offset, input.offset + input.limit),
        total: text.length,
        offset: input.offset,
        diffHash: result.diffHash,
      }
    }
    case "undo_run_changes": {
      const input = schemas.undo_run_changes.parse(raw)
      target(input.chatId)
      if (
        !db
          .prepare("SELECT 1 FROM agent_runs WHERE id=? AND chat_id=?")
          .get(input.runId, input.chatId)
      ) {
        throw new WorkflowError("stale-target", "Run is missing from this chat.")
      }
      const result = await undoRunChangeSet(input.runId)
      if (!result.success)
        throw new WorkflowError(
          "conflict",
          `Checkpoint restore would overlap later edits in ${result.conflicts
            .map((file) => file.filePath)
            .join(", ")
            .slice(0, 2000)}.`,
        )
      return result
    }
    case "speak_reply": {
      const input = schemas.speak_reply.parse(raw)
      target(input.chatId)
      const subChatId = conversation(input)
      const row = db
        .prepare(
          `
        SELECT m.value message FROM sub_chats s, json_each(s.messages) m
        WHERE s.id=? AND s.chat_id=? AND m.value ->> '$.role'='assistant'
          AND (? IS NULL OR m.value ->> '$.id'=?)
        ORDER BY CAST(m.key AS INTEGER) DESC LIMIT 1
      `,
        )
        .get(subChatId, input.chatId, input.messageId ?? null, input.messageId ?? null) as
        { message: string } | undefined
      if (!row)
        throw new WorkflowError(
          "not-found",
          "No assistant reply found in the selected conversation.",
        )
      const message = z
        .object({ id: z.string(), content: z.unknown().optional(), parts: z.unknown().optional() })
        .parse(JSON.parse(row.message))
      const parts = extractVisibleMessageParts({ parts: message.parts ?? message.content })
      const text =
        parts
          .filter((part) => part.partType === "text")
          .map((part) => part.text)
          .join("\n") || (typeof message.content === "string" ? message.content : "")
      if (!text.trim())
        throw new WorkflowError("not-found", "This assistant reply has no text to read aloud.")
      return {
        messageId: message.id,
        ...requestDesktopSpeech(caller, {
          kind: "speak",
          chatId: input.chatId,
          subChatId,
          messageId: message.id,
          text,
          rate: getVoiceSettings().rate,
        }),
      }
    }
    case "stop_speech":
      schemas.stop_speech.parse(raw)
      return requestDesktopSpeech(caller, { kind: "stop" })
    case "update_speech_settings": {
      const input = schemas.update_speech_settings.parse(raw)
      if (caller.projectId || caller.taskId)
        throw new WorkflowError(
          "out-of-scope",
          "Changing desktop voice settings requires global scope.",
        )
      const previous = getVoiceSettings()
      const adapter = input.ttsAdapterId ?? previous.ttsAdapterId
      const next = await speechRouter.createCaller(desktopContext).updateSettings({
        ...input,
        ...(input.voiceId !== undefined
          ? { voiceByTtsAdapterId: { ...previous.voiceByTtsAdapterId, [adapter]: input.voiceId } }
          : {}),
      })
      const summary = (value: typeof next) => ({
        ttsAdapterId: value.ttsAdapterId,
        voiceId: value.voiceByTtsAdapterId[value.ttsAdapterId] ?? value.voiceId,
        rate: value.rate,
        replyReadMode: value.replyReadMode,
        prepareReplyAudio: value.prepareReplyAudio,
      })
      return { previous: summary(previous), settings: summary(next) }
    }
    case "list_agent_profiles": {
      const input = schemas.list_agent_profiles.parse(raw)
      if (input.chatId) {
        target(input.chatId)
        return profiles.searchForChat(input.chatId, input.query)
      }
      return profiles.searchForNewChat({
        scope: caller.taskId ? "task" : caller.projectId ? "project" : "global",
        projectId: caller.projectId ?? undefined,
        taskId: caller.taskId ?? undefined,
        query: input.query,
      })
    }
    case "bind_agent_profile": {
      const input = schemas.bind_agent_profile.parse(raw)
      requireWorkflowAuthority(caller, target(input.chatId))
      const previous = profiles.get(input.chatId)?.snapshot.profile ?? null
      if (input.profile) {
        const preview = profiles.preview({ chatId: input.chatId, profile: input.profile })
        profiles.bind({
          chatId: input.chatId,
          profile: input.profile,
          expectedDigest: preview.digest,
        })
      } else profiles.clear(input.chatId)
      return { chatId: input.chatId, profile: input.profile, previous }
    }
    default:
      throw new WorkflowError("tool-not-found", "Unknown desktop workflow.")
  }
}
