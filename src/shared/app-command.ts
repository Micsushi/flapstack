export const APP_COMMAND_CHANNEL = "app:command"

export const APP_COMMANDS = [
  "history-undo",
  "history-redo",
  "navigate-back",
  "navigate-forward",
] as const

export type AppCommand = (typeof APP_COMMANDS)[number]

export function parseAppCommand(value: unknown): AppCommand | null {
  return typeof value === "string" && (APP_COMMANDS as readonly string[]).includes(value)
    ? (value as AppCommand)
    : null
}
