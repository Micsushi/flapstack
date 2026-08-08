import { atomWithStorage } from "jotai/utils"

export type DiffViewMode = "unified" | "split"

export type ParsedDiffFile = {
  key: string
  oldPath: string
  newPath: string
  diffText: string
  isBinary: boolean
  additions: number
  deletions: number
  isValid?: boolean
  fileLang?: string | null
  isNewFile?: boolean
  isDeletedFile?: boolean
}

export const diffViewModeAtom = atomWithStorage<DiffViewMode>("agents-diff:view-mode-v2", "unified")

function validateDiffHunk(diffText: string): boolean {
  if (!diffText.trim()) return false
  const lines = diffText.split("\n")
  const minusLine = lines.findIndex((line) => line.startsWith("--- "))
  const plusLine = lines.findIndex((line) => line.startsWith("+++ "))
  if (minusLine < 0 || plusLine <= minusLine) return false
  if (/(?:new mode|old mode|rename from|rename to|Binary files)/.test(diffText)) {
    return true
  }
  return lines.slice(plusLine + 1).some((line) => /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line))
}

export function splitUnifiedDiffByFile(diffText: string): ParsedDiffFile[] {
  const blocks: string[] = []
  let current: string[] = []
  const pushCurrent = () => {
    const text = current.join("\n").trim()
    if (
      text &&
      (text.startsWith("diff --git ") ||
        text.startsWith("--- ") ||
        text.startsWith("+++ ") ||
        text.startsWith("Binary files ") ||
        text.includes("\n+++ ") ||
        text.includes("\nBinary files "))
    ) {
      blocks.push(text)
    }
    current = []
  }

  for (const line of diffText.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ") && current.length > 0) pushCurrent()
    current.push(line)
  }
  pushCurrent()

  return blocks.map((blockText, index) => {
    let oldPath = ""
    let newPath = ""
    let isBinary = false
    let additions = 0
    let deletions = 0
    for (const line of blockText.split("\n")) {
      if (line.startsWith("diff --git ")) {
        const match = line.match(/^diff --git a\/(.+) b\/(.+)$/)
        if (match) [oldPath, newPath] = [oldPath || match[1]!, newPath || match[2]!]
      } else if (line.startsWith("Binary files ") && line.endsWith(" differ")) {
        isBinary = true
      } else if (line.startsWith("--- ")) {
        const raw = line.slice(4).trim()
        oldPath = raw.startsWith("a/") ? raw.slice(2) : raw
      } else if (line.startsWith("+++ ")) {
        const raw = line.slice(4).trim()
        newPath = raw.startsWith("b/") ? raw.slice(2) : raw
      }
      if (line.startsWith("+") && !line.startsWith("+++ ")) additions += 1
      else if (line.startsWith("-") && !line.startsWith("--- ")) deletions += 1
    }
    return {
      key: oldPath || newPath ? `${oldPath}->${newPath}` : `file-${index}`,
      oldPath,
      newPath,
      diffText: blockText,
      isBinary,
      additions,
      deletions,
      isValid: isBinary || validateDiffHunk(blockText),
    }
  })
}
