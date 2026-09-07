export const MAX_TERMINAL_COLS = 500
export const MAX_TERMINAL_ROWS = 200

export type TerminalReplayPayload =
  | { type: "snapshot"; data: string; cols: number; rows: number }
  | { type: "data"; data: string }
  | { type: "exit"; exitCode: number; signal?: number }

export type TerminalReplayEvent = TerminalReplayPayload & {
  subscriptionId: string
  deliveryId: number
}
