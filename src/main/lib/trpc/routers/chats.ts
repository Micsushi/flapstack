import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import { BrowserWindow, dialog } from "electron"
import * as fs from "fs/promises"
import * as path from "path"
import simpleGit from "simple-git"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { getAuthManager } from "../../../index"
import {
  trackPRCreated,
  trackWorkspaceArchived,
  trackWorkspaceCreated,
  trackWorkspaceDeleted,
} from "../../analytics"
import {
  agentRuns,
  chats,
  chatTagAssignments,
  chatTags,
  getDatabase,
  getDatabasePath,
  projects,
  subChats,
  tasks,
} from "../../db"
import { CHAT_TAG_COLORS, CHAT_TAG_ICONS } from "../../chat-tags"
import { restoreCheckpoint } from "../../checkpoints"
import {
  createWorktreeForChat,
  fetchGitHubPRStatus,
  getWorktreeDiff,
  removeWorktree,
  sanitizeProjectName,
} from "../../git"
import {
  bindFilesystemRootIdentity,
  rebindRegisteredFilesystemRoot,
} from "../../git/security/path-validation"
import type { WorktreeSetupResult } from "../../git/worktree-config"
import { computeContentHash, gitCache } from "../../git/cache"
import { splitUnifiedDiffByFile } from "../../git/diff-parser"
import { execWithShellEnv } from "../../git/shell-env"
import { applyRollbackStash } from "../../git/stash"
import { checkInternetConnection, checkOllamaStatus } from "../../ollama"
import { terminalManager } from "../../terminal/manager"
import {
  getDetachedChatCheckoutPath,
  getResolvedWorktreeStatus,
  isDetachedChatCheckoutPath,
  isManagedFlapstackWorktreePath,
  listWorktreeOptions,
  resolveDefaultWorktree,
  validateCustomWorktreePath,
} from "../../worktree-resolver"
import { publicProcedure, router } from "../index"
import { ensureTaskPrimaryWorktree } from "./tasks"
import { deleteVoiceHistoryForChat } from "../../speech/history"
import { getNextChatForkName } from "../../chat-fork-name"
import { formatChatHandoff } from "../../chat-handoff"
import { getPermissionPreferences } from "../../permissions"
import { omitHiddenFileContentFromMessage } from "../../../../shared/chat-visible-content"
import {
  agentRuntimePreferenceSchema,
  type AgentRuntimePreference,
} from "../../../../shared/agent-runtime"
import { customPermissionCapabilitiesSchema } from "../../../../shared/permission-capabilities"
import { createRuntimeChatLifecycleService } from "../../agent-runtime/chat-lifecycle"
import { CrossProviderDelegationService } from "../../agent-runtime/cross-provider-delegation"
import { getMainRuntimeLaunchService } from "../../main-run-launcher"
import { CHAT_MODES } from "../../../../shared/chat-mode"
import { mergeRuntimeMessages } from "../../agent-runtime/message-merge"
import {
  AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES,
  agentProfileVersionRefSchema,
} from "../../../../shared/agent-profiles"
import { AgentProfileChatBindingService } from "../../agent-profiles/chat-binding"

const newChatPermissionModeSchema = z.enum([
  "read-only",
  "ask-before-edits",
  "auto-edit-project-only",
  "full-access",
])
const chatTagColorSchema = z.enum(CHAT_TAG_COLORS)
const chatTagIconSchema = z.enum(CHAT_TAG_ICONS)

function normalizedTagName(name: string) {
  const clean = name.trim().replace(/\s+/g, " ")
  if (!clean) throw new Error("Tag name is required")
  return { name: clean, normalizedName: clean.toLocaleLowerCase() }
}

const runtimeDelegationInputSchema = z.object({
  sourceChatId: z.string().trim().min(1).max(200),
  targetHarness: z.enum(["claude-code", "codex", "cursor-agent", "openrouter", "nanogpt", "local"]),
  targetModel: z.string().trim().min(1).max(240),
  preference: agentRuntimePreferenceSchema,
  requestId: z.string().trim().min(8).max(200),
  name: z.string().trim().min(1).max(200).optional(),
  objective: z.string().trim().min(1).max(100_000),
  selectedMessageIds: z.array(z.string().trim().min(1).max(512)).max(1_000).optional(),
  selectedFileRefs: z.array(z.string().trim().min(1).max(512)).max(1_000).optional(),
  selectedArtifactRefs: z.array(z.string().trim().min(1).max(512)).max(1_000).optional(),
  requiredCapabilities: z.array(z.string().trim().min(1).max(512)).max(100).optional(),
  outputSchema: z.record(z.unknown()).nullable().optional(),
  priorAttemptId: z.string().trim().min(1).max(512).nullable().optional(),
  deadline: z.string().datetime().nullable().optional(),
  confirmedPreviewDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  authorityRestrictions: z
    .object({
      permissionMode: z
        .enum(["read-only", "ask-before-edits", "auto-edit-project-only", "full-access", "custom"])
        .optional(),
      customPermissions: customPermissionCapabilitiesSchema.nullable().optional(),
      allowedToolTiers: z
        .array(z.enum(["read", "project-write", "shell", "git", "network"]))
        .max(5)
        .optional(),
      network: z.boolean().optional(),
      maxDescendantDepth: z.number().int().min(0).max(64).optional(),
      tokenBudget: z.number().int().positive().nullable().optional(),
      costBudgetMicros: z.number().int().nonnegative().nullable().optional(),
    })
    .strict()
    .optional(),
})

function runtimeDelegationService() {
  const databasePath = getDatabasePath()
  return new CrossProviderDelegationService(databasePath, getMainRuntimeLaunchService(databasePath))
}

async function probedRuntimePreferenceLifecycle(input: {
  chatId: string
  preference: AgentRuntimePreference
}) {
  const database = getDatabase()
  const identity = createRuntimeChatLifecycleService(database).preferenceIdentity(input)
  const probe = await getMainRuntimeLaunchService(getDatabasePath()).probe(
    identity.runtime,
    identity.harness,
  )
  return createRuntimeChatLifecycleService(database, (harness, runtime) =>
    harness === identity.harness && runtime === identity.runtime ? probe : null,
  )
}

async function probedRuntimeLifecycle(
  input: Parameters<ReturnType<typeof createRuntimeChatLifecycleService>["targetIdentity"]>[0],
) {
  const database = getDatabase()
  const identity = createRuntimeChatLifecycleService(database).targetIdentity(input)
  const probe = await getMainRuntimeLaunchService(getDatabasePath()).probe(
    identity.runtime,
    identity.harness,
  )
  return {
    lifecycle: createRuntimeChatLifecycleService(database, (harness, runtime) =>
      harness === identity.harness && runtime === identity.runtime ? probe : null,
    ),
    probe,
  }
}

type CheckoutRepairResult =
  | {
      status: "repaired"
      path: string
      branch: string | null
      repairedChatIds: string[]
      detached: boolean
    }
  | { status: "cancelled" }

async function persistChatCheckout(input: {
  chatId: string
  requestedPath: string
  repairMatchingChats: boolean
  matchingPath?: string | null
}): Promise<CheckoutRepairResult> {
  const db = getDatabase()
  const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
  if (!chat) throw new Error("Chat not found")

  const target = await validateCustomWorktreePath(input.requestedPath)
  if (!target.valid) throw new Error(target.error)

  // A selected checkout becomes a durable run root, so bind its filesystem
  // identity before persisting it. Later replacement or symlink swaps fail closed.
  bindFilesystemRootIdentity(target.path)

  let affected = [{ id: chat.id }]
  const matchingPath = input.matchingPath?.trim() || chat.worktreePath
  if (input.repairMatchingChats && chat.projectId && matchingPath) {
    const matching = db
      .select({ id: chats.id })
      .from(chats)
      .where(and(eq(chats.projectId, chat.projectId), eq(chats.worktreePath, matchingPath)))
      .all()
    affected = [{ id: chat.id }, ...matching.filter((candidate) => candidate.id !== chat.id)]
  }

  const repairedChatIds = affected.map((row) => row.id)
  if (repairedChatIds.length === 0) repairedChatIds.push(chat.id)
  const updatedAt = new Date()

  db.transaction((tx) => {
    tx.update(chats)
      .set({
        worktreePath: target.path,
        branch: target.branch,
        baseBranch: null,
        updatedAt,
      })
      .where(inArray(chats.id, repairedChatIds))
      .run()

    const staleSubChatPathCondition = matchingPath
      ? or(isNull(subChats.worktreePath), eq(subChats.worktreePath, matchingPath))
      : isNull(subChats.worktreePath)
    tx.update(subChats)
      .set({ worktreePath: target.path, updatedAt })
      .where(and(inArray(subChats.chatId, repairedChatIds), staleSubChatPathCondition))
      .run()
  })

  return {
    status: "repaired",
    path: target.path,
    branch: target.branch,
    repairedChatIds,
    detached: isDetachedChatCheckoutPath(target.path),
  }
}

async function ensureDetachedChatCheckout(chatId: string): Promise<string> {
  const checkoutPath = getDetachedChatCheckoutPath(chatId)
  await fs.mkdir(checkoutPath, { recursive: true })
  const git = simpleGit(checkoutPath)
  if (!(await git.checkIsRepo())) await git.init()
  return checkoutPath
}

type WorktreeSetupFailurePayload = {
  kind: "create-failed" | "setup-failed"
  message: string
  projectId: string
}

function sendWorktreeSetupFailure(
  windowId: number | null,
  payload: WorktreeSetupFailurePayload,
): void {
  const targets: BrowserWindow[] = []

  if (windowId !== null) {
    const window = BrowserWindow.fromId(windowId)
    if (window && !window.isDestroyed()) {
      targets.push(window)
    }
  }

  if (targets.length === 0) {
    targets.push(...BrowserWindow.getAllWindows())
  }

  for (const window of targets) {
    if (window.isDestroyed()) continue
    window.webContents.send("worktree:setup-failed", payload)
  }
}

// Preserve the complete fallback name. The renderer owns visual truncation.
function getFallbackName(userMessage: string): string {
  const trimmed = userMessage.trim()
  return trimmed || "New Chat"
}

/**
 * Generate text using local Ollama model
 * Used for chat title generation in offline mode
 * @param userMessage - The user message to generate a title for
 * @param model - Optional model to use (if not provided, uses recommended model)
 */
async function generateChatNameWithOllama(
  userMessage: string,
  model?: string | null,
): Promise<string | null> {
  try {
    const ollamaStatus = await checkOllamaStatus()
    if (!ollamaStatus.available) {
      return null
    }

    // Use provided model, or recommended, or first available
    const modelToUse = model || ollamaStatus.recommendedModel || ollamaStatus.models[0]
    if (!modelToUse) {
      console.error("[Ollama] No model available")
      return null
    }

    const prompt = `Generate a very short (2-5 words) title for a coding chat that starts with this message. The title MUST be in the same language as the user's message. Only output the title, nothing else. No quotes, no explanations.

User message: "${userMessage.slice(0, 500)}"

Title:`

    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelToUse,
        prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 50,
        },
      }),
    })

    if (!response.ok) {
      console.error("[Ollama] Generate chat name failed:", response.status)
      return null
    }

    const data = await response.json()
    const result = data.response?.trim()
    if (result) {
      // Clean up the result - remove quotes, trim, limit length
      const cleaned = result
        .replace(/^["']|["']$/g, "")
        .replace(/^title:\s*/i, "")
        .trim()
        .slice(0, 50)
      if (cleaned.length > 0) {
        return cleaned
      }
    }
    return null
  } catch (error) {
    console.error("[Ollama] Generate chat name error:", error)
    return null
  }
}

