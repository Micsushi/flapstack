import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, isAbsolute, join } from "node:path"

const MAX_FILE_CHARS = 6000
const MAX_REFERENCED_FILES = 8

type LaunchContextFile = {
  path: string
  content: string
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

function truncateContent(content: string): string {
  if (content.length <= MAX_FILE_CHARS) {
    return content
  }

  return `${content.slice(0, MAX_FILE_CHARS)}\n\n[...truncated by Flapstack launch context...]`
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
): Promise<LaunchContextFile[]> {
  const roots = Array.from(new Set([projectPath, cwd].filter(Boolean) as string[]))
  const candidatePaths: string[] = [
    join(homedir(), ".codex", "AGENTS.md"),
    join(homedir(), ".claude", "CLAUDE.md"),
  ]

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
}): Promise<string> {
  const files = await collectLaunchContextFiles(params.cwd, params.projectPath)
  if (files.length === 0) {
    return ""
  }

  const projectName = basename(params.projectPath || params.cwd)
  const fileList = files.map((file) => `- ${file.path}`).join("\n")
  const sections = files
    .map(
      (file) => `[FILE: ${file.path}]
${file.content}
[/FILE]`,
    )
    .join("\n\n")

  return `[FLAPSTACK STARTUP CONTEXT]
Harness: ${params.harness}
Project: ${projectName}
Working directory: ${params.cwd}

Flapstack loaded these startup files before the user request:
${fileList}

Follow these instructions as active project context. If the user asks what context
or instructions are loaded, name these files and summarize the relevant loaded
context. Do not claim that no context was loaded when this block is present.

${sections}
[/FLAPSTACK STARTUP CONTEXT]`
}

export function prependStartupContext(prompt: string, startupContext: string): string {
  if (!startupContext.trim()) {
    return prompt
  }

  return `${startupContext}

[USER REQUEST]
${prompt}
[/USER REQUEST]`
}
