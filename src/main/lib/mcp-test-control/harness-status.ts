import { existsSync } from "node:fs"
import { join } from "node:path"
import { claudeCodeCredentials, anthropicAccounts, anthropicSettings, getDatabase } from "../db"
import { eq } from "drizzle-orm"
import {
  getBundledNodePathPrefix,
  redactShellResult,
  resolveCommandPath,
  runShellCommand,
} from "./shell"
import { normalizeCodexStatus, SAFE_CHATGPT_CODEX_MODEL } from "./codex-status"

export async function getHarnessStatus(input?: { probeCli?: boolean; repoPath?: string }) {
  const codexPath = await resolveCommandPath("codex")
  const claudePath = await resolveCommandPath("claude")
  const bundledNodePath = getBundledNodePathPrefix()
  const repoPath = input?.repoPath ?? process.cwd()

  const codexBinary = {
    path: codexPath,
    exists: !!codexPath && existsSync(codexPath),
    isHomebrew: codexPath?.startsWith("/opt/homebrew/") ?? false,
    bundledPath: join(repoPath, "resources", "bin", `${process.platform}-${process.arch}`, "codex"),
    bundledExists: existsSync(
      join(repoPath, "resources", "bin", `${process.platform}-${process.arch}`, "codex"),
    ),
  }

  let codexCli: Awaited<ReturnType<typeof runShellCommand>> | null = null
  let codexState = normalizeCodexStatus("")

  if (input?.probeCli && codexPath) {
    codexCli = redactShellResult(
      await runShellCommand(codexPath, ["login", "status"], {
        cwd: repoPath,
        timeoutMs: 15_000,
      }),
    )
    codexState = normalizeCodexStatus(`${codexCli.stdout}\n${codexCli.stderr}`)
  }

  const db = getDatabase()
  const settings = db
    .select()
    .from(anthropicSettings)
    .where(eq(anthropicSettings.id, "singleton"))
    .get()
  const activeAccount = settings?.activeAccountId
    ? db
        .select()
        .from(anthropicAccounts)
        .where(eq(anthropicAccounts.id, settings.activeAccountId))
        .get()
    : null
  const legacyCredential = db
    .select()
    .from(claudeCodeCredentials)
    .where(eq(claudeCodeCredentials.id, "default"))
    .get()

  return {
    codex: {
      commandPath: codexPath,
      binary: codexBinary,
      cli: codexCli,
      state: codexState.state,
      recommendedModel: codexState.recommendedModel,
      safeChatGptModel: SAFE_CHATGPT_CODEX_MODEL,
      availableModelsForChatGptAuth: [SAFE_CHATGPT_CODEX_MODEL],
    },
    claude: {
      commandPath: claudePath,
      globalCliDetected: !!claudePath,
      appTokenStored: Boolean(activeAccount?.oauthToken || legacyCredential?.oauthToken),
      activeAccountId: activeAccount?.id ?? null,
      activeAccountLabel: activeAccount?.displayName ?? activeAccount?.email ?? null,
      hostedSandboxAuth: "disabled",
      isolatedConfigWarning:
        "Claude runs use isolated CLAUDE_CONFIG_DIR per chat; global CLI auth does not prove app-run auth.",
    },
    runtime: {
      nodeVersion: process.version,
      bundledNodePath,
      shouldUseBundledNodeForCheck: Boolean(bundledNodePath),
    },
  }
}
