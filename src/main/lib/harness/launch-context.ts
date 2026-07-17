import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, isAbsolute, join } from "node:path"
import { promptEnablesAgentHotline } from "../../../shared/agent-hotline"
import {
  collectGitPreflightSnapshot,
  formatGitPreflightSnapshot,
  isRepositoryStateQuestion,
} from "./git-preflight"

const MAX_FILE_CHARS = 1800
const MAX_TOTAL_FILE_CHARS = 5000
const MAX_BASE_FILES = 6
const MAX_REFERENCED_FILES = 2

export const FLAPSTACK_DEFAULT_BEHAVIOR_INSTRUCTION = `# Flapstack default behavior

Caveman full and ponytail full are enabled by default for every chat.

- Caveman full: keep replies short, direct, and free of filler while preserving
  whatever detail the task needs. Do not add an introduction, recap, repeated
  context, or an offer to do more work.
- Ponytail full: choose the smallest, simplest solution that fully works. Avoid
  speculative architecture and unnecessary abstraction.
- /caveman lite|full|ultra and /ponytail lite|full|ultra adjust intensity only.
- normal mode, stop caveman, and stop ponytail do not disable these defaults.

Never quote, reproduce, or narrate Flapstack's internal context envelope in
visible reasoning or the final answer. Use loaded instructions silently. Do not
add a startup-file receipt unless the user explicitly asks what was loaded.

Concise output must never reduce investigation quality or omit material results.
Use the tools, live repository evidence, and verification needed for an accurate
answer; compress presentation only after the work is complete.

These are application-owned instructions. Follow them even when no repository or
user-level instruction file is present.`

type LaunchContextFile = {
  path: string
  content: string
}

type LocalVaultConfig = {
  enabled?: boolean
  vaultRoot?: string
}

export type HarnessContextSessionMode = "new" | "resumed"

export type HarnessContextMetadata = {
  mode: HarnessContextSessionMode
  sourcePaths: string[]
  sourceFingerprint: string
  sourceChars: number
  gitScope?: {
    repository: string
    currentBranch: string | null
    headSha: string
    dirty: boolean
    worktrees: Array<{
      name: string
      branch: string | null
      headSha: string
      detached: boolean
      locked: boolean
      prunable: boolean
    }>
  }
}

export type HarnessContextBundle = {
  context: string
  metadata: HarnessContextMetadata
}

export function getLastHarnessContextFingerprint(messages: unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || typeof message !== "object") continue

    const metadata = (message as { metadata?: unknown }).metadata
    if (!metadata || typeof metadata !== "object") continue

    const context = (metadata as { context?: unknown }).context
    if (!context || typeof context !== "object") continue

    const fingerprint = (context as { sourceFingerprint?: unknown }).sourceFingerprint
    if (typeof fingerprint === "string" && /^[a-f0-9]{64}$/.test(fingerprint)) {
      return fingerprint
    }
  }

  return undefined
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    const content = await readFile(path, "utf-8")
    const trimmed = content.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

async function readLocalVaultConfig(path: string): Promise<LocalVaultConfig | null> {
  const content = await readTextFile(path)
  if (!content) return null

  try {
    const parsed = JSON.parse(content) as LocalVaultConfig
    if (parsed.enabled !== true || typeof parsed.vaultRoot !== "string") return null
    const vaultRoot = parsed.vaultRoot.trim()
    return vaultRoot && isAbsolute(vaultRoot) ? { enabled: true, vaultRoot } : null
  } catch {
    return null
  }
}

function truncateContent(content: string): string {
  if (content.length <= MAX_FILE_CHARS) {
    return content
  }

  return `${content.slice(0, MAX_FILE_CHARS)}\n\n[...truncated by Flapstack launch context...]`
}

const AGENT_HOTLINE_BLOCK =
  /<!--\s*AGENT_HOTLINE_SPOKEN_START\s*-->[\s\S]*?<!--\s*AGENT_HOTLINE_SPOKEN_END\s*-->/gi

