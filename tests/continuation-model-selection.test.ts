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
  lastSelectedCodexModelIdAtom,
  subChatCodexModelIdAtomFamily,
  subChatCodexReasoningAtomFamily,
} from "../src/renderer/features/agents/atoms"
import { ACPChatTransport } from "../src/renderer/features/agents/lib/acp-chat-transport"

describe("persisted continuation model", () => {
  it("restores the combined model and effort saved by new chat creation", async () => {
    const subChatId = "combined-luna-max"
    appStore.set(initializeSubChatModelAtom, {
      harness: "codex",
      subChatId,
      model: "gpt-5.6-luna/max",
    })
    expect(appStore.get(subChatCodexModelIdAtomFamily(subChatId))).toBe("gpt-5.6-luna")
    expect(appStore.get(subChatCodexReasoningAtomFamily(subChatId))).toBe("max")
    mocks.launch.mockImplementation(
      () =>
        new ReadableStream({
          start(controller) {
            controller.close()
          },
        }),
    )
    const transport = new ACPChatTransport({
      chatId: "combined-chat",
      subChatId,
      cwd: "/owned",
      mode: "write",
      provider: "codex",
    })
    for (let attempt = 0; attempt < 2; attempt++) {
      await transport.sendMessages({
        messages: [
          { id: `send-${attempt}`, role: "user", parts: [{ type: "text", text: "Synthetic" }] },
        ],
      })
      expect(mocks.launch).toHaveBeenLastCalledWith(
        expect.objectContaining({ model: "gpt-5.6-luna", reasoningEffort: "max" }),
      )
    }
    appStore.set(initializeSubChatModelAtom, { harness: "codex", subChatId, model: "gpt-5.5/high" })
    expect(appStore.get(subChatCodexModelIdAtomFamily(subChatId))).toBe("gpt-5.6-luna")
    expect(appStore.get(subChatCodexReasoningAtomFamily(subChatId))).toBe("max")
  })
  it.each(["gpt-5.6-sol", "gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna"])(
    "uses the reviewed %s target on first transport dispatch instead of the global default",
    async (model) => {
      appStore.set(lastSelectedCodexModelIdAtom, "gpt-5.6-sol")
      const subChatId = `reviewed-child-${model}`
      // Reading a default while metadata is pending must not become an explicit edit.
      appStore.set(initializeSubChatModelAtom, { harness: "codex", subChatId, model: undefined })
      expect(appStore.get(subChatCodexModelIdAtomFamily(subChatId))).toBe("gpt-5.6-sol")
      appStore.set(initializeSubChatModelAtom, { harness: "codex", subChatId, model })
      expect(appStore.get(subChatCodexModelIdAtomFamily(subChatId))).toBe(model)
      expect(appStore.get(lastSelectedCodexModelIdAtom)).toBe("gpt-5.6-sol")
      mocks.launch.mockResolvedValue(
        new ReadableStream({
          start(controller) {
            controller.close()
          },
        }),
      )
      await new ACPChatTransport({
        chatId: "child",
        subChatId,
        cwd: "/owned",
        mode: "write",
        provider: "codex",
      }).sendMessages({
        messages: [{ id: "send", role: "user", parts: [{ type: "text", text: "Synthetic" }] }],
      })
      expect(mocks.launch).toHaveBeenLastCalledWith(
        expect.objectContaining({
          chatId: "child",
          subChatId,
          model,
        }),
      )
    },
  )

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

  it("keeps an unavailable explicit model through catalog rejection and account refresh", async () => {
    const subChatId = "unavailable-pinned"
    appStore.set(initializeSubChatModelAtom, {
      harness: "codex",
      subChatId,
      model: "unavailable-model/medium",
    })
    const transport = new ACPChatTransport({
      chatId: "catalog-chat",
      subChatId,
      cwd: "/owned",
      mode: "write",
      provider: "codex",
    })
    const input = {
      messages: [
        { id: "send", role: "user" as const, parts: [{ type: "text" as const, text: "Continue" }] },
      ],
    }
    mocks.launch.mockClear()
    await expect(transport.sendMessages(input)).rejects.toThrow("unavailable-model is unavailable")
    expect(mocks.launch).not.toHaveBeenCalled()
    mocks.models.mockRejectedValueOnce(new Error("Account authentication is refreshing"))
    mocks.launch.mockResolvedValueOnce(new ReadableStream())
    await transport.sendMessages(input)
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "unavailable-model",
        reasoningEffort: "medium",
      }),
    )
    expect(appStore.get(subChatCodexModelIdAtomFamily(subChatId))).toBe("unavailable-model")
  })

  it("leaves model-less conversations on the existing default", () => {
    appStore.set(lastSelectedCodexModelIdAtom, "gpt-5.6-sol")
    appStore.set(initializeSubChatModelAtom, {
      harness: "codex",
      subChatId: "without-model",
      model: null,
    })
    expect(appStore.get(subChatCodexModelIdAtomFamily("without-model"))).toBe("gpt-5.6-sol")
  })

  it("only inherits a parent model from the same harness", () => {
    appStore.set(lastSelectedCodexModelIdAtom, "gpt-5.6-sol")
    appStore.set(initializeSubChatModelAtom, {
      harness: "codex",
      subChatId: "mixed-parent",
      model: null,
      parentHarness: "claude-code",
      parentModel: "claude-opus-4-6",
    })
    expect(appStore.get(subChatCodexModelIdAtomFamily("mixed-parent"))).toBe("gpt-5.6-sol")
    appStore.set(initializeSubChatModelAtom, {
      harness: "codex",
      subChatId: "codex-parent",
      model: null,
      parentHarness: "codex",
      parentModel: "gpt-5.5",
    })
    expect(appStore.get(subChatCodexModelIdAtomFamily("codex-parent"))).toBe("gpt-5.6-sol")
  })
})