/**
 * Generate commit message using local Ollama model
 * Used for commit message generation in offline mode
 * @param diff - The diff text
 * @param fileCount - Number of files changed
 * @param additions - Lines added
 * @param deletions - Lines deleted
 * @param model - Optional model to use (if not provided, uses recommended model)
 */
async function generateCommitMessageWithOllama(
  diff: string,
  fileCount: number,
  additions: number,
  deletions: number,
  model?: string | null,
): Promise<string | null> {
  try {
    const ollamaStatus = await checkOllamaStatus()
    if (!ollamaStatus.available) {
      return null
    }

    // Use provided model, or recommended, or first available
    const modelToUse = model || ollamaStatus.recommendedModel || ollamaStatus.models[0]
    if (!modelToUse) {
      console.error("[Ollama] No model available")
      return null
    }

    const prompt = `Generate a conventional commit message for these changes. Use format: type: short description

Types: feat (new feature), fix (bug fix), docs, style, refactor, test, chore

Changes: ${fileCount} files, +${additions}/-${deletions} lines

Diff (truncated):
${diff.slice(0, 3000)}

Commit message:`

    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelToUse,
        prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 50,
        },
      }),
    })

    if (!response.ok) {
      console.error("[Ollama] Generate commit message failed:", response.status)
      return null
    }

    const data = await response.json()
    const result = data.response?.trim()
    if (result) {
      // Clean up - get just the first line
      const firstLine = result.split("\n")[0]?.trim()
      if (firstLine && firstLine.length > 0 && firstLine.length < 100) {
        return firstLine
      }
    }
    return null
  } catch (error) {
    console.error("[Ollama] Generate commit message error:", error)
    return null
  }
}

