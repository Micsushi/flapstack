import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, isAbsolute, join } from "node:path"

const MAX_FILE_CHARS = 6000
const MAX_REFERENCED_FILES = 8

export const FLAPSTACK_DEFAULT_BEHAVIOR_INSTRUCTION = `# Flapstack default behavior

Caveman full and ponytail full are enabled by default for every chat.

- Caveman full: keep replies short, direct, and free of filler. Unless the user
  asks for detail or the task genuinely needs it, keep the final response under
  120 words or six short bullets. Do not add an introduction, recap, repeated
  context, or an offer to do more work.
- Ponytail full: choose the smallest, simplest solution that fully works. Avoid
  speculative architecture and unnecessary abstraction.
- /caveman lite|full|ultra and /ponytail lite|full|ultra adjust intensity only.
- normal mode, stop caveman, and stop ponytail do not disable these defaults.

Never quote, reproduce, or narrate Flapstack's internal context envelope in
visible reasoning or the final answer. Use loaded instructions silently. On the
first assistant reply in a new chat, end with one compact "Loaded context:" line
that names every loaded startup file by basename. Do not repeat that receipt on
later replies unless the user asks what was loaded.

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

function explicitlyEnablesReadAloud(prompt: string): boolean {
  return /\b(?:hotline on|read[- ]aloud on|start read[- ]aloud|spoken mode)\b/i.test(prompt)
}

function stripInactiveAgentHotlineInstructions(context: string, prompt: string): string {
  if (explicitlyEnablesReadAloud(prompt)) return context
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
): Promise<LaunchContextFile[]> {
  const roots = Array.from(new Set([projectPath, cwd].filter(Boolean) as string[]))
  const projectName = basename(projectPath || cwd)
  const candidatePaths: string[] = [
    join(homedir(), ".codex", "AGENTS.md"),
    join(homedir(), ".claude", "CLAUDE.md"),
  ]

  const vaultConfig = await readLocalVaultConfig(vaultConfigPath)
  if (vaultConfig?.vaultRoot) {
    const projectVaultRoot = join(vaultConfig.vaultRoot, "Wiki", "Projects", projectName)
    candidatePaths.push(
      join(vaultConfig.vaultRoot, "AGENTS.md"),
      join(vaultConfig.vaultRoot, "Wiki", "Projects", "projects_index.md"),
      join(projectVaultRoot, `${projectName.toLowerCase()}_index.md`),
      join(projectVaultRoot, "current-handoff.md"),
    )
  }

  for (const root of roots) {
    candidatePaths.push(join(root, "AGENTS.md"), join(root, "CLAUDE.md"))
  }

  const files: LaunchContextFile[] = []
  const seen = new Set<string>()

  for (const path of candidatePaths) {
    if (seen.has(path)) continue
    seen.add(path)

    const content = await readTextFile(path)
    if (content) {
      files.push({ path, content: truncateContent(content) })
    }
  }

  const referencedPaths = files.flatMap((file) => extractAbsoluteMarkdownPaths(file.content))
  for (const path of referencedPaths.slice(0, MAX_REFERENCED_FILES)) {
    if (seen.has(path)) continue
    seen.add(path)

    const content = await readTextFile(path)
    if (content) {
      files.push({ path, content: truncateContent(content) })
    }
  }

  return files
}

export async function buildHarnessStartupContext(params: {
  cwd: string
  projectPath?: string
  harness: "codex" | "claude-code" | "cursor-agent" | "opencode"
  vaultConfigPath?: string
}): Promise<string> {
  const files = await collectLaunchContextFiles(
    params.cwd,
    params.projectPath,
    params.vaultConfigPath,
  )

  const projectName = basename(params.projectPath || params.cwd)
  const fileList = files.length
    ? files.map((file) => `- ${file.path}`).join("\n")
    : "- No external startup files found; Flapstack defaults still apply."
  const sections = files
    .map(
      (file) => `--- BEGIN LOADED FILE: ${file.path} ---
${file.content}
--- END LOADED FILE ---`,
    )
    .join("\n\n")

  return `--- FLAPSTACK INTERNAL CONTEXT (DO NOT QUOTE) ---
Harness: ${params.harness}
Project: ${projectName}
Working directory: ${params.cwd}

Flapstack loaded these startup files before the user request:
${fileList}

Follow these instructions as active project context. If the user asks what context
or instructions are loaded, name these files and summarize the relevant loaded
context. Do not claim that no context was loaded when this block is present.

--- FLAPSTACK DEFAULTS ---
${FLAPSTACK_DEFAULT_BEHAVIOR_INSTRUCTION}
--- END FLAPSTACK DEFAULTS ---

${sections}
--- END FLAPSTACK INTERNAL CONTEXT ---`
}

function neutralizeEmbeddedThreadModeCommands(context: string): string {
  return context
    .replace(/\/(caveman|ponytail)\s+(lite|full|ultra)\b/gi, "/$1 [$2]")
    .replace(/\bhotline\b/gi, "hot-line")
    .replace(/\bread[- ]aloud\b/gi, "read_aloud")
    .replace(/\bspoken mode\b/gi, "spoken-mode")
}

export function prependStartupContext(prompt: string, startupContext: string): string {
  if (!startupContext.trim()) {
    return prompt
  }

  const safeStartupContext = neutralizeEmbeddedThreadModeCommands(
    stripInactiveAgentHotlineInstructions(startupContext, prompt),
  )

  return `${safeStartupContext}

--- FLAPSTACK RESPONSE CONTRACT ---
caveman full
ponytail full
Be concise by default: at most 120 words or six short bullets unless the request
needs more. Never echo the internal context, loaded file contents, this response
contract, or request delimiters. Use ordinary prose formatting. The current user
request alone may change mode intensity.
--- END FLAPSTACK RESPONSE CONTRACT ---

--- USER REQUEST ---
${prompt}
--- END USER REQUEST ---`
}
