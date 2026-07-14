import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  LOCAL_MODEL_CATALOG_CACHE_VERSION,
  validateLocalModelEndpoint,
  type LocalModelCapabilities,
  type LocalModelCatalogSnapshot,
} from "../src/shared/local-model-contract"
import {
  buildLocalModelControlPreview,
  createLocalModelUiState,
  localModelCatalogStatus,
  reduceLocalModelUiState,
} from "../src/renderer/features/local-models/local-model-ui-state"
import { searchSettings } from "../src/renderer/features/settings/settings-search"

const supportedCapabilities: LocalModelCapabilities = {
  chat: { state: "supported", source: "provider-declared", evidence: "chat" },
  streaming: { state: "supported", source: "provider-contract", evidence: "ollama-api-chat" },
  tools: { state: "supported", source: "provider-declared", evidence: "tools" },
  vision: { state: "unsupported", source: "provider-declared", evidence: "absent" },
}

function catalog(state: LocalModelCatalogSnapshot["state"] = "ready"): LocalModelCatalogSnapshot {
  const limitations =
    state === "empty"
      ? [{ code: "catalog-empty" as const, message: "No installed models." }]
      : state === "stale"
        ? [{ code: "catalog-cache-stale" as const, message: "Display-only cache." }]
        : state === "unavailable"
          ? [{ code: "provider-unavailable" as const, message: "Ollama is unavailable." }]
          : state === "error"
            ? [{ code: "provider-endpoint-error" as const, message: "Endpoint error." }]
            : []
  return {
    schemaVersion: LOCAL_MODEL_CATALOG_CACHE_VERSION,
    provider: {
      harness: "local",
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      version: "0.9.0",
    },
    state,
    capturedAt: "2026-07-14T08:00:00.000Z",
    expiresAt: "2026-07-14T08:05:00.000Z",
    models:
      state === "empty" || state === "unavailable" || state === "error"
        ? []
        : [
            {
              identity: {
                provider: "ollama",
                modelId: "fixture-tools:latest",
                digest: "sha256:fixture",
                modifiedAt: "2026-07-14T07:00:00.000Z",
                family: "fixture",
                parameterSize: "7B",
                quantizationLevel: "Q4",
                contextWindow: 8192,
              },
              capabilities: supportedCapabilities,
              limitations: [
                {
                  code: "vision-unsupported",
                  message: "Ollama did not declare vision support for this model.",
                  modelId: "fixture-tools:latest",
                },
              ],
            },
          ],
    limitations,
  }
}

describe("local model onboarding state", () => {
  it("accepts only uncredentialed loopback HTTP(S) origins", () => {
    expect(validateLocalModelEndpoint("http://localhost:11434")).toEqual({
      valid: true,
      endpoint: "http://localhost:11434",
      message: null,
    })
    expect(validateLocalModelEndpoint("http://[::1]:11434").valid).toBe(true)

    for (const endpoint of [
      "https://ollama.example.com",
      "http://user:secret@localhost:11434",
      "http://localhost:11434/api",
      "http://localhost:11434?remote=true",
      "file:///tmp/ollama.sock",
    ]) {
      expect(validateLocalModelEndpoint(endpoint).valid).toBe(false)
    }
  })

  it("tracks endpoint edits, refresh, and explicit model selection without auto-selecting", () => {
    let state = createLocalModelUiState({ endpoint: "http://127.0.0.1:11434" })
    expect(state.selectedModelId).toBeNull()

    state = reduceLocalModelUiState(state, { type: "refresh-started" })
    expect(state.phase).toBe("refreshing")
    state = reduceLocalModelUiState(state, { type: "refresh-succeeded", catalog: catalog() })
    expect(state.phase).toBe("settled")
    expect(state.selectedModelId).toBeNull()

    state = reduceLocalModelUiState(state, {
      type: "model-selected",
      modelId: "fixture-tools:latest",
    })
    expect(state.selectedModelId).toBe("fixture-tools:latest")

    state = reduceLocalModelUiState(state, {
      type: "endpoint-edited",
      value: "https://remote.example.com",
    })
    expect(state.endpointValidation.valid).toBe(false)
    expect(state.catalog).toBeNull()
  })

  it.each([
    ["empty", "No models"],
    ["stale", "Stale catalog"],
    ["unavailable", "Unavailable"],
    ["error", "Endpoint error"],
  ] as const)("presents the %s catalog state", (catalogState, label) => {
    const state = reduceLocalModelUiState(
      createLocalModelUiState({ endpoint: "http://127.0.0.1:11434" }),
      { type: "refresh-succeeded", catalog: catalog(catalogState) },
    )
    expect(localModelCatalogStatus(state).label).toBe(label)
  })

  it("combines model capability, permission, and delivered runtime truth", () => {
    let state = createLocalModelUiState({
      endpoint: "http://127.0.0.1:11434",
      selectedModelId: "fixture-tools:latest",
    })
    state = reduceLocalModelUiState(state, { type: "refresh-succeeded", catalog: catalog() })

    const preview = buildLocalModelControlPreview({
      state,
      permissionMode: "read-only",
      runtime: { chat: false, toolTiers: [] },
    })

    expect(preview.modelFound).toBe(true)
    expect(preview.canLaunch).toBe(false)
    expect(preview.capabilities?.tools.state).toBe("supported")
    expect(preview.limitations).toContainEqual(
      expect.objectContaining({ code: "vision-unsupported" }),
    )
    expect(preview.toolTiers.find((tier) => tier.tier === "chat")).toMatchObject({
      displayAvailable: false,
      displayReason: "Local chat streaming is not available in this build.",
    })
    expect(preview.toolTiers.find((tier) => tier.tier === "project-write")).toMatchObject({
      displayAvailable: false,
      limitation: expect.objectContaining({ code: "permission-denied" }),
    })
  })

  it("routes Settings search to local endpoint, picker, permissions, and fallback copy", () => {
    for (const [query, targetId] of [
      ["ollama endpoint", "local-model-endpoint"],
      ["local model capability", "local-model-picker"],
      ["local tool preview", "local-model-permission-preview"],
      ["no cloud fallback", "local-model-no-cloud-fallback"],
    ]) {
      expect(searchSettings(query, { showDevelopment: false })[0]).toMatchObject({
        tab: "local-models",
        targetId,
      })
    }
  })

  it("keeps explicit no-cloud and accessibility copy in the production surface", () => {
    const source = readFileSync(
      "src/renderer/components/dialogs/settings-tabs/agents-local-models-tab.tsx",
      "utf8",
    )
    expect(source).toContain("No cloud fallback")
    expect(source).toContain("sends the prompt to a cloud provider as a fallback")
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain('aria-label="Local model tool availability"')

    const pickerSource = readFileSync(
      "src/renderer/features/agents/components/agent-model-selector.tsx",
      "utf8",
    )
    expect(pickerSource).toContain('label: "Local · Ollama"')
    expect(pickerSource).toContain("Chat {item.model.chat} · Tools {item.model.tools}")
    expect(pickerSource).toContain("Local failures never fall back to a cloud provider.")
  })
})
