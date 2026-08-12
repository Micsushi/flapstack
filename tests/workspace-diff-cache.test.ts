// @vitest-environment jsdom
import { createStore } from "jotai"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let originalLocalStorageDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  })
})

afterEach(() => {
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, "localStorage")
  }
})

describe("workspace diff cache", () => {
  it("retains only the four most recently updated workspaces", async () => {
    const { workspaceDiffCacheAtomFamily } = await import("../src/renderer/features/agents/atoms")
    const store = createStore()

    for (let index = 0; index < 6; index += 1) {
      store.set(workspaceDiffCacheAtomFamily(`chat-${index}`), (current) => ({
        ...current,
        diffContent: `diff-${index}`,
      }))
    }

    expect(store.get(workspaceDiffCacheAtomFamily("chat-0")).diffContent).toBeNull()
    expect(store.get(workspaceDiffCacheAtomFamily("chat-1")).diffContent).toBeNull()
    expect(store.get(workspaceDiffCacheAtomFamily("chat-2")).diffContent).toBe("diff-2")
    expect(store.get(workspaceDiffCacheAtomFamily("chat-5")).diffContent).toBe("diff-5")
  })
})