export const chatsRouter = router({
  /**
   * List all non-archived chats (optionally filter by project)
   */
  list: publicProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        taskId: z.string().optional(),
        scope: z.enum(["global", "project", "task"]).optional(),
      }),
    )
    .query(({ input }) => {
      const db = getDatabase()
      const conditions = [isNull(chats.archivedAt)]
      if (input.projectId) conditions.push(eq(chats.projectId, input.projectId))
      if (input.taskId) conditions.push(eq(chats.taskId, input.taskId))
      if (input.scope) conditions.push(eq(chats.scope, input.scope))

      return db
        .select()
        .from(chats)
        .where(and(...conditions))
        .orderBy(desc(chats.pinnedAt), desc(chats.updatedAt))
        .all()
    }),

  /**
   * List archived chats (optionally filter by project)
   */
  listArchived: publicProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        taskId: z.string().optional(),
        scope: z.enum(["global", "project", "task"]).optional(),
      }),
    )
    .query(({ input }) => {
      const db = getDatabase()
      const conditions = [isNotNull(chats.archivedAt)]
      if (input.projectId) conditions.push(eq(chats.projectId, input.projectId))
      if (input.taskId) conditions.push(eq(chats.taskId, input.taskId))
      if (input.scope) conditions.push(eq(chats.scope, input.scope))
      return db
        .select()
        .from(chats)
        .where(and(...conditions))
        .orderBy(desc(chats.archivedAt))
        .all()
    }),

  archiveSummary: publicProcedure.query(() => {
    const db = getDatabase()
    const chatCount = Number(
      db
        .select({ value: sql<number>`count(*)` })
        .from(chats)
        .where(isNotNull(chats.archivedAt))
        .get()?.value ?? 0,
    )
    const projectCount = Number(
      db
        .select({ value: sql<number>`count(*)` })
        .from(projects)
        .where(isNotNull(projects.archivedAt))
        .get()?.value ?? 0,
    )
    const taskCount = Number(
      db
        .select({ value: sql<number>`count(*)` })
        .from(tasks)
        .where(isNotNull(tasks.archivedAt))
        .get()?.value ?? 0,
    )
    return { chatCount, projectCount, taskCount, total: chatCount + projectCount + taskCount }
  }),

  listTags: publicProcedure.query(() => {
    return getDatabase().select().from(chatTags).orderBy(chatTags.normalizedName).all()
  }),

  listTagAssignments: publicProcedure.query(() => {
    return getDatabase()
      .select({ chatId: chatTagAssignments.chatId, tag: chatTags })
      .from(chatTagAssignments)
      .innerJoin(chatTags, eq(chatTagAssignments.tagId, chatTags.id))
      .orderBy(chatTags.normalizedName, chatTags.id)
      .all()
  }),

  createTag: publicProcedure
    .input(
      z.object({
        name: z.string().max(32),
        color: chatTagColorSchema,
        icon: chatTagIconSchema.nullable().optional(),
      }),
    )
    .mutation(({ input }) => {
      const names = normalizedTagName(input.name)
      try {
        return getDatabase()
          .insert(chatTags)
          .values({ ...names, color: input.color, icon: input.icon ?? null })
          .returning()
          .get()
      } catch (error) {
        if (error instanceof Error && /unique/i.test(error.message)) {
          throw new Error(`A tag named '${names.name}' already exists`)
        }
        throw error
      }
    }),

  updateTag: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().max(32),
        color: chatTagColorSchema,
        icon: chatTagIconSchema.nullable().optional(),
      }),
    )
    .mutation(({ input }) => {
      const names = normalizedTagName(input.name)
      const updated = getDatabase()
        .update(chatTags)
        .set({
          ...names,
          color: input.color,
          ...(input.icon === undefined ? {} : { icon: input.icon }),
          updatedAt: new Date(),
        })
        .where(eq(chatTags.id, input.id))
        .returning()
        .get()
      if (!updated) throw new Error("Tag not found")
      return updated
    }),

  deleteTag: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    getDatabase().delete(chatTags).where(eq(chatTags.id, input.id)).run()
    return { success: true }
  }),

  assignTag: publicProcedure
    .input(z.object({ chatId: z.string(), tagId: z.string() }))
    .mutation(({ input }) => {
      getDatabase().insert(chatTagAssignments).values(input).onConflictDoNothing().run()
      return { success: true }
    }),

  unassignTag: publicProcedure
    .input(z.object({ chatId: z.string(), tagId: z.string() }))
    .mutation(({ input }) => {
      getDatabase()
        .delete(chatTagAssignments)
        .where(
          and(
            eq(chatTagAssignments.chatId, input.chatId),
            eq(chatTagAssignments.tagId, input.tagId),
          ),
        )
        .run()
      return { success: true }
    }),

  /**
   * Get a single chat with all sub-chats
   */
  get: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const db = getDatabase()
    const chat = db.select().from(chats).where(eq(chats.id, input.id)).get()
    if (!chat) return null

    const chatSubChats = db
      .select()
      .from(subChats)
      .where(eq(subChats.chatId, input.id))
      .orderBy(subChats.createdAt)
      .all()

    const project = chat.projectId
      ? db.select().from(projects).where(eq(projects.id, chat.projectId)).get()
      : null

    return { ...chat, subChats: chatSubChats, project }
  }),

  getMetadata: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const db = getDatabase()
    const chat = db.select().from(chats).where(eq(chats.id, input.id)).get()
    if (!chat) return null

    const chatSubChats = db
      .select({
        id: subChats.id,
        name: subChats.name,
        chatId: subChats.chatId,
        sessionId: subChats.sessionId,
        streamId: subChats.streamId,
        mode: subChats.mode,
        harness: subChats.harness,
        model: subChats.model,
        permissionMode: subChats.permissionMode,
        worktreePath: subChats.worktreePath,
        runStatus: subChats.runStatus,
        createdAt: subChats.createdAt,
        updatedAt: subChats.updatedAt,
      })
      .from(subChats)
      .where(eq(subChats.chatId, input.id))
      .orderBy(subChats.createdAt)
      .all()

    const project = chat.projectId
      ? db.select().from(projects).where(eq(projects.id, chat.projectId)).get()
      : null

    return { ...chat, subChats: chatSubChats, project }
  }),

  getTranscript: publicProcedure
    .input(z.object({ chatId: z.string(), subChatId: z.string() }))
    .query(({ input }) =>
      getDatabase()
        .select({
          id: subChats.id,
          chatId: subChats.chatId,
          messages: subChats.messages,
          updatedAt: subChats.updatedAt,
        })
        .from(subChats)
        .where(and(eq(subChats.id, input.subChatId), eq(subChats.chatId, input.chatId)))
        .get(),
    ),

  listWorktreeOptions: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    return listWorktreeOptions(input.id)
  }),

  resolveWorktreeStatus: publicProcedure
    .input(z.object({ id: z.string(), path: z.string().optional() }))
    .query(({ input }) => getResolvedWorktreeStatus(input.id, input.path)),

  validateCustomWorktreePath: publicProcedure
    .input(z.object({ path: z.string().min(1) }))
    .query(({ input }) => validateCustomWorktreePath(input.path)),

  selectWorktree: publicProcedure
    .input(z.object({ id: z.string(), path: z.string().min(1) }))
    .mutation(({ input }) =>
      persistChatCheckout({
        chatId: input.id,
        requestedPath: input.path,
        repairMatchingChats: false,
      }),
    ),

  repairUnavailableCheckout: publicProcedure
    .input(z.object({ id: z.string(), unavailablePath: z.string().optional() }))
    .mutation(async ({ input }) => {
      const options = listWorktreeOptions(input.id)
      for (const option of options) {
        if (option.path === input.unavailablePath) continue
        if (option.kind === "detached") continue
        const status = await getResolvedWorktreeStatus(input.id, option.path)
        if (status.status !== "ok") continue
        return persistChatCheckout({
          chatId: input.id,
          requestedPath: option.path,
          repairMatchingChats: true,
          matchingPath: input.unavailablePath,
        })
      }

      return persistChatCheckout({
        chatId: input.id,
        requestedPath: await ensureDetachedChatCheckout(input.id),
        repairMatchingChats: false,
      })
    }),

  reconnectReplacedCheckout: publicProcedure
    .input(z.object({ id: z.string(), path: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const chat = db.select().from(chats).where(eq(chats.id, input.id)).get()
      if (!chat) throw new Error("Chat not found")
      const currentPath = chat.worktreePath ?? resolveDefaultWorktree(chat)
      if (currentPath !== input.path) {
        throw new Error("The Chat checkout changed before reconnect. Review it again.")
      }
      const status = await getResolvedWorktreeStatus(input.id, input.path)
      if (status.status !== "replaced") {
        throw new Error("This checkout is no longer in the replaced-folder state.")
      }
      const registration = rebindRegisteredFilesystemRoot(input.path)
      return {
        status: "reconnected" as const,
        path: registration.canonicalPath,
        branch: status.branch,
      }
    }),

  chooseReplacementCheckout: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()
      if (!window) throw new Error("No window available for checkout selection")
      const selection = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: "Choose the Git repository folder itself, not its parent folder",
        buttonLabel: "Use this repository",
      })
      if (selection.canceled || selection.filePaths.length === 0) {
        return { status: "cancelled" } as const
      }

      return persistChatCheckout({
        chatId: input.id,
        requestedPath: selection.filePaths[0]!,
        repairMatchingChats: true,
      })
    }),

  chooseCheckout: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()
      if (!window) throw new Error("No window available for checkout selection")
      const selection = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: "Choose an existing Git checkout",
        buttonLabel: "Use this checkout",
      })
      if (selection.canceled || selection.filePaths.length === 0) {
        return { status: "cancelled" } as const
      }

      return persistChatCheckout({
        chatId: input.id,
        requestedPath: selection.filePaths[0]!,
        repairMatchingChats: false,
      })
    }),

  chooseWorktreeParentDirectory: publicProcedure.mutation(async ({ ctx }) => {
    const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()
    if (!window) throw new Error("No window available for folder selection")
    const selection = await dialog.showOpenDialog(window, {
      properties: ["openDirectory", "createDirectory"],
      title: "Choose where to create the worktree",
      buttonLabel: "Use this location",
    })
    return selection.canceled ? null : (selection.filePaths[0] ?? null)
  }),

  createWorktreeForExistingChat: publicProcedure
    .input(
      z.object({
        id: z.string(),
        baseBranch: z.string().optional(),
        branchType: z.enum(["local", "remote"]).optional(),
        name: z.string().trim().min(1).max(100).optional(),
        parentDirectory: z.string().trim().min(1).max(4_096).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDatabase()
      const requestingWindowId = ctx.getWindow?.()?.id ?? null
      const chat = db.select().from(chats).where(eq(chats.id, input.id)).get()
      if (!chat) throw new Error("Chat not found")
      if (chat.scope === "global") throw new Error("Global chats do not have project worktrees")

      const task = chat.taskId
        ? db.select().from(tasks).where(eq(tasks.id, chat.taskId)).get()
        : null
      const projectId = chat.projectId ?? task?.projectId
      const project = projectId
        ? db.select().from(projects).where(eq(projects.id, projectId)).get()
        : null
      if (!project) throw new Error("Project not found")

      const result = await createWorktreeForChat(
        project.path,
        sanitizeProjectName(project.name),
        chat.id,
        input.baseBranch,
        input.branchType,
        {
          worktreeName: input.name,
          parentDirectory: input.parentDirectory,
          onSetupComplete: (setupResult: WorktreeSetupResult) => {
            if (setupResult.success) return
            const message =
              setupResult.errors[0] || "Worktree setup failed. Check your setup commands."
            sendWorktreeSetupFailure(requestingWindowId, {
              kind: "setup-failed",
              message,
              projectId: project.id,
            })
          },
        },
      )

      if (!result.success || !result.worktreePath) {
        throw new Error(result.error || "Worktree creation failed")
      }

      const updatedChat = db
        .update(chats)
        .set({
          worktreePath: result.worktreePath,
          branch: result.branch,
          baseBranch: result.baseBranch,
          updatedAt: new Date(),
        })
        .where(eq(chats.id, chat.id))
        .returning()
        .get()

      return updatedChat
    }),

  /**
   * Create a new chat with optional git worktree
   */
  create: publicProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        taskId: z.string().optional(),
        scope: z.enum(["global", "project", "task"]).default("project"),
        harness: z.string().optional(),
        name: z.string().optional(),
        model: z.string().optional(),
        runtimePreference: agentRuntimePreferenceSchema.optional(),
        permissionMode: newChatPermissionModeSchema.optional(),
        initialMessage: z.string().optional(),
        initialMessageParts: z
          .array(
            z.union([
              z.object({ type: z.literal("text"), text: z.string() }),
              z.object({
                type: z.literal("data-image"),
                data: z.object({
                  url: z.string(),
                  mediaType: z.string().optional(),
                  filename: z.string().optional(),
                  base64Data: z.string().optional(),
                }),
              }),
              // Hidden file content - sent to agent but not displayed in UI
              z.object({
                type: z.literal("file-content"),
                filePath: z.string(),
                content: z.string(),
              }),
            ]),
          )
          .optional(),
        baseBranch: z.string().optional(), // Branch to base the worktree off
        branchType: z.enum(["local", "remote"]).optional(), // Whether baseBranch is local or remote
        useWorktree: z.boolean().default(true), // If false, work directly in project dir
        mode: z.enum(CHAT_MODES).default("write"),
        agentProfile: agentProfileVersionRefSchema.optional(),
        confirmedAgentProfileDigest: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      console.log("[chats.create] called with:", input)
      const db = getDatabase()
      const requestingWindowId = ctx.getWindow?.()?.id ?? null

      let project = input.projectId
        ? db.select().from(projects).where(eq(projects.id, input.projectId)).get()
        : null
      const task = input.taskId
        ? db.select().from(tasks).where(eq(tasks.id, input.taskId)).get()
        : null

      if (input.scope === "global" && (input.projectId || input.taskId)) {
        throw new Error("Global chats cannot have projectId or taskId")
      }
      if (input.scope === "project" && (!input.projectId || input.taskId)) {
        throw new Error("Project chats require projectId and cannot have taskId")
      }
      if (input.scope === "task") {
        if (!task) throw new Error("Task not found")
        if (input.projectId && input.projectId !== task.projectId) {
          throw new Error("Task does not belong to project")
        }
        project = db.select().from(projects).where(eq(projects.id, task.projectId)).get()
      }

      console.log("[chats.create] found project:", project)
      if (input.scope !== "global" && !project) throw new Error("Project not found")
      const permissionPreferences = getPermissionPreferences()
      const inheritedMode =
        task?.defaultPermissionMode ??
        project?.defaultPermissionMode ??
        permissionPreferences.globalDefault
      const inheritedCustomPermissions =
        task?.defaultCustomPermissions ??
        project?.defaultCustomPermissions ??
        (permissionPreferences.globalCustomPermissions
          ? JSON.stringify(permissionPreferences.globalCustomPermissions)
          : null)
      let confirmedProfileDigest: string | null = null
      let confirmedProfileWorktreeStrategy:
        "inherit" | "task-primary" | "existing" | "attached-branch" | "none" | null = null
      if (input.agentProfile || input.confirmedAgentProfileDigest) {
        if (!input.agentProfile || !input.confirmedAgentProfileDigest) {
          throw new Error(
            "Agent Profile selection requires both an exact version and confirmed preview digest.",
          )
        }
        const preview = new AgentProfileChatBindingService(db).previewForNewChat({
          scope: input.scope,
          projectId: project?.id,
          taskId: task?.id,
          permissionMode: input.permissionMode ?? inheritedMode,
          runtimePreference: input.runtimePreference ?? "auto",
          profile: input.agentProfile,
        })
        const blocker = preview.conflicts.find((conflict) =>
          (AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES as readonly string[]).includes(
            conflict.code,
          ),
        )
        if (blocker) throw new Error(`${blocker.message} ${blocker.repair}`)
        if (preview.unresolvedRequirements.length) {
          throw new Error("The selected Agent Profile has unresolved requirements.")
        }
        if (preview.digest !== input.confirmedAgentProfileDigest) {
          throw new Error(
            "Agent Profile preview changed before Chat creation. Review and confirm it again.",
          )
        }
        confirmedProfileDigest = preview.digest
        confirmedProfileWorktreeStrategy = preview.capability.worktreeStrategy
        if (confirmedProfileWorktreeStrategy === "task-primary" && !task) {
          throw new Error(
            "The selected Agent Profile requires a task-primary worktree. Create this Chat from a task.",
          )
        }
      }

      // Create chat (fast path)
      const chat = db
        .insert(chats)
        .values({
          name: input.name,
          projectId: project?.id ?? null,
          taskId: task?.id ?? null,
          scope: input.scope,
          permissionMode: input.permissionMode ?? inheritedMode,
          customPermissions:
            input.permissionMode === undefined && inheritedMode === "custom"
              ? inheritedCustomPermissions
              : null,
          mcpExposureEnabled: true,
          harness: input.harness,
          model: input.model,
          runtimePreference: input.runtimePreference,
        })
        .returning()
        .get()
      console.log("[chats.create] created chat:", chat)

      // Create initial sub-chat with user message (AI SDK format)
      // If initialMessageParts is provided, use it; otherwise fallback to text-only message
      let initialMessages = "[]"
      const initialMetadata =
        input.model || input.harness
          ? {
              ...(input.model ? { model: input.model } : {}),
              ...(input.harness ? { harness: input.harness } : {}),
            }
          : undefined

      if (input.initialMessageParts && input.initialMessageParts.length > 0) {
        initialMessages = JSON.stringify([
          {
            id: `msg-${Date.now()}`,
            role: "user",
            parts: input.initialMessageParts,
            ...(initialMetadata ? { metadata: initialMetadata } : {}),
          },
        ])
      } else if (input.initialMessage) {
        initialMessages = JSON.stringify([
          {
            id: `msg-${Date.now()}`,
            role: "user",
            parts: [{ type: "text", text: input.initialMessage }],
            ...(initialMetadata ? { metadata: initialMetadata } : {}),
          },
        ])
      }

      const subChat = db
        .insert(subChats)
        .values({
          chatId: chat.id,
          harness: input.harness,
          model: input.model,
          mode: input.mode,
          messages: initialMessages,
        })
        .returning()
        .get()
      console.log("[chats.create] created subChat:", subChat)
      if (input.agentProfile) {
        try {
          const bound = new AgentProfileChatBindingService(db).bind({
            chatId: chat.id,
            profile: input.agentProfile,
            expectedDigest: confirmedProfileDigest ?? undefined,
          })
          if (bound.digest !== confirmedProfileDigest) {
            throw new Error("Agent Profile binding digest no longer matches the confirmed preview.")
          }
        } catch (error) {
          db.delete(chats).where(eq(chats.id, chat.id)).run()
          throw new Error(
            `Agent Profile changed while creating the Chat. No Chat was retained; review it again. ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }

      // Worktree creation result (will be set if useWorktree is true)
      let worktreeResult: {
        worktreePath?: string
        branch?: string
        baseBranch?: string
      } = {}

      const worktreeStrategy = confirmedProfileWorktreeStrategy ?? "inherit"
      const useTaskPrimary =
        worktreeStrategy === "task-primary" ||
        (worktreeStrategy === "inherit" &&
          input.scope === "task" &&
          Boolean(input.useWorktree || task?.primaryWorktreePath))
      const useManagedWorktree =
        worktreeStrategy === "attached-branch" ||
        (worktreeStrategy === "inherit" && input.useWorktree)

      // Apply the exact profile worktree strategy before the Chat can launch.
      if (input.scope === "global") {
        console.log("[chats.create] global scope - no worktree")
      } else if (useTaskPrimary && task) {
        const taskWithWorktree = task.primaryWorktreePath
          ? task
          : await ensureTaskPrimaryWorktree(task.id)
        console.log("[chats.create] task scope - using task primary worktree")
        db.update(chats)
          .set({
            worktreePath: taskWithWorktree.primaryWorktreePath,
            branch: taskWithWorktree.primaryBranch,
          })
          .where(eq(chats.id, chat.id))
          .run()
        worktreeResult = {
          worktreePath: taskWithWorktree.primaryWorktreePath ?? undefined,
          branch: taskWithWorktree.primaryBranch ?? undefined,
        }
      } else if (useManagedWorktree && project) {
        console.log(
          "[chats.create] creating worktree with baseBranch:",
          input.baseBranch,
          "type:",
          input.branchType,
        )
        const result = await createWorktreeForChat(
          project.path,
          sanitizeProjectName(project.name),
          chat.id,
          input.baseBranch,
          input.branchType,
          {
            onSetupComplete: (setupResult: WorktreeSetupResult) => {
              if (setupResult.success) return
              const message =
                setupResult.errors[0] || "Worktree setup failed. Check your setup commands."
              sendWorktreeSetupFailure(requestingWindowId, {
                kind: "setup-failed",
                message,
                projectId: project.id,
              })
            },
          },
        )
        console.log("[chats.create] worktree result:", result)

        if (result.success && result.worktreePath) {
          db.update(chats)
            .set({
              worktreePath: result.worktreePath,
              branch: result.branch,
              baseBranch: result.baseBranch,
            })
            .where(eq(chats.id, chat.id))
            .run()
          worktreeResult = {
            worktreePath: result.worktreePath,
            branch: result.branch,
            baseBranch: result.baseBranch,
          }
        } else {
          console.warn(`[Worktree] Failed: ${result.error}`)
          sendWorktreeSetupFailure(requestingWindowId, {
            kind: "create-failed",
            message: result.error || "Worktree creation failed.",
            projectId: project.id,
          })
          // Fallback to project path
          db.update(chats).set({ worktreePath: project.path }).where(eq(chats.id, chat.id)).run()
          worktreeResult = { worktreePath: project.path }
        }
      } else if (project && worktreeStrategy !== "none") {
        // Local mode: use project path directly, no branch info
        console.log("[chats.create] local mode - using project path directly")
        db.update(chats).set({ worktreePath: project.path }).where(eq(chats.id, chat.id)).run()
        worktreeResult = { worktreePath: project.path }
      }

      const response = {
        ...chat,
        worktreePath: worktreeResult.worktreePath || project?.path || null,
        branch: worktreeResult.branch,
        baseBranch: worktreeResult.baseBranch,
        subChats: [subChat],
      }

      // Track workspace created
      trackWorkspaceCreated({
        id: chat.id,
        projectId: project?.id ?? null,
        useWorktree: input.useWorktree,
      })

      console.log("[chats.create] returning:", response)
      return response
    }),

  /**
   * Rename a chat
   */
  rename: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db.transaction((tx) => {
        const updatedChat = tx
          .update(chats)
          .set({ name: input.name, updatedAt: new Date() })
          .where(eq(chats.id, input.id))
          .returning()
          .get()
        const canonicalSubChat = tx
          .select({ id: subChats.id })
          .from(subChats)
          .where(eq(subChats.chatId, input.id))
          .orderBy(subChats.createdAt)
          .get()
        if (canonicalSubChat) {
          tx.update(subChats)
            .set({ name: input.name, updatedAt: new Date() })
            .where(eq(subChats.id, canonicalSubChat.id))
            .run()
        }
        return updatedChat
      })
    }),

  pin: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    return db
      .update(chats)
      .set({ pinnedAt: new Date(), updatedAt: new Date() })
      .where(eq(chats.id, input.id))
      .returning()
      .get()
  }),

  unpin: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    return db
      .update(chats)
      .set({ pinnedAt: null, updatedAt: new Date() })
      .where(eq(chats.id, input.id))
      .returning()
      .get()
  }),

  move: publicProcedure
    .input(
      z.object({
        id: z.string(),
        scope: z.enum(["global", "project", "task"]),
        projectId: z.string().optional(),
        taskId: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      const chat = db.select().from(chats).where(eq(chats.id, input.id)).get()
      if (!chat) throw new Error("Chat not found")
      const sourceDefaultWorktreePath = resolveDefaultWorktree(chat)
      const keepExplicitCustomWorktree = Boolean(
        chat.worktreePath &&
        chat.worktreePath !== sourceDefaultWorktreePath &&
        !isManagedFlapstackWorktreePath(chat.worktreePath),
      )

      if (input.scope === "global") {
        return db
          .update(chats)
          .set({
            scope: "global",
            projectId: null,
            taskId: null,
            // A global chat must not keep a project-owned default checkout.
            // Preserve only an explicit custom worktree so history and user
            // intent survive detaching from a project or task.
            worktreePath: keepExplicitCustomWorktree ? chat.worktreePath : null,
            branch: keepExplicitCustomWorktree ? chat.branch : null,
            baseBranch: keepExplicitCustomWorktree ? chat.baseBranch : null,
            updatedAt: new Date(),
          })
          .where(eq(chats.id, input.id))
          .returning()
          .get()
      }

      if (input.scope === "project") {
        if (!input.projectId) throw new Error("Project move requires projectId")
        const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get()
        if (!project) throw new Error("Project not found")

        return db
          .update(chats)
          .set({
            scope: "project",
            projectId: project.id,
            taskId: null,
            worktreePath: keepExplicitCustomWorktree ? chat.worktreePath : project.path,
            branch: keepExplicitCustomWorktree ? chat.branch : null,
            baseBranch: keepExplicitCustomWorktree ? chat.baseBranch : null,
            updatedAt: new Date(),
          })
          .where(eq(chats.id, input.id))
          .returning()
          .get()
      }

      if (!input.taskId) throw new Error("Task move requires taskId")
      const task = db.select().from(tasks).where(eq(tasks.id, input.taskId)).get()
      if (!task) throw new Error("Task not found")
      const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get()
      if (!project) throw new Error("Project not found")

      return db
        .update(chats)
        .set({
          scope: "task",
          projectId: project.id,
          taskId: task.id,
          worktreePath: keepExplicitCustomWorktree
            ? chat.worktreePath
            : (task.primaryWorktreePath ?? project.path),
          branch: keepExplicitCustomWorktree ? chat.branch : task.primaryBranch,
          baseBranch: keepExplicitCustomWorktree ? chat.baseBranch : null,
          updatedAt: new Date(),
        })
        .where(eq(chats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Archive a chat (also kills any terminal processes in the workspace).
   * Worktrees are kept until archived chats are explicitly deleted.
   */
  archive: publicProcedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // Get chat to check for worktree (before archiving)
      const chat = db.select().from(chats).where(eq(chats.id, input.id)).get()

      // Archive immediately (optimistic)
      const result = db
        .update(chats)
        .set({ archivedAt: new Date() })
        .where(eq(chats.id, input.id))
        .returning()
        .get()

      // Track workspace archived
      trackWorkspaceArchived(input.id)

      // Kill terminal processes only for worktree-mode workspaces.
      // Local-mode terminals are shared across workspaces on the same project path,
      // so they should not be killed when a single workspace is archived.
      const isLocalMode = !chat?.branch
      if (!isLocalMode) {
        terminalManager
          .killByWorkspaceId(input.id)
          .then((killResult) => {
            if (killResult.killed > 0) {
              console.log(
                `[chats.archive] Killed ${killResult.killed} terminal session(s) for workspace ${input.id}`,
              )
            }
          })
          .catch((error) => {
            console.error(`[chats.archive] Error killing processes:`, error)
          })
      }

      // Invalidate git cache for this worktree
      if (chat?.worktreePath) {
        gitCache.invalidateStatus(chat.worktreePath)
        gitCache.invalidateParsedDiff(chat.worktreePath)
      }

      return result
    }),

  /**
   * Restore an archived chat
   */
  restore: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    return db
      .update(chats)
      .set({ archivedAt: null })
      .where(eq(chats.id, input.id))
      .returning()
      .get()
  }),

  /**
   * Archive multiple chats at once (also kills terminal processes in each workspace)
   */
  archiveBatch: publicProcedure
    .input(z.object({ chatIds: z.array(z.string()) }))
    .mutation(({ input }) => {
      const db = getDatabase()
      if (input.chatIds.length === 0) return []

      // Identify worktree-mode workspaces before archiving (for terminal cleanup)
      const worktreeChats = db
        .select({ id: chats.id, branch: chats.branch })
        .from(chats)
        .where(inArray(chats.id, input.chatIds))
        .all()
        .filter((c) => c.branch != null)

      // Archive immediately (optimistic)
      const result = db
        .update(chats)
        .set({ archivedAt: new Date() })
        .where(inArray(chats.id, input.chatIds))
        .returning()
        .all()

      // Kill terminal processes only for worktree-mode workspaces.
      // Local-mode terminals are shared and should not be killed.

      if (worktreeChats.length > 0) {
        Promise.all(worktreeChats.map((c) => terminalManager.killByWorkspaceId(c.id)))
          .then((killResults) => {
            const totalKilled = killResults.reduce((sum, r) => sum + r.killed, 0)
            if (totalKilled > 0) {
              console.log(
                `[chats.archiveBatch] Killed ${totalKilled} terminal session(s) for ${worktreeChats.length} worktree workspace(s)`,
              )
            }
          })
          .catch((error) => {
            console.error(`[chats.archiveBatch] Error killing processes:`, error)
          })
      }

      return result
    }),

  /**
   * Delete a chat permanently (with worktree cleanup)
   */
  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const db = getDatabase()

    // Get chat before deletion
    const chat = db.select().from(chats).where(eq(chats.id, input.id)).get()

    // Cleanup worktree if it was created (has branch = was a real worktree, not just project path)
    if (chat?.worktreePath && chat?.branch) {
      const project = chat.projectId
        ? db.select().from(projects).where(eq(projects.id, chat.projectId)).get()
        : null
      if (project) {
        const result = await removeWorktree(project.path, chat.worktreePath)
        if (!result.success) {
          console.warn(`[Worktree] Cleanup failed: ${result.error}`)
        }
      }
    }

    // Kill terminal processes for worktree-mode workspaces.
    // Local-mode terminals are shared and should not be killed on delete.
    if (chat?.branch) {
      terminalManager.killByWorkspaceId(input.id).catch((error) => {
        console.error(`[chats.delete] Error killing processes:`, error)
      })
    }

    // Track workspace deleted
    trackWorkspaceDeleted(input.id)

    // Invalidate git cache for this worktree
    if (chat?.worktreePath) {
      gitCache.invalidateStatus(chat.worktreePath)
      gitCache.invalidateParsedDiff(chat.worktreePath)
    }

    await deleteVoiceHistoryForChat(input.id)
    return db.delete(chats).where(eq(chats.id, input.id)).returning().get()
  }),

  /**
   * Delete selected archived chats permanently (with worktree cleanup).
   * Omitting ids preserves the legacy "delete all archived chats" behavior.
   * Active chats are never touched.
   */
  deleteArchived: publicProcedure
    .input(z.object({ ids: z.array(z.string().trim().min(1).max(200)).max(1_000) }).optional())
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const requestedIds = input?.ids ? [...new Set(input.ids)] : null
      if (requestedIds?.length === 0) return { deletedCount: 0 }

      const archivedCondition = requestedIds
        ? and(isNotNull(chats.archivedAt), inArray(chats.id, requestedIds))
        : isNotNull(chats.archivedAt)
      const archivedChats = db.select().from(chats).where(archivedCondition).all()

      for (const chat of archivedChats) {
        if (chat.worktreePath && chat.branch) {
          const project = chat.projectId
            ? db.select().from(projects).where(eq(projects.id, chat.projectId)).get()
            : null
          if (project) {
            const result = await removeWorktree(project.path, chat.worktreePath)
            if (!result.success) {
              console.warn(`[Worktree] Cleanup failed: ${result.error}`)
            }
          }
        }

        if (chat.branch) {
          terminalManager.killByWorkspaceId(chat.id).catch((error) => {
            console.error(`[chats.deleteArchived] Error killing processes:`, error)
          })
        }

        trackWorkspaceDeleted(chat.id)
        await deleteVoiceHistoryForChat(chat.id)

        if (chat.worktreePath) {
          gitCache.invalidateStatus(chat.worktreePath)
          gitCache.invalidateParsedDiff(chat.worktreePath)
        }
      }

      if (archivedChats.length > 0) {
        db.delete(chats)
          .where(
            inArray(
              chats.id,
              archivedChats.map((chat) => chat.id),
            ),
          )
          .run()
      }

      return { deletedCount: archivedChats.length }
    }),

  // ============ Sub-chat procedures ============

  setRuntimePreference: publicProcedure
    .input(
      z.object({
        chatId: z.string().trim().min(1).max(200),
        preference: agentRuntimePreferenceSchema,
      }),
    )
    .mutation(async ({ input }) =>
      (await probedRuntimePreferenceLifecycle(input)).setEmptyChatPreference(input),
    ),

  previewRuntimeContinuation: publicProcedure
    .input(
      z.object({
        sourceChatId: z.string().trim().min(1).max(200),
        targetHarness: z
          .enum(["claude-code", "codex", "cursor-agent", "openrouter", "nanogpt", "local"])
          .optional(),
        targetModel: z.string().trim().min(1).max(240).optional(),
        preference: agentRuntimePreferenceSchema,
        requestId: z.string().trim().min(8).max(200),
        name: z.string().trim().min(1).max(200).optional(),
        selectedMessageIds: z.array(z.string().trim().min(1).max(512)).max(1_000).optional(),
        selectedFileRefs: z.array(z.string().trim().min(1).max(512)).max(1_000).optional(),
        selectedArtifactRefs: z.array(z.string().trim().min(1).max(512)).max(1_000).optional(),
      }),
    )
    .query(async ({ input }) => {
      const { lifecycle } = await probedRuntimeLifecycle(input)
      return lifecycle.previewContinuation(input)
    }),

  continueWithRuntime: publicProcedure
    .input(
      z.object({
        sourceChatId: z.string().trim().min(1).max(200),
        targetHarness: z
          .enum(["claude-code", "codex", "cursor-agent", "openrouter", "nanogpt", "local"])
          .optional(),
        targetModel: z.string().trim().min(1).max(240).optional(),
        preference: agentRuntimePreferenceSchema,
        requestId: z.string().trim().min(8).max(200),
        name: z.string().trim().min(1).max(200).optional(),
        selectedMessageIds: z.array(z.string().trim().min(1).max(512)).max(1_000).optional(),
        selectedFileRefs: z.array(z.string().trim().min(1).max(512)).max(1_000).optional(),
        selectedArtifactRefs: z.array(z.string().trim().min(1).max(512)).max(1_000).optional(),
        confirmedPreviewDigest: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { lifecycle } = await probedRuntimeLifecycle(input)
      return lifecycle.continueWithRuntime(input)
    }),

  previewRuntimeDelegation: publicProcedure
    .input(runtimeDelegationInputSchema.omit({ confirmedPreviewDigest: true }))
    .query(async ({ input }) => {
      const { probe } = await probedRuntimeLifecycle(input)
      return runtimeDelegationService().preview(input, probe)
    }),

  delegateToRuntime: publicProcedure
    .input(runtimeDelegationInputSchema)
    .mutation(async ({ input }) => {
      const { probe } = await probedRuntimeLifecycle(input)
      return runtimeDelegationService().delegate(input, probe)
    }),

  reconcileRuntimeDelegation: publicProcedure
    .input(z.object({ attemptId: z.string().trim().min(1).max(512) }))
    .query(({ input }) => runtimeDelegationService().reconcile(input.attemptId)),

  cancelRuntimeDelegation: publicProcedure
    .input(
      z.object({
        attemptId: z.string().trim().min(1).max(512),
        reason: z.string().trim().min(1).max(2_000),
      }),
    )
    .mutation(({ input }) => runtimeDelegationService().cancel(input.attemptId, input.reason)),

  undoRuntimeContinuation: publicProcedure
    .input(
      z.object({
        sourceChatId: z.string().trim().min(1).max(200),
        targetChatId: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(({ input }) =>
      createRuntimeChatLifecycleService(getDatabase()).undoContinuation(input),
    ),

  /**
   * Get a single sub-chat
   */
  getSubChat: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const db = getDatabase()
    const subChat = db.select().from(subChats).where(eq(subChats.id, input.id)).get()

    if (!subChat) return null

    const chat = db.select().from(chats).where(eq(chats.id, subChat.chatId)).get()

    const project = chat?.projectId
      ? db.select().from(projects).where(eq(projects.id, chat.projectId)).get()
      : null

    return { ...subChat, chat: chat ? { ...chat, project } : null }
  }),

  /**
   * Create a new sub-chat
   */
  createSubChat: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        name: z.string().optional(),
        mode: z.enum(CHAT_MODES).default("write"),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      const existingConversation = db
        .select({ id: subChats.id })
        .from(subChats)
        .where(eq(subChats.chatId, input.chatId))
        .get()
      if (existingConversation) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Each sidebar chat supports exactly one conversation",
        })
      }
      return db
        .insert(subChats)
        .values({
          chatId: input.chatId,
          name: input.name,
          mode: input.mode,
          messages: "[]",
        })
        .returning()
        .get()
    }),

  /**
   * Fork a conversation from a specific message into a new sidebar chat.
   * The internal sub-chat row remains a one-to-one compatibility detail.
   */
  forkSubChat: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        messageId: z.string(),
        messageIndex: z.number().int().nonnegative().optional(),
        name: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // 1. Get the source sub-chat
      const sourceSubChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
      if (!sourceSubChat) throw new Error("Source sub-chat not found")
      const sourceChat = db.select().from(chats).where(eq(chats.id, sourceSubChat.chatId)).get()
      if (!sourceChat) throw new Error("Source chat not found")

      // 2. Parse messages and find the cutoff point
      const allMessages = JSON.parse(sourceSubChat.messages || "[]")
      let cutoffIndex = allMessages.findIndex((m: any) => m.id === input.messageId)
      // Fallback: AI SDK generates its own message IDs on the client which differ
      // from the server-generated UUIDs stored in the DB. Use the message index
      // (passed from the client) as a fallback when the ID doesn't match.
      if (
        cutoffIndex === -1 &&
        input.messageIndex !== undefined &&
        input.messageIndex < allMessages.length
      ) {
        cutoffIndex = input.messageIndex
      }
      if (cutoffIndex === -1) throw new Error("Message not found")

      // 3. Slice messages up to and including the target
      const messagesToFork = allMessages.slice(0, cutoffIndex + 1)

      // 4. Find sdkMessageUuid of last assistant message (for resumeSessionAt)
      const lastAssistant = [...messagesToFork].reverse().find((m: any) => m.role === "assistant")
      const forkAtSdkUuid = lastAssistant?.metadata?.sdkMessageUuid || null

      // 5. Generate new IDs for all messages + set shouldForkResume on last assistant
      const forkedMessages = messagesToFork.map((msg: any, i: number) => ({
        ...msg,
        id: `fork-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        metadata: {
          ...msg.metadata,
          shouldResume: undefined,
          ...(msg === lastAssistant &&
            forkAtSdkUuid && {
              shouldForkResume: true,
            }),
        },
      }))

      // 6. Generate a Codex-style sibling name: Title (2), Title (3), ...
      let forkName = input.name
      if (!forkName) {
        const scopeConditions = [eq(chats.scope, sourceChat.scope)]
        scopeConditions.push(
          sourceChat.projectId
            ? eq(chats.projectId, sourceChat.projectId)
            : isNull(chats.projectId),
        )
        scopeConditions.push(
          sourceChat.taskId ? eq(chats.taskId, sourceChat.taskId) : isNull(chats.taskId),
        )
        const siblings = db
          .select({ name: chats.name })
          .from(chats)
          .where(and(...scopeConditions))
          .all()
        forkName = getNextChatForkName(
          sourceChat.name,
          siblings.map(({ name }) => name),
        )
      }

      // 7. Create a new sidebar chat with one internal conversation row.
      const { newChat, newSubChat } = db.transaction((tx) => {
        const newChat = tx
          .insert(chats)
          .values({
            name: forkName,
            projectId: sourceChat.projectId,
            taskId: sourceChat.taskId,
            scope: sourceChat.scope,
            permissionMode: sourceChat.permissionMode,
            customPermissions: sourceChat.customPermissions,
            mcpExposureEnabled: sourceChat.mcpExposureEnabled,
            harness: sourceChat.harness,
            model: sourceChat.model,
            worktreePath: sourceChat.worktreePath,
            branch: sourceChat.branch,
            baseBranch: sourceChat.baseBranch,
          })
          .returning()
          .get()
        const newSubChat = tx
          .insert(subChats)
          .values({
            chatId: newChat.id,
            name: forkName,
            mode: sourceSubChat.mode,
            harness: sourceSubChat.harness,
            model: sourceSubChat.model,
            permissionMode: sourceSubChat.permissionMode,
            worktreePath: sourceSubChat.worktreePath,
            messages: JSON.stringify(forkedMessages),
            sessionId: sourceSubChat.sessionId,
          })
          .returning()
          .get()
        return { newChat, newSubChat }
      })

      // 8. Copy .jsonl session files to the new isolated config dir
      if (sourceSubChat.sessionId) {
        try {
          const { app } = await import("electron")
          const userDataPath = app.getPath("userData")
          const sourceDir = path.join(userDataPath, "claude-sessions", input.subChatId, "projects")
          const targetDir = path.join(userDataPath, "claude-sessions", newSubChat.id, "projects")

          const sourceDirExists = await fs
            .stat(sourceDir)
            .then(() => true)
            .catch(() => false)

          if (sourceDirExists) {
            await fs.cp(sourceDir, targetDir, { recursive: true })
          }
        } catch (err) {
          console.warn("[forkSubChat] Failed to copy session files:", err)
          // Clear shouldForkResume since there's no .jsonl to fork from
          for (const m of forkedMessages) {
            if (m.metadata?.shouldForkResume) {
              delete m.metadata.shouldForkResume
            }
          }
          db.update(subChats)
            .set({ messages: JSON.stringify(forkedMessages) })
            .where(eq(subChats.id, newSubChat.id))
            .run()
        }
      }

      console.log("[forkSubChat] Created", {
        id: newSubChat.id,
        name: forkName,
        messages: forkedMessages.length,
      })

      return {
        chat: newChat,
        subChat: newSubChat,
        messageCount: forkedMessages.length,
        forkAtSdkUuid,
      }
    }),

  /**
   * Update sub-chat messages
   */
  updateSubChatMessages: publicProcedure
    .input(z.object({ id: z.string(), messages: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(subChats)
        .set({ messages: input.messages, updatedAt: new Date() })
        .where(eq(subChats.id, input.id))
        .returning()
        .get()
    }),

  mergeRuntimeSubChatMessages: publicProcedure
    .input(z.object({ id: z.string(), messages: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db.transaction((tx) => {
        const current = tx.select().from(subChats).where(eq(subChats.id, input.id)).get()
        if (!current) throw new Error("Sub-chat not found")
        const messages = mergeRuntimeMessages(current.messages, input.messages)
        return tx
          .update(subChats)
          .set({ messages, updatedAt: new Date() })
          .where(eq(subChats.id, input.id))
          .returning()
          .get()
      })
    }),

  /**
   * Remove the latest completed user turn so the caller can resend an edited
   * prompt. Restore its exact pre-run filesystem snapshot when one is available;
   * older runs without checkpoints fall back to a conversation-only rewind.
   */
  editLatestUserMessage: publicProcedure
    .input(z.object({ subChatId: z.string(), userMessageId: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const subChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
      if (!subChat) throw new TRPCError({ code: "NOT_FOUND", message: "Chat not found" })

      const activeRun = db
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.subChatId, input.subChatId),
            inArray(agentRuns.status, ["pending", "running"]),
          ),
        )
        .get()
      if (activeRun) {
        throw new TRPCError({ code: "CONFLICT", message: "Stop the current response first" })
      }

      const messages = JSON.parse(subChat.messages || "[]") as any[]
      const userIndex = messages.findIndex(
        (message) => message.id === input.userMessageId && message.role === "user",
      )
      let latestUserIndex = -1
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === "user") {
          latestUserIndex = index
          break
        }
      }
      if (userIndex === -1 || userIndex !== latestUserIndex) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Only the latest sent message can be edited",
        })
      }

      const run = db
        .select({ beforeCheckpointId: agentRuns.beforeCheckpointId })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.subChatId, input.subChatId),
            eq(agentRuns.promptMessageId, input.userMessageId),
          ),
        )
        .orderBy(desc(agentRuns.startedAt))
        .get()

      if (run?.beforeCheckpointId) {
        await restoreCheckpoint(run.beforeCheckpointId)
      }

      let truncatedMessages = messages.slice(0, userIndex).map((message) => {
        const { shouldResume, shouldForkResume, ...metadata } = message.metadata || {}
        return { ...message, metadata }
      })
      let previousAssistantIndex = -1
      for (let index = truncatedMessages.length - 1; index >= 0; index -= 1) {
        if (truncatedMessages[index]?.role === "assistant") {
          previousAssistantIndex = index
          break
        }
      }
      if (previousAssistantIndex >= 0) {
        const previousAssistant = truncatedMessages[previousAssistantIndex]
        truncatedMessages[previousAssistantIndex] = {
          ...previousAssistant,
          metadata: { ...previousAssistant.metadata, shouldResume: true },
        }
      }

      db.update(subChats)
        .set({
          messages: JSON.stringify(truncatedMessages),
          sessionId:
            previousAssistantIndex >= 0
              ? (truncatedMessages[previousAssistantIndex]?.metadata?.sessionId ?? null)
              : null,
          streamId: null,
          updatedAt: new Date(),
        })
        .where(eq(subChats.id, input.subChatId))
        .run()

      return { success: true as const, messages: truncatedMessages }
    }),

  /**
   * Rollback to a specific message by sdkMessageUuid
   * Handles both git state rollback and message truncation
   * Git rollback is done first - if it fails, the whole operation aborts
   */
  rollbackToMessage: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        sdkMessageUuid: z.string(),
      }),
    )
    .mutation(
      async ({
        input,
      }): Promise<{ success: false; error: string } | { success: true; messages: any[] }> => {
        const db = getDatabase()

        // 1. Get the sub-chat and its messages
        const subChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
        if (!subChat) {
          return { success: false, error: "Sub-chat not found" }
        }

        // 2. Parse messages and find the target message by sdkMessageUuid
        const messages = JSON.parse(subChat.messages || "[]")
        const targetIndex = messages.findIndex(
          (m: any) => m.metadata?.sdkMessageUuid === input.sdkMessageUuid,
        )

        if (targetIndex === -1) {
          return { success: false, error: "Message not found" }
        }

        // 3. Get the parent chat for worktreePath
        const chat = db.select().from(chats).where(eq(chats.id, subChat.chatId)).get()

        // 4. Rollback git state first - if this fails, abort the whole operation
        if (chat?.worktreePath) {
          const res = await applyRollbackStash(chat.worktreePath, input.sdkMessageUuid)
          if (!res.success) {
            return { success: false, error: `Git rollback failed: ${res.error}` }
          }
          // If checkpoint wasn't found, we still fail because we can't safely rollback
          // without reverting the git state to match the message history
          if (!res.checkpointFound) {
            return { success: false, error: "Checkpoint not found - cannot rollback git state" }
          }
        }

        // 5. Truncate messages to include up to and including the target message
        let truncatedMessages = messages.slice(0, targetIndex + 1)

        // 5.5. Clear any old shouldResume flags, then set on the target message
        truncatedMessages = truncatedMessages.map((m: any, i: number) => {
          const { shouldResume, ...restMeta } = m.metadata || {}
          return {
            ...m,
            metadata: {
              ...restMeta,
              ...(i === truncatedMessages.length - 1 && { shouldResume: true }),
            },
          }
        })

        // 6. Update the sub-chat with truncated messages
        db.update(subChats)
          .set({
            messages: JSON.stringify(truncatedMessages),
            updatedAt: new Date(),
          })
          .where(eq(subChats.id, input.subChatId))
          .returning()
          .get()

        return {
          success: true,
          messages: truncatedMessages,
        }
      },
    ),

  /**
   * Update sub-chat session ID (for Claude resume)
   */
  updateSubChatSession: publicProcedure
    .input(z.object({ id: z.string(), sessionId: z.string().nullable() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(subChats)
        .set({ sessionId: input.sessionId })
        .where(eq(subChats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Update sub-chat mode
   */
  updateSubChatMode: publicProcedure
    .input(z.object({ id: z.string(), mode: z.enum(CHAT_MODES) }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(subChats)
        .set({ mode: input.mode })
        .where(eq(subChats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Rename a sub-chat
   */
  renameSubChat: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db.transaction((tx) => {
        const updatedSubChat = tx
          .update(subChats)
          .set({ name: input.name, updatedAt: new Date() })
          .where(eq(subChats.id, input.id))
          .returning()
          .get()
        if (updatedSubChat) {
          tx.update(chats)
            .set({ name: input.name, updatedAt: new Date() })
            .where(eq(chats.id, updatedSubChat.chatId))
            .run()
        }
        return updatedSubChat
      })
    }),

  /**
   * Delete a sub-chat
   */
  deleteSubChat: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    return db.delete(subChats).where(eq(subChats.id, input.id)).returning().get()
  }),

  /**
   * Get git diff for a chat's worktree
   */
  getDiff: publicProcedure.input(z.object({ chatId: z.string() })).query(async ({ input }) => {
    const db = getDatabase()
    const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()

    if (!chat?.worktreePath) {
      return { diff: null, error: "No worktree path" }
    }

    const result = await getWorktreeDiff(chat.worktreePath, chat.baseBranch ?? undefined)

    if (!result.success) {
      return { diff: null, error: result.error }
    }

    return { diff: result.diff || "" }
  }),

  /**
   * Get parsed diff with prefetched file contents
   * This endpoint does all diff parsing on the server side to avoid blocking UI
   * Uses GitCache for instant responses when diff hasn't changed
   */
  getParsedDiff: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()

      if (!chat?.worktreePath) {
        return {
          files: [],
          totalAdditions: 0,
          totalDeletions: 0,
          fileContents: {},
          error: "No worktree path",
        }
      }

      // 1. Get raw diff (only uncommitted changes - don't show branch diff after commit)
      const result = await getWorktreeDiff(chat.worktreePath, chat.baseBranch ?? undefined, {
        onlyUncommitted: true,
      })

      if (!result.success) {
        return {
          files: [],
          totalAdditions: 0,
          totalDeletions: 0,
          fileContents: {},
          error: result.error,
        }
      }

      // 2. Check cache using diff hash
      const diffHash = computeContentHash(result.diff || "")
      type ParsedDiffResponse = {
        files: ReturnType<typeof splitUnifiedDiffByFile>
        totalAdditions: number
        totalDeletions: number
        fileContents: Record<string, string>
      }
      const cached = gitCache.getParsedDiff<ParsedDiffResponse>(chat.worktreePath, diffHash)
      if (cached) {
        return cached
      }

      // 3. Parse diff into files
      const files = splitUnifiedDiffByFile(result.diff || "")

      // 4. Calculate totals
      const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0)
      const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0)

      // 5. Prefetch file contents (first 20 files, non-deleted, non-binary)
      const MAX_PREFETCH = 20
      const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB

      const filesToFetch = files
        .filter((f) => !f.isBinary && !f.isDeletedFile)
        .slice(0, MAX_PREFETCH)
        .map((f) => ({
          key: f.key,
          filePath: f.newPath !== "/dev/null" ? f.newPath : f.oldPath,
        }))
        .filter((f) => f.filePath && f.filePath !== "/dev/null")

      const fileContents: Record<string, string> = {}

      // Read files in parallel
      await Promise.all(
        filesToFetch.map(async ({ key, filePath }) => {
          try {
            const fullPath = path.join(chat.worktreePath!, filePath)

            // Check file size first
            const stats = await fs.stat(fullPath)
            if (stats.size > MAX_FILE_SIZE) {
              return // Skip large files
            }

            const content = await fs.readFile(fullPath, "utf-8")

            // Quick binary check (NUL bytes in first 8KB)
            const checkLength = Math.min(content.length, 8192)
            for (let i = 0; i < checkLength; i++) {
              if (content.charCodeAt(i) === 0) {
                return // Skip binary files
              }
            }

            fileContents[key] = content
          } catch {
            // File might not exist or be unreadable - skip
          }
        }),
      )

      const response: ParsedDiffResponse = {
        files,
        totalAdditions,
        totalDeletions,
        fileContents,
      }

      // 6. Store in cache
      gitCache.setParsedDiff(chat.worktreePath, diffHash, response)
      return response
    }),

  /**
   * Generate a commit message using AI based on the diff
   * @param chatId - The chat ID to get worktree path from
   * @param filePaths - Optional list of file paths to generate message for (if not provided, uses all changed files)
   * @param ollamaModel - Optional Ollama model for offline generation
   */
  generateCommitMessage: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        filePaths: z.array(z.string()).optional(),
        ollamaModel: z.string().nullish(), // Optional model for offline mode
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()

      if (!chat?.worktreePath) {
        throw new Error("No worktree path")
      }

      // Get the diff to understand what changed
      const result = await getWorktreeDiff(chat.worktreePath, chat.baseBranch ?? undefined)

      if (!result.success || !result.diff) {
        throw new Error("Failed to get diff")
      }

      // Parse diff to get file list
      let files = splitUnifiedDiffByFile(result.diff)

      // Filter to only selected files if filePaths provided
      if (input.filePaths && input.filePaths.length > 0) {
        const selectedPaths = new Set(input.filePaths)
        files = files.filter((f) => {
          const filePath = f.newPath !== "/dev/null" ? f.newPath : f.oldPath
          // Match by exact path or by path suffix (handle different path formats)
          return (
            selectedPaths.has(filePath) ||
            [...selectedPaths].some((sp) => filePath.endsWith(sp) || sp.endsWith(filePath))
          )
        })
        console.log(
          `[generateCommitMessage] Filtered ${files.length} files from ${input.filePaths.length} selected paths`,
        )
      }

      if (files.length === 0) {
        throw new Error("No changes to commit")
      }

      // Build filtered diff text for API (only selected files)
      const filteredDiff = files.map((f) => f.diffText).join("\n")
      const additions = files.reduce((sum, f) => sum + f.additions, 0)
      const deletions = files.reduce((sum, f) => sum + f.deletions, 0)

      // Check internet first - if offline, use Ollama
      const hasInternet = await checkInternetConnection()

      if (!hasInternet) {
        console.log("[generateCommitMessage] Offline - trying Ollama...")
        const ollamaMessage = await generateCommitMessageWithOllama(
          filteredDiff,
          files.length,
          additions,
          deletions,
          input.ollamaModel,
        )
        if (ollamaMessage) {
          console.log("[generateCommitMessage] Generated via Ollama:", ollamaMessage)
          return { message: ollamaMessage }
        }
        console.log("[generateCommitMessage] Ollama failed, using heuristic fallback")
        // Fall through to heuristic fallback below
      } else {
        console.log("[generateCommitMessage] Hosted API disabled, using heuristic fallback")
      }

      // Fallback: Generate commit message with conventional commits style
      const fileNames = files.map((f) => {
        const filePath = f.newPath !== "/dev/null" ? f.newPath : f.oldPath
        // Note: Git diff paths always use forward slashes
        return path.posix.basename(filePath) || filePath
      })

      // Detect commit type from file changes
      const hasNewFiles = files.some((f) => f.oldPath === "/dev/null")
      const hasDeletedFiles = files.some((f) => f.newPath === "/dev/null")
      const hasOnlyDeletions = files.every((f) => f.additions === 0 && f.deletions > 0)

      // Detect type from file paths
      const allPaths = files.map((f) => (f.newPath !== "/dev/null" ? f.newPath : f.oldPath))
      const hasTestFiles = allPaths.some((p) => p.includes("test") || p.includes("spec"))
      const hasDocFiles = allPaths.some((p) => p.endsWith(".md") || p.includes("doc"))
      const hasConfigFiles = allPaths.some(
        (p) =>
          p.includes("config") ||
          p.endsWith(".json") ||
          p.endsWith(".yaml") ||
          p.endsWith(".yml") ||
          p.endsWith(".toml"),
      )

      // Determine commit type prefix
      let prefix = "chore"
      if (hasNewFiles && !hasDeletedFiles) {
        prefix = "feat"
      } else if (hasOnlyDeletions) {
        prefix = "chore"
      } else if (hasTestFiles && !hasDocFiles && !hasConfigFiles) {
        prefix = "test"
      } else if (hasDocFiles && !hasTestFiles && !hasConfigFiles) {
        prefix = "docs"
      } else if (allPaths.some((p) => p.includes("fix") || p.includes("bug"))) {
        prefix = "fix"
      } else if (files.length > 0 && files.every((f) => f.additions > 0 || f.deletions > 0)) {
        // Default to fix for modifications (most common case)
        prefix = "fix"
      }

      const uniqueFileNames = [...new Set(fileNames)]
      let message: string

      if (uniqueFileNames.length === 1) {
        message = `${prefix}: update ${uniqueFileNames[0]}`
      } else if (uniqueFileNames.length <= 3) {
        message = `${prefix}: update ${uniqueFileNames.join(", ")}`
      } else {
        message = `${prefix}: update ${uniqueFileNames.length} files`
      }

      console.log("[generateCommitMessage] Generated fallback message:", message)
      return { message }
    }),

  /**
   * Generate a name for a sub-chat using AI
   * Uses Ollama when offline, otherwise calls web API
   */
  generateSubChatName: publicProcedure
    .input(
      z.object({
        userMessage: z.string(),
        ollamaModel: z.string().nullish(), // Optional model for offline mode
      }),
    )
    .mutation(async ({ input }) => {
      try {
        // Check internet first - if offline, use Ollama
        const hasInternet = await checkInternetConnection()

        if (!hasInternet) {
          console.log("[generateSubChatName] Offline - trying Ollama...")
          const ollamaName = await generateChatNameWithOllama(input.userMessage, input.ollamaModel)
          if (ollamaName) {
            console.log("[generateSubChatName] Generated name via Ollama:", ollamaName)
            return { name: ollamaName }
          }
          console.log("[generateSubChatName] Ollama failed, using fallback")
          return { name: getFallbackName(input.userMessage) }
        }

        console.log("[generateSubChatName] Hosted API disabled, using local fallback")
        return { name: getFallbackName(input.userMessage) }
      } catch (error) {
        console.error("[generateSubChatName] Error:", error)
        return { name: getFallbackName(input.userMessage) }
      }
    }),

  // ============ PR-related procedures ============

  /**
   * Get PR context for message generation (branch info, uncommitted changes, etc.)
   */
  getPrContext: publicProcedure.input(z.object({ chatId: z.string() })).query(async ({ input }) => {
    const db = getDatabase()
    const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()

    if (!chat?.worktreePath) {
      return null
    }

    try {
      const git = simpleGit(chat.worktreePath)
      const status = await git.status()

      // Check if upstream exists
      let hasUpstream = false
      try {
        const tracking = await git.raw(["rev-parse", "--abbrev-ref", "@{upstream}"])
        hasUpstream = !!tracking.trim()
      } catch {
        hasUpstream = false
      }

      return {
        branch: chat.branch || status.current || "unknown",
        baseBranch: chat.baseBranch || "main",
        uncommittedCount: status.files.length,
        hasUpstream,
      }
    } catch (error) {
      console.error("[getPrContext] Error:", error)
      return null
    }
  }),

  /**
   * Update PR info after Claude creates a PR
   */
  updatePrInfo: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        prUrl: z.string(),
        prNumber: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const result = db
        .update(chats)
        .set({
          prUrl: input.prUrl,
          prNumber: input.prNumber,
        })
        .where(eq(chats.id, input.chatId))
        .returning()
        .get()

      // Track PR created
      trackPRCreated({
        workspaceId: input.chatId,
        prNumber: input.prNumber,
      })

      return result
    }),

  /**
   * Get PR status from GitHub (via gh CLI)
   */
  getPrStatus: publicProcedure.input(z.object({ chatId: z.string() })).query(async ({ input }) => {
    const db = getDatabase()
    const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()

    if (!chat?.worktreePath) {
      return null
    }

    return await fetchGitHubPRStatus(chat.worktreePath)
  }),

  /**
   * Merge PR via gh CLI
   * First checks if PR is mergeable, returns helpful error if conflicts exist
   */
  mergePr: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        method: z.enum(["merge", "squash", "rebase"]).default("squash"),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()

      if (!chat?.worktreePath || !chat?.prNumber) {
        throw new Error("No PR to merge")
      }

      // Check PR mergeability before attempting merge
      const prStatus = await fetchGitHubPRStatus(chat.worktreePath)
      if (prStatus?.pr?.mergeable === "CONFLICTING") {
        throw new Error(
          "MERGE_CONFLICT: This PR has merge conflicts with the base branch. " +
            "Please sync your branch with the latest changes from main to resolve conflicts.",
        )
      }

      try {
        await execWithShellEnv(
          "gh",
          ["pr", "merge", String(chat.prNumber), `--${input.method}`, "--delete-branch"],
          { cwd: chat.worktreePath },
        )
        return { success: true }
      } catch (error) {
        console.error("[mergePr] Error:", error)
        const errorMsg = error instanceof Error ? error.message : "Failed to merge PR"

        // Check for conflict-related error messages from gh CLI
        if (
          errorMsg.includes("not mergeable") ||
          errorMsg.includes("merge conflict") ||
          errorMsg.includes("cannot be cleanly created") ||
          errorMsg.includes("CONFLICTING")
        ) {
          throw new Error(
            "MERGE_CONFLICT: This PR has merge conflicts with the base branch. " +
              "Please sync your branch with the latest changes from main to resolve conflicts.",
          )
        }

        throw new Error(errorMsg)
      }
    }),

  /**
   * Get file change stats for workspaces
   * Parses messages from specified sub-chats and aggregates Edit/Write tool calls
   * Supports two modes:
   * - openSubChatIds: query specific sub-chats (used by main sidebar)
   * - chatIds: query all sub-chats for given chats (used by archive popover)
   */
  getFileStats: publicProcedure
    .input(
      z.object({
        openSubChatIds: z.array(z.string()).optional(),
        chatIds: z.array(z.string()).optional(),
      }),
    )
    .query(({ input }) => {
      const db = getDatabase()

      // Early return if nothing to check
      if (
        (!input.openSubChatIds || input.openSubChatIds.length === 0) &&
        (!input.chatIds || input.chatIds.length === 0)
      ) {
        return []
      }

      // Query sub-chats based on input mode
      let allChats: Array<{ chatId: string | null; subChatId: string; messages: string | null }>

      if (input.chatIds && input.chatIds.length > 0) {
        // Archive mode: query all sub-chats for given chat IDs
        // Pre-filter with LIKE to skip sub-chats without file edits (avoids loading/parsing large JSON)
        allChats = db
          .select({
            chatId: subChats.chatId,
            subChatId: subChats.id,
            messages: subChats.messages,
          })
          .from(subChats)
          .where(
            and(
              inArray(subChats.chatId, input.chatIds),
              sql`(${subChats.messages} LIKE '%tool-Edit%' OR ${subChats.messages} LIKE '%tool-Write%')`,
            ),
          )
          .all()
      } else {
        // Main sidebar mode: query specific sub-chats
        allChats = db
          .select({
            chatId: subChats.chatId,
            subChatId: subChats.id,
            messages: subChats.messages,
          })
          .from(subChats)
          .where(inArray(subChats.id, input.openSubChatIds!))
          .all()
      }

      // Aggregate stats per workspace (chatId)
      const statsMap = new Map<
        string,
        { additions: number; deletions: number; fileCount: number }
      >()

      for (const row of allChats) {
        if (!row.messages || !row.chatId) continue
        const chatId = row.chatId // TypeScript narrowing

        try {
          const messages = JSON.parse(row.messages) as Array<{
            role: string
            parts?: Array<{
              type: string
              input?: {
                file_path?: string
                old_string?: string
                new_string?: string
                content?: string
              }
            }>
          }>

          // Track file states for this sub-chat
          const fileStates = new Map<
            string,
            { originalContent: string | null; currentContent: string }
          >()

          for (const msg of messages) {
            if (msg.role !== "assistant") continue
            for (const part of msg.parts || []) {
              if (part.type === "tool-Edit" || part.type === "tool-Write") {
                const filePath = part.input?.file_path
                if (!filePath) continue
                // Skip session files
                if (
                  filePath.includes("claude-sessions") ||
                  filePath.includes("Application Support")
                )
                  continue

                const oldString = part.input?.old_string || ""
                const newString = part.input?.new_string || part.input?.content || ""

                const existing = fileStates.get(filePath)
                if (existing) {
                  existing.currentContent = newString
                } else {
                  fileStates.set(filePath, {
                    originalContent: part.type === "tool-Write" ? null : oldString,
                    currentContent: newString,
                  })
                }
              }
            }
          }

          // Calculate stats for this sub-chat and add to workspace total
          let subChatAdditions = 0
          let subChatDeletions = 0
          let subChatFileCount = 0

          for (const [, state] of fileStates) {
            const original = state.originalContent || ""
            if (original === state.currentContent) continue

            const oldLines = original ? original.split("\n").length : 0
            const newLines = state.currentContent ? state.currentContent.split("\n").length : 0

            if (!original) {
              // New file
              subChatAdditions += newLines
            } else {
              subChatAdditions += newLines
              subChatDeletions += oldLines
            }
            subChatFileCount += 1
          }

          // Add to workspace total
          const existing = statsMap.get(chatId) || {
            additions: 0,
            deletions: 0,
            fileCount: 0,
          }
          existing.additions += subChatAdditions
          existing.deletions += subChatDeletions
          existing.fileCount += subChatFileCount
          statsMap.set(chatId, existing)
        } catch {
          // Skip invalid JSON
        }
      }

      // Convert to array for easier consumption
      return Array.from(statsMap.entries()).map(([chatId, stats]) => ({
        chatId,
        ...stats,
      }))
    }),

  /**
   * Get sub-chats with pending plan approvals
   * Uses mode field as source of truth: mode="plan" + completed ExitPlanMode = pending approval
   * Logic must match active-chat.tsx hasUnapprovedPlan
   * REQUIRES openSubChatIds to avoid loading all sub-chats (performance optimization)
   */
  getPendingPlanApprovals: publicProcedure
    .input(z.object({ openSubChatIds: z.array(z.string()) }))
    .query(({ input }) => {
      const db = getDatabase()

      // Early return if no sub-chats to check
      if (input.openSubChatIds.length === 0) {
        return []
      }

      // Query only the specified sub-chats, including mode for filtering
      const allSubChats = db
        .select({
          chatId: subChats.chatId,
          subChatId: subChats.id,
          mode: subChats.mode,
          messages: subChats.messages,
        })
        .from(subChats)
        .where(inArray(subChats.id, input.openSubChatIds))
        .all()

      const pendingApprovals: Array<{ subChatId: string; chatId: string }> = []

      for (const row of allSubChats) {
        if (!row.subChatId || !row.chatId) continue

        if (row.mode !== "plan") continue

        // Only check for ExitPlanMode in Plan-mode chats.
        if (!row.messages) continue

        try {
          const messages = JSON.parse(row.messages) as Array<{
            role: string
            content?: string
            parts?: Array<{
              type: string
              text?: string
              output?: unknown
            }>
          }>

          // Check if there's a completed ExitPlanMode in messages
          const hasCompletedExitPlanMode = (): boolean => {
            for (let i = messages.length - 1; i >= 0; i--) {
              const msg = messages[i]
              if (!msg) continue

              // If assistant message with completed ExitPlanMode, we found an unapproved plan
              if (msg.role === "assistant" && msg.parts) {
                const exitPlanPart = msg.parts.find((p) => p.type === "tool-ExitPlanMode")
                // Check if ExitPlanMode is completed (has output, even if empty)
                if (exitPlanPart && exitPlanPart.output !== undefined) {
                  return true
                }
              }
            }
            return false
          }

          if (hasCompletedExitPlanMode()) {
            pendingApprovals.push({
              subChatId: row.subChatId,
              chatId: row.chatId,
            })
          }
        } catch {
          // Skip invalid JSON
        }
      }

      return pendingApprovals
    }),

  /**
   * Get worktree status for archive dialog
   * Returns whether workspace has a worktree and uncommitted changes count
   */
  getWorktreeStatus: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()

      // No worktree if no branch (local mode)
      if (!chat?.worktreePath || !chat?.branch) {
        return { hasWorktree: false, uncommittedCount: 0 }
      }

      try {
        const git = simpleGit(chat.worktreePath)
        const status = await git.status()

        return {
          hasWorktree: true,
          uncommittedCount: status.files.length,
        }
      } catch (error) {
        // Worktree path doesn't exist or git error
        console.warn("[getWorktreeStatus] Error checking worktree:", error)
        return { hasWorktree: false, uncommittedCount: 0 }
      }
    }),

  /**
   * Export a chat conversation to various formats.
   * Supports exporting entire workspace or a single sub-chat.
   * Useful for sharing, backup, or importing into other tools.
   */
  exportChat: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        subChatId: z.string().optional(), // If provided, export only this sub-chat
        format: z.enum(["json", "markdown", "text", "handoff"]).default("markdown"),
      }),
    )
    .query(async ({ input }) => {
      const db = getDatabase()
      const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()

      if (!chat) {
        throw new Error("Chat not found")
      }

      const project = chat.projectId
        ? db.select().from(projects).where(eq(projects.id, chat.projectId)).get()
        : null

      // Query sub-chats: either a specific one or all for the chat
      let chatSubChats
      if (input.subChatId) {
        // Export single sub-chat
        const singleSubChat = db
          .select()
          .from(subChats)
          .where(
            and(
              eq(subChats.id, input.subChatId),
              eq(subChats.chatId, input.chatId), // Ensure sub-chat belongs to this chat
            ),
          )
          .get()

        if (!singleSubChat) {
          throw new Error("Sub-chat not found")
        }
        chatSubChats = [singleSubChat]
      } else {
        // Export all sub-chats
        chatSubChats = db
          .select()
          .from(subChats)
          .where(eq(subChats.chatId, input.chatId))
          .orderBy(subChats.createdAt)
          .all()
      }

      // parse messages from sub-chats
      const allMessages: Array<{
        subChatId: string
        subChatName: string | null
        createdAt?: Date
        messages: Array<{
          id: string
          role: string
          createdAt?: Date | string
          parts: Array<{ type: string; text?: string; [key: string]: any }>
          metadata?: any
        }>
      }> = []

      for (const subChat of chatSubChats) {
        try {
          const messages = JSON.parse(subChat.messages || "[]")
          allMessages.push({
            subChatId: subChat.id,
            subChatName: subChat.name,
            createdAt: subChat.createdAt ?? undefined,
            messages,
          })
        } catch {
          // skip invalid json
        }
      }

      // Sanitize filename - remove characters that are invalid on Windows/macOS/Linux
      const sanitizeFilename = (name: string): string => {
        return (
          name
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") // Invalid chars
            .replace(/\s+/g, "_") // Replace spaces with underscores
            .replace(/_+/g, "_") // Collapse multiple underscores
            .replace(/^_|_$/g, "") // Trim underscores from ends
            .slice(0, 100) || // Limit length
          "chat"
        ) // Fallback if empty
      }

      // Use sub-chat name if exporting single sub-chat, otherwise use chat name
      const exportName =
        input.subChatId && chatSubChats[0]?.name
          ? `${chat.name || "chat"}-${chatSubChats[0].name}`
          : chat.name || "chat"
      const safeFilename = sanitizeFilename(exportName)

      if (input.format === "handoff") {
        return {
          format: "handoff" as const,
          content: formatChatHandoff({
            chat: {
              id: chat.id,
              name: chat.name,
              branch: chat.branch,
              createdAt: chat.createdAt ?? undefined,
            },
            project,
            conversations: allMessages,
          }),
          filename: `${safeFilename}-${chat.id.slice(0, 8)}-handoff.md`,
        }
      }

      if (input.format === "json") {
        return {
          format: "json" as const,
          content: JSON.stringify(
            {
              exportedAt: new Date().toISOString(),
              chat: {
                id: chat.id,
                name: chat.name,
                createdAt: chat.createdAt,
                branch: chat.branch,
                baseBranch: chat.baseBranch,
                prUrl: chat.prUrl,
              },
              project: project
                ? {
                    id: project.id,
                    name: project.name,
                    path: project.path,
                  }
                : null,
              conversations: allMessages.map((conversation) => ({
                ...conversation,
                messages: conversation.messages.map(omitHiddenFileContentFromMessage),
              })),
            },
            null,
            2,
          ),
          filename: `${safeFilename}-${chat.id.slice(0, 8)}.json`,
        }
      }

      if (input.format === "text") {
        // plain text format
        let text = `# ${chat.name || "Untitled Chat"}\n`
        text += `exported: ${new Date().toISOString()}\n`
        if (project) {
          text += `project: ${project.name}\n`
        }
        text += `\n---\n\n`

        for (const subChatData of allMessages) {
          if (subChatData.subChatName) {
            text += `## ${subChatData.subChatName}\n\n`
          }

          for (const msg of subChatData.messages) {
            const role = msg.role === "user" ? "You" : "Assistant"
            text += `${role}:\n`

            for (const part of msg.parts || []) {
              if (part.type === "text" && part.text) {
                text += `${part.text}\n`
              } else if (part.type?.startsWith("tool-") && part.toolName) {
                text += `[used ${part.toolName} tool]\n`
              }
            }
            text += "\n"
          }
        }

        return {
          format: "text" as const,
          content: text,
          filename: `${safeFilename}-${chat.id.slice(0, 8)}.txt`,
        }
      }

      // markdown format (default)
      let markdown = `# ${chat.name || "Untitled Chat"}\n\n`
      markdown += `**Exported:** ${new Date().toISOString()}\n\n`
      if (project) {
        markdown += `**Project:** ${project.name}\n\n`
      }
      if (chat.branch) {
        markdown += `**Branch:** \`${chat.branch}\`\n\n`
      }
      if (chat.prUrl) {
        markdown += `**PR:** [${chat.prUrl}](${chat.prUrl})\n\n`
      }
      markdown += `---\n\n`

      for (const subChatData of allMessages) {
        if (subChatData.subChatName) {
          markdown += `## ${subChatData.subChatName}\n\n`
        }

        for (const msg of subChatData.messages) {
          const role = msg.role === "user" ? "**You**" : "**Assistant**"
          markdown += `### ${role}\n\n`

          for (const part of msg.parts || []) {
            if (part.type === "text" && part.text) {
              markdown += `${part.text}\n\n`
            } else if (part.type?.startsWith("tool-") && part.toolName) {
              const toolName = part.toolName
              if (toolName === "Bash" && part.input?.command) {
                markdown += `\`\`\`bash\n${part.input.command}\n\`\`\`\n\n`
              } else if ((toolName === "Edit" || toolName === "Write") && part.input?.file_path) {
                markdown += `> Modified: \`${part.input.file_path}\`\n\n`
              } else if (toolName === "Read" && part.input?.file_path) {
                markdown += `> Read: \`${part.input.file_path}\`\n\n`
              } else {
                markdown += `> *Used ${toolName} tool*\n\n`
              }
            }
          }
        }
      }

      return {
        format: "markdown" as const,
        content: markdown,
        filename: `${safeFilename}-${chat.id.slice(0, 8)}.md`,
      }
    }),

  /**
   * Get basic stats for a chat (message count, tool usage, etc.)
   * Supports both full chat stats and individual sub-chat stats.
   * Useful for showing chat summary in sidebar or export dialogs.
   */
  getChatStats: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        subChatId: z.string().optional(), // If provided, return stats for only this sub-chat
      }),
    )
    .query(({ input }) => {
      const db = getDatabase()

      let chatSubChats
      if (input.subChatId) {
        // Get stats for a single sub-chat
        const singleSubChat = db
          .select()
          .from(subChats)
          .where(and(eq(subChats.id, input.subChatId), eq(subChats.chatId, input.chatId)))
          .get()

        chatSubChats = singleSubChat ? [singleSubChat] : []
      } else {
        // Get stats for all sub-chats
        chatSubChats = db
          .select()
          .from(subChats)
          .where(eq(subChats.chatId, input.chatId))
          .orderBy(subChats.updatedAt)
          .all()
      }

      let messageCount = 0
      let userMessageCount = 0
      let assistantMessageCount = 0
      let toolCalls = 0
      const toolUsage: Record<string, number> = {}
      let totalInputTokens = 0
      let totalOutputTokens = 0
      let contextWindow = 0
      let latestContextTokens = 0
      const usageByRun = new Map<string, number>()
      let usageWithoutRun = 0

      for (const subChat of chatSubChats) {
        try {
          const messages = JSON.parse(subChat.messages || "[]") as Array<{
            role: string
            parts?: Array<{ type: string; toolName?: string }>
            metadata?: {
              runId?: string
              transport?: string
              model?: string
              inputTokens?: number
              outputTokens?: number
              totalTokens?: number
              cacheReadInputTokens?: number
              cacheCreationInputTokens?: number
              modelContextWindow?: number
              usage?: {
                inputTokens?: number
                outputTokens?: number
                contextWindow?: number
              }
            }
          }>

          for (const msg of messages) {
            messageCount++
            if (msg.role === "user") {
              userMessageCount++
            } else if (msg.role === "assistant") {
              assistantMessageCount++

              // count tool calls
              for (const part of msg.parts || []) {
                if (part.type?.startsWith("tool-") && part.toolName) {
                  toolCalls++
                  toolUsage[part.toolName] = (toolUsage[part.toolName] || 0) + 1
                }
              }

              // aggregate token usage
              if (msg.metadata) {
                const outputTokens =
                  msg.metadata.usage?.outputTokens ?? msg.metadata.outputTokens ?? 0
                const inputTokens =
                  msg.metadata.usage?.inputTokens ??
                  msg.metadata.inputTokens ??
                  (msg.metadata.totalTokens == null
                    ? 0
                    : Math.max(0, msg.metadata.totalTokens - outputTokens))
                const cachedTokens =
                  (msg.metadata.cacheReadInputTokens ?? 0) +
                  (msg.metadata.cacheCreationInputTokens ?? 0)
                const normalizedModel = msg.metadata.model?.toLowerCase() ?? ""
                const inputIncludesCachedTokens =
                  msg.metadata.transport === "codex-runtime" ||
                  normalizedModel.includes("codex") ||
                  normalizedModel.startsWith("gpt-")
                const countedInputTokens =
                  inputTokens + (inputIncludesCachedTokens ? 0 : cachedTokens)
                const messageTotalTokens = Math.max(
                  typeof msg.metadata.totalTokens === "number" &&
                    Number.isFinite(msg.metadata.totalTokens) &&
                    msg.metadata.totalTokens > 0
                    ? msg.metadata.totalTokens
                    : 0,
                  countedInputTokens + outputTokens,
                )

                totalInputTokens += countedInputTokens
                totalOutputTokens += outputTokens
                if (messageTotalTokens > 0) {
                  if (msg.metadata.runId) {
                    usageByRun.set(
                      msg.metadata.runId,
                      Math.max(usageByRun.get(msg.metadata.runId) ?? 0, messageTotalTokens),
                    )
                  } else {
                    usageWithoutRun += messageTotalTokens
                  }
                }
                contextWindow =
                  msg.metadata.usage?.contextWindow ??
                  msg.metadata.modelContextWindow ??
                  contextWindow
                latestContextTokens = countedInputTokens
              }
            }
          }
        } catch {
          // skip invalid json
        }
      }

      const totalTokens =
        usageWithoutRun + [...usageByRun.values()].reduce((sum, value) => sum + value, 0)

      return {
        messageCount,
        userMessageCount,
        assistantMessageCount,
        toolCalls,
        toolUsage,
        totalInputTokens,
        totalOutputTokens,
        totalTokens,
        contextWindow,
        latestContextTokens,
        subChatCount: chatSubChats.length,
      }
    }),
})
