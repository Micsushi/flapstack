import { describe, expect, it } from "vitest"
import { createChatWorkbenchLayout } from "../src/shared/chat-workbench"
import {
  loadChatWorkbenchLayout,
  persistChatWorkbenchLayout,
} from "../src/renderer/features/agents/workbench/chat-workbench-storage"

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe("Chat workbench storage", () => {
  it("round-trips a versioned layout", () => {
    const storage = new MemoryStorage()
    const layout = createChatWorkbenchLayout(["a", "b"], "b")
    persistChatWorkbenchLayout(storage, "main", layout)
    expect(loadChatWorkbenchLayout(storage, "main", ["legacy"], null)).toEqual(layout)
  })

  it("recovers the backup when the current record is corrupt", () => {
    const storage = new MemoryStorage()
    const first = createChatWorkbenchLayout(["a"])
    const second = createChatWorkbenchLayout(["b"])
    persistChatWorkbenchLayout(storage, "main", first)
    persistChatWorkbenchLayout(storage, "main", second)
    storage.setItem("main:agents:chatWorkbench", "{broken")

    expect(loadChatWorkbenchLayout(storage, "main", [], null)).toEqual(first)
  })

  it("migrates legacy open IDs without deleting them", () => {
    const storage = new MemoryStorage()
    const layout = loadChatWorkbenchLayout(storage, "main", ["a", "b"], "b")
    expect(layout.root).toMatchObject({
      type: "group",
      chatIds: ["a", "b"],
      activeChatId: "b",
    })
    expect(storage.getItem("main:agents:chatWorkbench")).toContain('"version":1')
  })
})
