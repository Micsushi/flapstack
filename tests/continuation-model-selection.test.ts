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
  const catalog = [
    "gpt-6.2-sol",
    "gpt-6.2-astra",
    "gpt-6.1-sol",
    "gpt-6-sol",
    "gpt-6-astra",
    "gpt-6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-luna",
  ].map((id) => ({
    id,
    name: id,
    reasoningLevels: id.endsWith("-luna")
      ? ["low", "medium", "high", "xhigh", "max"]
      : ["low", "medium", "high", "xhigh", "max", "ultra"],
  }))
  return { launch: vi.fn(), models: vi.fn(async () => catalog) }
})
vi.mock("../src/renderer/lib/trpc", () => ({
  trpcClient: {
    codex: { listModels: { query: mocks.models } },
    credentials: { status: { query: async () => ({ configured: false }) } },
  },
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
  initializeSubChatModelAtom,
  subChatCodexModelIdAtomFamily,
} from "../src/renderer/features/agents/atoms"

describe("persisted continuation model", () => {
  it("preserves explicit child edits across metadata refresh, Runtime change and reopening", () => {
    const subChatId = "edited-child"
    appStore.set(initializeSubChatModelAtom, { harness: "codex", subChatId, model: "gpt-5.5" })
    appStore.set(subChatCodexModelIdAtomFamily(subChatId), "gpt-5.6-sol")
    appStore.set(initializeSubChatModelAtom, { harness: "codex", subChatId, model: "gpt-5.5" })
    expect(appStore.get(subChatCodexModelIdAtomFamily(subChatId))).toBe("gpt-5.6-sol")
    expect(JSON.parse(localStorage.getItem("agents:subChatCodexModelIds")!)[subChatId]).toBe(
      "gpt-5.6-sol",
    )
  })
})