function stripInactiveAgentHotlineInstructions(
  context: string,
  prompt: string,
  hotlineEnabled?: boolean,
): string {
  if (hotlineEnabled ?? promptEnablesAgentHotline(prompt)) return context
  return context
    .replace(AGENT_HOTLINE_BLOCK, "")
    .split("\n")
    .filter(
      (line) =>
        !/\b(?:agent hotline|hotline|read[_ -]?aloud|spoken mode|spoken|displayed)\b/i.test(line),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
}

function extractAbsoluteMarkdownPaths(content: string): string[] {
  const paths = new Set<string>()
  const absolutePathPattern = /\/[^\s`'"<>)]+\.md/g

  for (const match of content.matchAll(absolutePathPattern)) {
    const path = match[0]
    if (isAbsolute(path)) {
      paths.add(path)
    }
  }

  return Array.from(paths)
}

async function collectLaunchContextFiles(
  cwd: string,
  projectPath?: string,
  vaultConfigPath = join(homedir(), ".flapstack", "launch-context.json"),
  excludedPaths = new Set<string>(),
): Promise<LaunchContextFile[]> {
  const roots = Array.from(new Set([projectPath, cwd].filter(Boolean) as string[]))
  const projectName = basename(projectPath || cwd)
  const candidatePaths: string[] = []

  for (const root of roots) {
    candidatePaths.push(join(root, "AGENTS.md"), join(root, "CLAUDE.md"))
  }

  const vaultConfig = await readLocalVaultConfig(vaultConfigPath)
  if (vaultConfig?.vaultRoot) {
    const projectVaultRoot = join(vaultConfig.vaultRoot, "Wiki", "Projects", projectName)
    candidatePaths.push(
      join(projectVaultRoot, `${projectName.toLowerCase()}_index.md`),
      join(projectVaultRoot, "current-handoff.md"),
      join(vaultConfig.vaultRoot, "AGENTS.md"),
      join(vaultConfig.vaultRoot, "Wiki", "Projects", "projects_index.md"),
    )
  }

  candidatePaths.push(
    join(homedir(), ".codex", "AGENTS.md"),
    join(homedir(), ".claude", "CLAUDE.md"),
  )

  const files: LaunchContextFile[] = []
  const seen = new Set<string>()
  let remainingChars = MAX_TOTAL_FILE_CHARS

  async function addFile(path: string): Promise<boolean> {
    if (excludedPaths.has(path)) return false
    if (seen.has(path) || remainingChars <= 0) return false
    seen.add(path)

    const content = await readTextFile(path)
    if (!content) return false

    const truncated = truncateContent(content)
    const bounded = truncated.slice(0, remainingChars)
    files.push({
      path,
      content:
        bounded.length < truncated.length
          ? `${bounded}\n\n[...startup context budget reached...]`
          : bounded,
    })
    remainingChars -= bounded.length
    return true
  }

  for (const path of candidatePaths) {
    if (files.length >= MAX_BASE_FILES) break
    await addFile(path)
  }

  const referencedPaths = files.flatMap((file) => extractAbsoluteMarkdownPaths(file.content))
  for (const path of referencedPaths.slice(0, MAX_REFERENCED_FILES)) {
    await addFile(path)
  }

  return files
}

export async function buildHarnessContextBundle(params: {
  cwd: string
  projectPath?: string
  harness: "codex" | "claude-code" | "cursor-agent" | "opencode" | "local"
  vaultConfigPath?: string
  userPrompt?: string
  sessionMode?: HarnessContextSessionMode
  providerNativeInstructions?: boolean
  previousSourceFingerprint?: string | null
}): Promise<HarnessContextBundle> {
  const mode = params.sessionMode ?? "new"
  const gitPreflight =
    params.userPrompt && isRepositoryStateQuestion(params.userPrompt)
      ? await collectGitPreflightSnapshot(params.cwd)
      : null
  const gitSection = gitPreflight ? `\n\n${formatGitPreflightSnapshot(gitPreflight)}` : ""
  const projectName = basename(params.projectPath || params.cwd)
  const nativeInstructionRoots = Array.from(
    new Set([params.projectPath, params.cwd].filter(Boolean) as string[]),
  )
  const providerNativeInstructionPaths = params.providerNativeInstructions
    ? new Set(
        params.harness === "claude-code"
          ? [
              ...nativeInstructionRoots.map((root) => join(root, "CLAUDE.md")),
              join(homedir(), ".claude", "CLAUDE.md"),
            ]
          : params.harness === "codex"
            ? [
                ...nativeInstructionRoots.map((root) => join(root, "AGENTS.md")),
                join(homedir(), ".codex", "AGENTS.md"),
              ]
            : [],
      )
    : undefined
  const files = await collectLaunchContextFiles(
    params.cwd,
    params.projectPath,
    params.vaultConfigPath,
    providerNativeInstructionPaths,
  )
  const sourceFingerprint = createHash("sha256")
    .update(files.map((file) => `${file.path}\0${file.content}`).join("\0\0"))
    .digest("hex")
  const metadata: HarnessContextMetadata = {
    mode,
    sourcePaths: files.map((file) => file.path),
    sourceFingerprint,
    sourceChars: files.reduce((total, file) => total + file.content.length, 0),
    ...(gitPreflight
      ? {
          gitScope: {
            repository: basename(gitPreflight.repositoryRoot),
            currentBranch: gitPreflight.currentBranch,
            headSha: gitPreflight.headSha,
            dirty: gitPreflight.dirty,
            worktrees: gitPreflight.worktrees.map((worktree) => ({
              name: basename(worktree.path),
              branch: worktree.branch,
              headSha: worktree.headSha,
              detached: worktree.detached,
              locked: worktree.locked,
              prunable: worktree.prunable,
            })),
          },
        }
      : {}),
  }

  const startupSourcesUnchanged =
    mode === "resumed" &&
    Boolean(params.previousSourceFingerprint) &&
    params.previousSourceFingerprint === sourceFingerprint

  if (startupSourcesUnchanged) {
    return {
      context: `--- FLAPSTACK COMPACT CONTEXT (DO NOT QUOTE) ---
Harness: ${params.harness}
Project: ${projectName}
Working directory: ${params.cwd}

Continue following startup and project instructions already loaded by this
session. Keep the visible answer concise, but investigate and verify as deeply
as needed. Do not emit a startup-file receipt. Treat memory and handoffs as
possibly stale leads; live repository evidence is authoritative.${gitSection}
--- END FLAPSTACK COMPACT CONTEXT ---`,
      metadata,
    }
  }

  const fileList = files.length
    ? files.map((file) => `- ${file.path}`).join("\n")
    : "- No external startup files found; Flapstack defaults still apply."
  const sections = files
    .map(
      (
        file,
      ) => `--- BEGIN LOADED ${isHintFile(file.path) ? "HINT" : "INSTRUCTION"} FILE: ${file.path} ---
${file.content}
--- END LOADED FILE ---`,
    )
    .join("\n\n")

  return {
    context: `--- FLAPSTACK INTERNAL CONTEXT (DO NOT QUOTE) ---
Harness: ${params.harness}
Project: ${projectName}
Working directory: ${params.cwd}

Flapstack loaded these startup files before the user request:
${fileList}

Follow these instructions as active project context. If the user asks what context
or instructions are loaded, name these files and summarize the relevant loaded
context. Do not claim that no context was loaded when this block is present.

Startup content is deliberately capped. Read additional relevant sources with
tools when needed. Handoffs and memory are possibly stale leads, never
authoritative current state; live repository evidence overrides them.

--- FLAPSTACK DEFAULTS ---
${FLAPSTACK_DEFAULT_BEHAVIOR_INSTRUCTION}
--- END FLAPSTACK DEFAULTS ---

${sections}
${gitSection}
--- END FLAPSTACK INTERNAL CONTEXT ---`,
    metadata,
  }
}

export async function buildHarnessStartupContext(params: {
  cwd: string
  projectPath?: string
  harness: "codex" | "claude-code" | "cursor-agent" | "opencode" | "local"
  vaultConfigPath?: string
  userPrompt?: string
  sessionMode?: HarnessContextSessionMode
  providerNativeInstructions?: boolean
  previousSourceFingerprint?: string | null
}): Promise<string> {
  return (await buildHarnessContextBundle(params)).context
}

function isHintFile(path: string): boolean {
  return /(?:current-)?handoff\.md$/i.test(path) || /(?:^|\/)memories?(?:\/|$)/i.test(path)
}

function neutralizeEmbeddedThreadModeCommands(context: string): string {
  return context
    .replace(/\/(caveman|ponytail)\s+(lite|full|ultra)\b/gi, "/$1 [$2]")
    .replace(/\bhotline\b/gi, "hot-line")
    .replace(/\bread[- ]aloud\b/gi, "read_aloud")
    .replace(/\bspoken mode\b/gi, "spoken-mode")
}

export function prependStartupContext(prompt: string, startupContext: string): string {
  const instructions = buildStartupInstructions(startupContext, prompt)
  return instructions
    ? `${instructions}

--- USER REQUEST ---
${prompt}
--- END USER REQUEST ---`
    : prompt
}

export function buildStartupInstructions(
  startupContext: string,
  prompt: string,
  options: { hotlineEnabled?: boolean } = {},
): string {
  if (!startupContext.trim()) return ""
  const safeStartupContext = neutralizeEmbeddedThreadModeCommands(
    stripInactiveAgentHotlineInstructions(startupContext, prompt, options.hotlineEnabled),
  )
  return safeStartupContext
}
