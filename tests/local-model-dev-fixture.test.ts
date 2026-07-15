import { describe, expect, it } from "vitest"
import {
  createLocalModelDevFixtureCatalog,
  createLocalModelDevFixtureFetch,
  isLocalModelDevFixtureEnabled,
} from "../src/main/lib/harness/local-model-dev-fixture"
import {
  LOCAL_MODEL_DEV_FIXTURE_CHAT_MODEL,
  LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS,
  LOCAL_MODEL_DEV_FIXTURE_TOOLS_MODEL,
} from "../src/shared/local-model-dev-fixture"

describe("local model Dev fixture", () => {
  it("requires an unpackaged renderer-backed Dev profile", () => {
    expect(
      isLocalModelDevFixtureEnabled({ isPackaged: false, rendererUrl: "http://localhost:5173" }),
    ).toBe(true)
    expect(
      isLocalModelDevFixtureEnabled({ isPackaged: true, rendererUrl: "http://localhost" }),
    ).toBe(false)
    expect(isLocalModelDevFixtureEnabled({ isPackaged: false })).toBe(false)
  })

  it("provides deterministic ready, empty, unavailable, error, and stale catalogs", () => {
    const ready = createLocalModelDevFixtureCatalog(LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS.ready)!
    expect(ready).toMatchObject({
      state: "ready",
      provider: { endpoint: LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS.ready },
    })
    expect(ready.models.map((model) => model.identity.modelId)).toEqual([
      LOCAL_MODEL_DEV_FIXTURE_CHAT_MODEL,
      LOCAL_MODEL_DEV_FIXTURE_TOOLS_MODEL,
    ])
    expect(ready.models[0]?.capabilities.tools.state).toBe("unsupported")
    expect(ready.models[1]?.capabilities.tools.state).toBe("supported")

    for (const state of ["empty", "unavailable", "error", "stale"] as const) {
      expect(
        createLocalModelDevFixtureCatalog(LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS[state]),
      ).toMatchObject({
        state,
        limitations: [expect.objectContaining({ code: expect.any(String) })],
      })
    }
    expect(createLocalModelDevFixtureCatalog("http://127.0.0.1:11434")).toBeNull()
  })

  it("streams fixed chunks without echoing prompts or contacting a provider", async () => {
    const fetchImpl = createLocalModelDevFixtureFetch(LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS.ready)!
    const response = await fetchImpl(`${LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS.ready}/api/chat`, {
      method: "POST",
      body: JSON.stringify({
        model: LOCAL_MODEL_DEV_FIXTURE_CHAT_MODEL,
        messages: [{ role: "user", content: "secret prompt" }],
        tools: [],
      }),
    })
    const text = await response.text()
    expect(text).toContain("Flapstack Dev fixture")
    expect(text).not.toContain("secret prompt")
    expect(text.trim().split("\n")).toHaveLength(3)
  })

  it("exposes bounded error, slow-cancel, and tool-gating scenarios", async () => {
    const fetchImpl = createLocalModelDevFixtureFetch(LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS.ready)!
    const error = await fetchImpl(`${LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS.ready}/api/chat`, {
      method: "POST",
      body: request(LOCAL_MODEL_DEV_FIXTURE_CHAT_MODEL, "/fixture error", []),
    })
    expect(error.status).toBe(503)

    const chatOnlyTool = await fetchImpl(`${LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS.ready}/api/chat`, {
      method: "POST",
      body: request(LOCAL_MODEL_DEV_FIXTURE_CHAT_MODEL, "/fixture tool", []),
    })
    expect(await chatOnlyTool.text()).toContain("Chat-only fixture exposed no tools")

    const toolCall = await fetchImpl(`${LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS.ready}/api/chat`, {
      method: "POST",
      body: request(LOCAL_MODEL_DEV_FIXTURE_TOOLS_MODEL, "/fixture tool", [{}]),
    })
    expect(await toolCall.text()).toContain("fixture_unknown_tool")

    const controller = new AbortController()
    const slow = await fetchImpl(`${LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS.ready}/api/chat`, {
      method: "POST",
      body: request(LOCAL_MODEL_DEV_FIXTURE_CHAT_MODEL, "/fixture slow", []),
      signal: controller.signal,
    })
    const reader = slow.body!.getReader()
    await reader.read()
    const next = reader.read()
    controller.abort()
    await expect(next).rejects.toThrow()
  })
})

function request(model: string, prompt: string, tools: unknown[]): string {
  return JSON.stringify({ model, messages: [{ role: "user", content: prompt }], tools })
}
