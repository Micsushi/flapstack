// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
  return { launch: vi.fn() }
})
vi.mock("../src/renderer/lib/trpc", () => ({
  trpcClient: { credentials: { status: { query: async () => ({ configured: false }) } } },
}))
vi.mock("../src/renderer/features/agents/lib/direct-runtime-chat-transport", () => ({
  createDirectRuntimeStream: mocks.launch,
  splitCodexRuntimeModel: (value: string) => {
    const [model, effort] = value.split("/")
    return { model, effort }
  },
}))
vi.mock("../src/renderer/features/agents/stores/sub-chat-store", () => ({
  getAgentSubChatStore: () => ({ getState: () => ({ allSubChats: [] }) }),
}))
vi.mock("../src/renderer/features/project-vault/pending-graph-context", () => ({
  readProjectVaultGraphSelection: () => undefined,
  clearProjectVaultGraphSelection: () => {},
}))

import { appStore } from "../src/renderer/lib/jotai-store"
import {
  initializeSubChatCodexModelAtom,
  lastSelectedCodexModelIdAtom,
  subChatCodexModelIdAtomFamily,
} from "../src/renderer/features/agents/atoms"
import { ACPChatTransport } from "../src/renderer/features/agents/lib/acp-chat-transport"

describe("persisted continuation model", () => {
  it("uses the reviewed target on first transport dispatch instead of the global default", async () => {
    appStore.set(lastSelectedCodexModelIdAtom, "gpt-5.6-sol")
    const subChatId = "reviewed-child"
    // Reading a default while metadata is pending must not become an explicit edit.
    appStore.set(initializeSubChatCodexModelAtom, { subChatId, model: undefined })
    expect(appStore.get(subChatCodexModelIdAtomFamily(subChatId))).toBe("gpt-5.6-sol")
    appStore.set(initializeSubChatCodexModelAtom, { subChatId, model: "gpt-5.5" })
    expect(appStore.get(subChatCodexModelIdAtomFamily(subChatId))).toBe("gpt-5.5")
    expect(appStore.get(lastSelectedCodexModelIdAtom)).toBe("gpt-5.6-sol")
    mocks.launch.mockResolvedValue(new ReadableStream({ start(controller) { controller.close() } }))
    await new ACPChatTransport({
      chatId: "child", subChatId, cwd: "/owned", mode: "write", provider: "codex",
    }).sendMessages({ messages: [{ id: "send", role: "user", parts: [{ type: "text", text: "Synthetic" }] }] })
    expect(mocks.launch).toHaveBeenLastCalledWith(expect.objectContaining({
      chatId: "child", subChatId, model: "gpt-5.5",
    }))
  })

  it("preserves explicit child edits across metadata refresh, Runtime change and reopening", () => {
    const subChatId = "edited-child"
    appStore.set(initializeSubChatCodexModelAtom, { subChatId, model: "gpt-5.5" })
    appStore.set(subChatCodexModelIdAtomFamily(subChatId), "gpt-5.6-sol")
    appStore.set(initializeSubChatCodexModelAtom, { subChatId, model: "gpt-5.5" })
    expect(appStore.get(subChatCodexModelIdAtomFamily(subChatId))).toBe("gpt-5.6-sol")
    expect(JSON.parse(localStorage.getItem("agents:subChatCodexModelIds")!)[subChatId]).toBe("gpt-5.6-sol")
  })

  it("leaves model-less conversations on the existing default", () => {
    appStore.set(lastSelectedCodexModelIdAtom, "gpt-5.6-sol")
    appStore.set(initializeSubChatCodexModelAtom, { subChatId: "without-model", model: null })
    expect(appStore.get(subChatCodexModelIdAtomFamily("without-model"))).toBe("gpt-5.6-sol")
  })

  it("only inherits a parent model from the same harness", () => {
    appStore.set(lastSelectedCodexModelIdAtom, "gpt-5.6-sol")
    appStore.set(initializeSubChatCodexModelAtom, {
      subChatId: "mixed-parent", model: null,
      parentHarness: "claude-code", parentModel: "claude-opus-4-6",
    })
    expect(appStore.get(subChatCodexModelIdAtomFamily("mixed-parent"))).toBe("gpt-5.6-sol")
    appStore.set(initializeSubChatCodexModelAtom, {
      subChatId: "codex-parent", model: null,
      parentHarness: "codex", parentModel: "gpt-5.5",
    })
    expect(appStore.get(subChatCodexModelIdAtomFamily("codex-parent"))).toBe("gpt-5.5")
  })
})
