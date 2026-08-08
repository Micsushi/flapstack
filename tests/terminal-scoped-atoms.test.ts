// @vitest-environment jsdom

import { createStore } from "jotai"
import { describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
})

import {
  terminalsForScopeAtomFamily,
  type TerminalInstance,
} from "../src/renderer/features/terminal/atoms"

describe("terminal scoped subscriptions", () => {
  it("does not notify one terminal pane when another scope changes", () => {
    const store = createStore()
    const first = terminalsForScopeAtomFamily("ws:first")
    const second = terminalsForScopeAtomFamily("ws:second")
    const firstListener = vi.fn()
    const instance: TerminalInstance = {
      id: "second",
      paneId: "second-pane",
      name: "Terminal",
      createdAt: 1,
    }

    const unsubscribe = store.sub(first, firstListener)
    store.set(second, [instance])

    expect(firstListener).not.toHaveBeenCalled()
    expect(store.get(second)).toEqual([instance])
    unsubscribe()
  })
})
