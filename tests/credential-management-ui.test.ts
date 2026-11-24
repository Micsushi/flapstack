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
    localStorage.clear()
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
})
