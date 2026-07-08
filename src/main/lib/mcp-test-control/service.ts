import { desc, eq } from "drizzle-orm"
import { app } from "electron"
import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  agentRuns,
  chats,
  checkpoints,
  fileChangeManifests,
  getDatabase,
  projects,
  subChats,
} from "../db"
import { DEFAULT_CLAUDE_MODEL_ID } from "../../../shared/model-catalog"
import { SAFE_CHATGPT_CODEX_MODEL } from "./codex-status"
import { devMcpTestControlTools } from "./registry"
import { getHarnessStatus } from "./harness-status"
import {
  appendUserMessage,
  findLastAssistantMessage,
  getMessageText,
  parseStoredMessages,
  summarizeMessages,
} from "./messages"
import {
  getBundledNodePathPrefix,
  redactShellResult,
  runShellCommand,
  withRecommendedNodePath,
} from "./shell"

export function getTestEnvironment(repoPath = process.cwd()) {
  const userDataPath = app.getPath("userData")
  const dbPath = join(userDataPath, "data", "agents.db")
  const bundledNodePath = getBundledNodePathPrefix()

  return {
    app: {
      name: app.getName(),
      isPackaged: app.isPackaged,
      userDataPath,
      databasePath: dbPath,
      databaseExists: existsSync(dbPath),
    },
    repo: {
      path: repoPath,
      packageJsonExists: existsSync(join(repoPath, "package.json")),
      openspecChangePath: join(repoPath, "openspec", "changes", "add-stage1-workspace-core"),
    },
    runtime: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      bundledNodePath,
      recommendedCheckEnv:
        bundledNodePath === null ? null : `PATH="${bundledNodePath}:$PATH" npm run check`,
    },
    tools: devMcpTestControlTools,
  }
}

export function listTestTargets() {
  const db = getDatabase()
  const projectRows = db.select().from(projects).orderBy(desc(projects.updatedAt)).all()
  const chatRows = db.select().from(chats).orderBy(desc(chats.updatedAt)).all()
  const subChatRows = db.select().from(subChats).orderBy(desc(subChats.updatedAt)).all()

  return {
    projects: projectRows.map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
      updatedAt: project.updatedAt?.toISOString() ?? null,
    })),
    chats: chatRows.map((chat) => ({
      id: chat.id,
      name: chat.name,
      projectId: chat.projectId,
      taskId: chat.taskId,
      scope: chat.scope,
      harness: chat.harness,
      model: chat.model,
      permissionMode: chat.permissionMode,
      worktreePath: chat.worktreePath,
      branch: chat.branch,
      archived: Boolean(chat.archivedAt),
      updatedAt: chat.updatedAt?.toISOString() ?? null,
    })),
    subChats: subChatRows.map((subChat) => ({
      id: subChat.id,
      name: subChat.name,
      chatId: subChat.chatId,
      mode: subChat.mode,
      harness: subChat.harness,
      model: subChat.model,
      permissionMode: subChat.permissionMode,
      worktreePath: subChat.worktreePath,
      runStatus: subChat.runStatus,
      sessionId: subChat.sessionId,
      streamId: subChat.streamId,
      messages: summarizeMessages(subChat.messages),
      updatedAt: subChat.updatedAt?.toISOString() ?? null,
    })),
  }
}

export function setChatRunConfig(input: {
  subChatId: string
  harness: "codex" | "claude-code"
  model?: string
  permissionMode?: string
  worktreePath?: string
}) {
  const db = getDatabase()
  const subChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
  if (!subChat) throw new Error("Sub-chat not found")

  const messages = parseStoredMessages(subChat.messages)
  const metadata = {
    devMcpRunConfig: {
      harness: input.harness,
      model:
        input.harness === "codex"
          ? input.model || SAFE_CHATGPT_CODEX_MODEL
          : input.model || DEFAULT_CLAUDE_MODEL_ID,
      permissionMode: input.permissionMode ?? null,
      worktreePath: input.worktreePath ?? null,
      updatedAt: new Date().toISOString(),
    },
  }
  const runConfig = metadata.devMcpRunConfig

  messages.push({
    id: `dev-mcp-config-${Date.now()}`,
    role: "system",
    parts: [{ type: "text", text: "Dev MCP test run config updated." }],
    metadata,
  })

  db.update(subChats)
    .set({
      harness: runConfig.harness,
      model: runConfig.model,
      permissionMode: runConfig.permissionMode,
      worktreePath: runConfig.worktreePath,
      messages: JSON.stringify(messages),
      updatedAt: new Date(),
    })
    .where(eq(subChats.id, input.subChatId))
    .run()

  const parentChat = db.select().from(chats).where(eq(chats.id, subChat.chatId)).get()
  if (parentChat) {
    db.update(chats)
      .set({
        harness: runConfig.harness,
        model: runConfig.model,
        permissionMode: runConfig.permissionMode ?? parentChat.permissionMode,
        worktreePath: runConfig.worktreePath ?? parentChat.worktreePath,
        updatedAt: new Date(),
      })
      .where(eq(chats.id, parentChat.id))
      .run()
  }

  return runConfig
}

