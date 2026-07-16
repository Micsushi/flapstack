const HOTLINE_COMMAND =
  /\b(?:hotline\s+(?:on|off)|read[- ]aloud\s+(?:on|off)|start\s+read[- ]aloud|stop\s+read[- ]aloud|spoken\s+mode\s+(?:on|off)|stop\s+spoken\s+mode|spoken\s+mode)\b/gi

const HOTLINE_ENABLE =
  /\b(?:hotline\s+on|read[- ]aloud\s+on|start\s+read[- ]aloud|spoken\s+mode(?:\s+on)?)\b/i

export function resolveAgentHotlineEnabled(messages: readonly unknown[]): boolean {
  let enabled = false
  for (const message of messages) {
    if (!message || typeof message !== "object") continue
    const record = message as { role?: unknown; parts?: unknown; content?: unknown }
    if (record.role !== "user") continue
    enabled = applyAgentHotlineCommands(enabled, userMessageText(record))
  }
  return enabled
}

export function applyAgentHotlineCommands(current: boolean, text: string): boolean {
  let enabled = current
  for (const match of text.matchAll(HOTLINE_COMMAND)) {
    enabled = HOTLINE_ENABLE.test(match[0]) && !/\b(?:off|stop)\b/i.test(match[0])
  }
  return enabled
}

export function promptEnablesAgentHotline(prompt: string): boolean {
  return applyAgentHotlineCommands(false, prompt)
}

export function stripInactiveAgentHotlineLabels(text: string, hotlineEnabled: boolean): string {
  return hotlineEnabled ? text : text.replace(/^(?:Spoken|Displayed):[ \t]?/gim, "")
}

function userMessageText(message: { parts?: unknown; content?: unknown }): string {
  const parts = Array.isArray(message.parts) ? message.parts : []
  const text = parts
    .map((part) => {
      if (!part || typeof part !== "object") return ""
      const record = part as { type?: unknown; text?: unknown }
      return record.type === "text" && typeof record.text === "string" ? record.text : ""
    })
    .filter(Boolean)
    .join("\n")
  if (text) return text
  return typeof message.content === "string" ? message.content : ""
}
