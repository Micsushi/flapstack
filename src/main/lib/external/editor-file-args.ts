export type EditorCommand = "cursor" | "code" | "subl" | "atom" | "open"

export function editorCommandsForPlatform(platform: NodeJS.Platform): EditorCommand[] {
  const editors: EditorCommand[] = ["cursor", "code", "subl", "atom"]
  return platform === "darwin" ? [...editors, "open"] : editors
}

export function editorLookupCommand(
  platform: NodeJS.Platform,
  editor: EditorCommand,
): { command: string; args: string[] } {
  return platform === "win32"
    ? { command: "where.exe", args: [editor] }
    : { command: "which", args: [editor] }
}

/** Build editor-specific arguments for a file link with an optional source location. */
export function editorFileArgs(
  editor: EditorCommand,
  filePath: string,
  line?: number,
  column?: number,
): string[] {
  if (!line || editor === "open") {
    return editor === "open" ? ["-t", filePath] : [filePath]
  }
  const target = `${filePath}:${line}:${column ?? 1}`
  return editor === "cursor" || editor === "code" ? ["--goto", target] : [target]
}
