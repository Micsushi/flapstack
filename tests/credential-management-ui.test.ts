// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  setCredential: vi.fn(),
  removeCredential: vi.fn(),
  removeCodexApiKey: vi.fn(),
  setVoiceKey: vi.fn(),
  invalidate: vi.fn(async () => undefined),
}))

vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      credentials: { listStatuses: { invalidate: mocks.invalidate } },
      codex: { getIntegration: { invalidate: mocks.invalidate } },
      voice: { hasOpenAIKey: { invalidate: mocks.invalidate } },
      speech: { listAdapters: { invalidate: mocks.invalidate } },
    }),
    credentials: {
      listStatuses: {
        useQuery: () => ({
          data: [
            {
              id: "codex.api-key",
              configured: true,
              persistence: "encrypted",
              source: "encrypted-store",
              fingerprint: "123456789abc",
              updatedAt: 1234,
              encryptionBackend: "test-keychain",
            },
            {
              id: "openai.voice-api-key",
              configured: true,
              persistence: "session",
              source: "session-memory",
              fingerprint: "abcdef123456",
              updatedAt: 2345,
              encryptionBackend: null,
              warning: "Secure persistence unavailable",
            },
            {
              id: "claude.custom-api-token",
              configured: false,
              persistence: null,
              source: null,
              fingerprint: null,
              updatedAt: null,
              encryptionBackend: null,
            },
          ],
        }),
      },
      set: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.setCredential }),
      },
      remove: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.removeCredential }),
      },
    },
    codex: {
      removeApiKey: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.removeCodexApiKey }),
      },
    },
    voice: {
      hasOpenAIKey: { useQuery: () => ({ data: { hasKey: true } }) },
      setOpenAIKey: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.setVoiceKey }),
      },
    },
  },
}))

import { CredentialManagement } from "../src/renderer/components/dialogs/settings-tabs/credential-management"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("secure credential management UI", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(async () => {
    vi.clearAllMocks()
    sessionStorage.clear()
    mocks.setCredential.mockResolvedValue({
      persistence: "encrypted",
      source: "encrypted-store",
    })
    mocks.removeCredential.mockResolvedValue({ configured: false })
    mocks.removeCodexApiKey.mockResolvedValue({ configured: false })
    mocks.setVoiceKey.mockResolvedValue({
      status: { persistence: "encrypted", source: "encrypted-store" },
    })
    vi.spyOn(window, "confirm").mockReturnValue(true)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(createElement(CredentialManagement)))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it("shows status metadata but never fills a stored secret", () => {
    const codexSecret = container.querySelector<HTMLInputElement>(
      "#credential-codex-api-key-secret",
    )
    expect(codexSecret?.value).toBe("")
    expect(container.textContent).toContain("Fingerprint 123456789abc")
    expect(container.textContent).toContain("OS encryption backend: test-keychain")
    expect(container.textContent).toContain("Session only")
    expect(container.textContent).toContain("disappears when this app process exits")
  })

  it("confirms replacement and clears the write-only field after saving", async () => {
    const input = container.querySelector<HTMLInputElement>("#credential-codex-api-key-secret")!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "sk-disposable",
      )
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const row = container.querySelector("#credential-codex-api-key")!
    const replace = Array.from(row.querySelectorAll("button")).find(
      (button) => button.textContent === "Replace",
    )!
    await act(async () => replace.click())

    expect(window.confirm).toHaveBeenCalledWith(
      "Replace the Codex API key? The prior value cannot be recovered.",
    )
    expect(mocks.setCredential).toHaveBeenCalledWith({
      id: "codex.api-key",
      secret: "sk-disposable",
      metadata: undefined,
    })
    expect(input.value).toBe("")
  })

  it("keeps the disposable value in the write-only field when saving fails", async () => {
    mocks.setCredential.mockRejectedValueOnce(new Error("fixture persistence failure"))
    const input = container.querySelector<HTMLInputElement>("#credential-codex-api-key-secret")!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "sk-disposable-failure",
      )
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const row = container.querySelector("#credential-codex-api-key")!
    const replace = Array.from(row.querySelectorAll("button")).find(
      (button) => button.textContent === "Replace",
    )!
    await act(async () => replace.click())

    expect(input.value).toBe("sk-disposable-failure")
  })

  it("uses the Codex-specific removal path so ChatGPT auth is preserved", async () => {
    const row = container.querySelector("#credential-codex-api-key")!
    const remove = Array.from(row.querySelectorAll("button")).find(
      (button) => button.textContent === "Remove",
    )!
    await act(async () => remove.click())

    expect(window.confirm).toHaveBeenCalledWith(
      "Remove the Codex API key? Runs that require it will stop working.",
    )
    expect(mocks.removeCodexApiKey).toHaveBeenCalledOnce()
    expect(mocks.removeCredential).not.toHaveBeenCalled()
  })
})
