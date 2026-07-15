import { BrowserWindow } from "electron"
import type { AgentActivityInvalidation } from "../../../shared/agent-activity"
import { getDatabase } from "../db"
import { createAgentActivityStore, type AgentActivityStore } from "./activity-store"

let store: AgentActivityStore | null = null

export function getAgentActivityStore(): AgentActivityStore {
  if (!store) {
    store = createAgentActivityStore(getDatabase(), {
      onInvalidated: broadcastAgentActivityInvalidation,
    })
  }
  return store
}

export function broadcastAgentActivityInvalidation(invalidation: AgentActivityInvalidation): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send("agent-activity:invalidated", invalidation)
  }
}

export function resetAgentActivityStoreForTests(): void {
  store = null
}