export function sendTestPrompt(input: { subChatId: string; prompt: string; noEdit?: boolean }) {
  const db = getDatabase()
  const subChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
  if (!subChat) throw new Error("Sub-chat not found")

  const prompt = input.noEdit ? `${input.prompt.trim()}\n\nDo not edit files.` : input.prompt.trim()
  if (!prompt) throw new Error("Prompt cannot be empty")

  const messages = appendUserMessage(subChat.messages, prompt, {
    devMcpTestPrompt: true,
    noEdit: Boolean(input.noEdit),
  })

  db.update(subChats)
    .set({ messages, updatedAt: new Date() })
    .where(eq(subChats.id, input.subChatId))
    .run()

  return {
    subChatId: input.subChatId,
    prompt,
    appended: true,
  }
}

export async function waitForRun(input: {
  subChatId: string
  afterAssistantCount?: number
  timeoutMs?: number
  pollMs?: number
}) {
  const timeoutAt = Date.now() + (input.timeoutMs ?? 60_000)
  const pollMs = input.pollMs ?? 1_000

  while (Date.now() < timeoutAt) {
    const verified = verifyRunArtifacts({
      subChatId: input.subChatId,
      expectedAssistantText: undefined,
    })

    if (verified.messageCounts.assistant > (input.afterAssistantCount ?? 0)) {
      return { completed: true, ...verified }
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  return {
    completed: false,
    reason: "Timed out waiting for assistant reply.",
    ...verifyRunArtifacts({ subChatId: input.subChatId }),
  }
}

export function verifyRunArtifacts(input: {
  subChatId: string
  expectedAssistantText?: string
  noEditExpected?: boolean
}) {
  const db = getDatabase()
  const subChat = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
  if (!subChat) throw new Error("Sub-chat not found")

  const messages = parseStoredMessages(subChat.messages)
  const lastAssistant = findLastAssistantMessage(messages)
  const lastAssistantText = lastAssistant ? getMessageText(lastAssistant) : null
  const messageCounts = summarizeMessages(subChat.messages)
  const expectedTextMatched =
    input.expectedAssistantText === undefined
      ? null
      : Boolean(lastAssistantText?.includes(input.expectedAssistantText))
  const latestRun = db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.subChatId, input.subChatId))
    .orderBy(desc(agentRuns.startedAt))
    .get()
  const runCheckpoints = latestRun
    ? db.select().from(checkpoints).where(eq(checkpoints.runId, latestRun.id)).all()
    : []
  const manifest = latestRun
    ? db.select().from(fileChangeManifests).where(eq(fileChangeManifests.runId, latestRun.id)).all()
    : []
  const manifestHasOnlyNoChanges =
    manifest.length > 0 && manifest.every((entry) => entry.changeType === "none")

  return {
    subChatId: input.subChatId,
    sessionId: subChat.sessionId,
    streamId: subChat.streamId,
    runStatus: subChat.runStatus,
    hasAssistantReply: Boolean(lastAssistant),
    lastAssistantText,
    expectedTextMatched,
    noEditExpected: Boolean(input.noEditExpected),
    run: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          harness: latestRun.harness,
          model: latestRun.model,
          permissionMode: latestRun.permissionMode,
          worktreePath: latestRun.worktreePath,
          beforeCheckpointId: latestRun.beforeCheckpointId,
          afterCheckpointId: latestRun.afterCheckpointId,
          completedAt: latestRun.completedAt?.toISOString() ?? null,
        }
      : null,
    checkpoints: runCheckpoints.map((checkpoint) => ({
      id: checkpoint.id,
      kind: checkpoint.kind,
      worktreePath: checkpoint.worktreePath,
      gitCommit: checkpoint.gitCommit,
      createdAt: checkpoint.createdAt?.toISOString() ?? null,
    })),
    manifest: manifest.map((entry) => ({
      id: entry.id,
      filePath: entry.filePath,
      changeType: entry.changeType,
      additions: entry.additions,
      deletions: entry.deletions,
    })),
    noEditMatched: input.noEditExpected ? manifestHasOnlyNoChanges : null,
    messageCounts,
  }
}

export async function runProjectCheck(input: { repoPath?: string; timeoutMs?: number }) {
  const repoPath = input.repoPath ?? process.cwd()
  const result = await runShellCommand("npm", ["run", "check"], {
    cwd: repoPath,
    timeoutMs: input.timeoutMs ?? 180_000,
    env: withRecommendedNodePath(),
  })

  return redactShellResult(result)
}

export async function openspecValidate(input: { repoPath?: string; timeoutMs?: number }) {
  const repoPath = input.repoPath ?? process.cwd()
  const result = await runShellCommand(
    "npx",
    [
      "-y",
      "@fission-ai/openspec",
      "validate",
      "add-stage1-workspace-core",
      "--strict",
      "--no-interactive",
    ],
    {
      cwd: repoPath,
      timeoutMs: input.timeoutMs ?? 120_000,
      env: {
        ...withRecommendedNodePath(),
        OPENSPEC_TELEMETRY: "0",
      },
    },
  )

  return redactShellResult(result)
}

export async function getHarnessStatusForRepo(input?: { probeCli?: boolean; repoPath?: string }) {
  return getHarnessStatus(input)
}
