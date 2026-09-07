/** Legacy rows do not distinguish an intentional placeholder name from a default. */
export function isUntitledChatName(name: string | null | undefined): boolean {
  return !name?.trim() || name.trim().toLowerCase() === "new chat"
}

export function initialChatName(message: string, generateTitle: boolean): string {
  return generateTitle ? "New Chat" : message.trim().slice(0, 50)
}
