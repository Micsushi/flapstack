import { describe, expect, it } from "vitest"
import {
  fallbackToCachedLocalModelCatalog,
  getOllamaEndpointConfig,
  probeLocalModelCatalog,
  readLocalModelCatalogCache,
} from "../src/main/lib/harness/local-model-catalog"
import { AGENT_HARNESSES, type RunInput } from "../src/shared/harness-types"
import {
  LOCAL_MODEL_FALLBACK_POLICY,
  createLocalModelRunMetadata,
  resolveLocalModelSelection,
  resolveLocalModelToolTiers,
} from "../src/shared/local-model-contract"
import { disabledCustomPermissions } from "../src/shared/permission-capabilities"

const NOW = Date.parse("2026-07-14T12:00:00.000Z")

describe("local model catalog contract", () => {
  it("promotes local to a typed run harness with Ollama-first loopback identity", async () => {
    const input: RunInput = {
      chatId: "chat-1",
      subChatId: "sub-chat-1",
      prompt: "hello",
      harness: "local",
      model: "fixture:latest",
      permissionMode: "read-only",
    }
    const config = getOllamaEndpointConfig()
    const catalog = await probeLocalModelCatalog({
      config,
      fetchImpl: fixtureFetch({ models: [] }),
      now: () => NOW,
    })

    expect(AGENT_HARNESSES).toContain(input.harness)
    expect(config).toMatchObject({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      allowRemote: false,
    })
    expect(catalog.provider).toEqual({
      harness: "local",
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      version: "0.9.1",
    })
    expect(() => getOllamaEndpointConfig({ baseUrl: "https://ollama.example.com" })).toThrow(
      /loopback/i,
    )
  })

  it("normalizes declared model capabilities without guessing from model names", async () => {
    const catalog = await probeLocalModelCatalog({
      fetchImpl: fixtureFetch({
        models: [
          tag("vision-tool-coder:latest", "digest-chat"),
          tag("plain:latest", "digest-tools"),
        ],
        shows: {
          "vision-tool-coder:latest": {
            capabilities: ["completion"],
            details: { family: "fixture", parameter_size: "7B", quantization_level: "Q4_K_M" },
            model_info: { "fixture.context_length": 8192 },
          },
          "plain:latest": { capabilities: ["completion", "tools", "vision"] },
        },
      }),
      now: () => NOW,
    })

    expect(catalog.state).toBe("ready")
    expect(catalog.provider.version).toBe("0.9.1")
    const namedLikeCapabilities = catalog.models.find(
      ({ identity }) => identity.modelId === "vision-tool-coder:latest",
    )!
    expect(namedLikeCapabilities.capabilities).toMatchObject({
      chat: { state: "supported", source: "provider-declared", evidence: "completion" },
      streaming: { state: "supported", source: "provider-contract" },
      tools: { state: "unsupported", source: "provider-declared", evidence: "absent" },
      vision: { state: "unsupported", source: "provider-declared", evidence: "absent" },
    })
    expect(namedLikeCapabilities.identity).toMatchObject({
      provider: "ollama",
      digest: "digest-chat",
      family: "fixture",
      parameterSize: "7B",
      quantizationLevel: "Q4_K_M",
      contextWindow: 8192,
    })
    expect(namedLikeCapabilities.limitations.map(({ code }) => code)).toEqual([
      "tools-unsupported",
      "vision-unsupported",
    ])

    const declaredTools = catalog.models.find(
      ({ identity }) => identity.modelId === "plain:latest",
    )!
    expect(declaredTools.capabilities.tools.state).toBe("supported")
    expect(declaredTools.capabilities.vision.state).toBe("supported")
  })

  it("returns typed missing, empty, endpoint, and model-metadata states", async () => {
    const missing = await probeLocalModelCatalog({
      fetchImpl: async () => {
        throw new TypeError("connection refused at a secret endpoint")
      },
      now: () => NOW,
    })
    expect(missing).toMatchObject({
      state: "unavailable",
      limitations: [{ code: "provider-unavailable" }],
    })
    expect(JSON.stringify(missing)).not.toContain("secret endpoint")

    const empty = await probeLocalModelCatalog({
      fetchImpl: fixtureFetch({ models: [] }),
      now: () => NOW,
    })
    expect(empty).toMatchObject({ state: "empty", limitations: [{ code: "catalog-empty" }] })

    const endpointError = await probeLocalModelCatalog({
      fetchImpl: async () => jsonResponse({ error: "down" }, 503),
      now: () => NOW,
    })
    expect(endpointError).toMatchObject({
      state: "error",
      limitations: [{ code: "provider-endpoint-error", status: 503 }],
    })

    const metadataError = await probeLocalModelCatalog({
      fetchImpl: fixtureFetch({
        models: [tag("broken:latest", "broken-digest")],
        showStatus: 500,
      }),
      now: () => NOW,
    })
    expect(metadataError.models[0]).toMatchObject({
      capabilities: {
        chat: { state: "unknown" },
        streaming: { state: "unknown" },
        tools: { state: "unknown" },
        vision: { state: "unknown" },
      },
      limitations: [{ code: "model-metadata-unavailable", modelId: "broken:latest" }],
    })
  })

  it("versions the capability cache and marks stale data display-only", async () => {
    const fresh = await probeLocalModelCatalog({
      fetchImpl: fixtureFetch({
        models: [tag("fixture:latest", "digest")],
        shows: { "fixture:latest": { capabilities: ["completion"] } },
      }),
      now: () => NOW,
    })
    expect(readLocalModelCatalogCache(fresh, NOW)).toMatchObject({ state: "fresh" })

    const stale = readLocalModelCatalogCache(fresh, Date.parse(fresh.expiresAt) + 1)
    expect(stale).toMatchObject({
      state: "stale",
      snapshot: { state: "stale", limitations: [{ code: "catalog-cache-stale" }] },
    })
    expect(readLocalModelCatalogCache({ ...fresh, schemaVersion: 999 }, NOW)).toEqual({
      state: "incompatible",
      snapshot: null,
    })

    const unavailable = await probeLocalModelCatalog({
      fetchImpl: async () => {
        throw new TypeError("offline")
      },
      now: () => NOW,
    })
    const fallback = fallbackToCachedLocalModelCatalog(unavailable, stale)
    expect(fallback.state).toBe("stale")
    expect(fallback.models).toHaveLength(1)
    expect(resolveLocalModelSelection(fallback, "fixture:latest")).toMatchObject({
      state: "catalog-stale",
      runnable: false,
      fallback: LOCAL_MODEL_FALLBACK_POLICY,
    })

    const otherEndpoint = {
      ...unavailable,
      provider: { ...unavailable.provider, endpoint: "http://localhost:11435" },
    }
    expect(fallbackToCachedLocalModelCatalog(otherEndpoint, stale)).toBe(otherEndpoint)
  })

  it("declares fail-closed tool tiers and durable run metadata against Stage 3 run fields", async () => {
    const catalog = await probeLocalModelCatalog({
      fetchImpl: fixtureFetch({
        models: [tag("tool-model:latest", "digest")],
        shows: { "tool-model:latest": { capabilities: ["completion", "tools"] } },
      }),
      now: () => NOW,
    })
    const model = catalog.models[0]!
    const readOnlyTiers = resolveLocalModelToolTiers(
      model.capabilities,
      "read-only",
      disabledCustomPermissions,
    )
    expect(readOnlyTiers.filter(({ available }) => available).map(({ tier }) => tier)).toEqual([
      "chat",
      "read",
    ])
    expect(readOnlyTiers.find(({ tier }) => tier === "project-write")).toMatchObject({
      available: false,
      limitation: { code: "permission-denied" },
    })

    expect(
      resolveLocalModelToolTiers(model.capabilities, "ask-before-edits")
        .filter(({ available }) => available)
        .map(({ tier }) => tier),
    ).toEqual(["chat", "read", "project-write", "shell", "git", "network"])

    const customTiers = resolveLocalModelToolTiers(model.capabilities, "custom", {
      ...disabledCustomPermissions,
      projectWrite: true,
      git: true,
    })
    expect(customTiers.filter(({ available }) => available).map(({ tier }) => tier)).toEqual([
      "chat",
      "read",
      "project-write",
      "git",
    ])

    const metadata = createLocalModelRunMetadata({
      catalog,
      model,
      permissionMode: "read-only",
    })
    expect(metadata).toMatchObject({
      harness: "local",
      provider: { provider: "ollama" },
      permission: { mode: "read-only" },
      fallback: { cloudAllowed: false },
    })
  })
})

type Fixture = {
  models: Array<Record<string, unknown>>
  version?: string
  shows?: Record<string, Record<string, unknown>>
  showStatus?: number
}

function fixtureFetch(fixture: Fixture): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === "/api/tags") return jsonResponse({ models: fixture.models })
    if (url.pathname === "/api/version") {
      return jsonResponse({ version: fixture.version ?? "0.9.1" })
    }
    if (url.pathname === "/api/show") {
      if (fixture.showStatus) return jsonResponse({ error: "show failed" }, fixture.showStatus)
      const body = JSON.parse(String(init?.body)) as { model: string }
      return jsonResponse(fixture.shows?.[body.model] ?? {})
    }
    return jsonResponse({ error: "not found" }, 404)
  }
}

function tag(name: string, digest: string): Record<string, unknown> {
  return {
    name,
    digest,
    modified_at: "2026-07-14T11:00:00.000Z",
    details: { family: "fixture", parameter_size: "3B", quantization_level: "Q4" },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}
