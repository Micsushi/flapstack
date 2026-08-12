export function serializePromptParts(parts: unknown): string {
  if (!Array.isArray(parts)) return ""
  const textParts: string[] = []
  const fileContents: string[] = []

  for (const part of parts) {
    if (!part || typeof part !== "object") continue
    const value = part as Record<string, unknown>
    if (value.type === "text" && typeof value.text === "string" && value.text) {
      textParts.push(value.text)
    } else if (value.type === "file-content" && typeof value.content === "string") {
      const filePath = typeof value.filePath === "string" ? value.filePath : "file"
      const fileName = filePath.replaceAll("\\", "/").split("/").pop() || filePath
      fileContents.push(`\n--- ${fileName} ---\n${value.content}`)
    }
  }

  return textParts.join("\n") + fileContents.join("")
}
