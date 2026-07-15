import {
  LOCAL_MODEL_CATALOG_CACHE_VERSION,
  type LocalModelCapabilities,
  type LocalModelCatalogEntry,
  type LocalModelCatalogSnapshot,
  type LocalModelLimitation,
} from "../../../shared/local-model-contract"
import {
  LOCAL_MODEL_DEV_FIXTURE_CHAT_MODEL,
  LOCAL_MODEL_DEV_FIXTURE_TOOLS_MODEL,
  LOCAL_MODEL_DEV_FIXTURE_VERSION,
  localModelDevFixtureStateForEndpoint,
  type LocalModelDevFixtureState,
} from "../../../shared/local-model-dev-fixture"

const FIXTURE_CAPTURED_AT = "2026-07-15T00:00:00.000Z"
const FIXTURE_EXPIRES_AT = "2099-01-01T00:00:00.000Z"

export function isLocalModelDevFixtureEnabled(input: {
  isPackaged: boolean
  rendererUrl?: string
}): boolean {
  return !input.isPackaged && Boolean(input.rendererUrl?.trim())
}

export function createLocalModelDevFixtureCatalog(
  endpoint: string,
): LocalModelCatalogSnapshot | null {
  const state = localModelDevFixtureStateForEndpoint(endpoint)
  if (!state) return null

  const limitations = fixtureLimitations(state)
  return {
    schemaVersion: LOCAL_MODEL_CATALOG_CACHE_VERSION,
    provider: {
      harness: "local",
      provider: "ollama",
      endpoint,
      version: state === "unavailable" ? null : LOCAL_MODEL_DEV_FIXTURE_VERSION,
    },
    state,
    capturedAt: FIXTURE_CAPTURED_AT,
    expiresAt: state === "stale" ? FIXTURE_CAPTURED_AT : FIXTURE_EXPIRES_AT,
    models: state === "ready" || state === "stale" ? fixtureModels() : [],
    limitations,
  }
}

export function createLocalModelDevFixtureFetch(endpoint: string): typeof fetch | null {
  if (localModelDevFixtureStateForEndpoint(endpoint) !== "ready") return null

  return async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    )
    if (url.origin !== endpoint || url.pathname !== "/api/chat") {
      return new Response(JSON.stringify({ error: "fixture route unavailable" }), { status: 404 })
    }

    const request = parseRequest(init?.body)
    if (!request) return new Response("", { status: 400 })
    const prompt = latestUserPrompt(request.messages)
    if (prompt.includes("/fixture error")) return new Response("", { status: 503 })

    const hasToolResult = request.messages.some((message) => message.role === "tool")
    const canCallTools =
      request.model === LOCAL_MODEL_DEV_FIXTURE_TOOLS_MODEL && request.tools.length > 0
    if (prompt.includes("/fixture tool") && canCallTools && !hasToolResult) {
      return streamResponse(
        [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "fixture-tool-call-1",
                  function: { name: "fixture_unknown_tool", arguments: {} },
                },
              ],
            },
            done: false,
          },
          { done: true, prompt_eval_count: 2, eval_count: 1 },
        ],
        init?.signal,
      )
    }

    const slow = prompt.includes("/fixture slow")
    const toolStatus = prompt.includes("/fixture tool")
      ? canCallTools
        ? " Tool-capable fixture call was denied safely."
        : " Chat-only fixture exposed no tools."
      : ""
    return streamResponse(
      [
        { message: { content: "Flapstack Dev fixture " }, done: false },
        { message: { content: `stream completed.${toolStatus}` }, done: false },
        { done: true, prompt_eval_count: 4, eval_count: 6 },
      ],
      init?.signal,
      slow ? 250 : 0,
    )
  }
}

function fixtureModels(): LocalModelCatalogEntry[] {
  return [
    fixtureModel(LOCAL_MODEL_DEV_FIXTURE_CHAT_MODEL, false),
    fixtureModel(LOCAL_MODEL_DEV_FIXTURE_TOOLS_MODEL, true),
  ]
}

function fixtureModel(modelId: string, tools: boolean): LocalModelCatalogEntry {
  const supported = (evidence: string) =>
    ({ state: "supported", source: "provider-declared", evidence }) as const
  const unsupported = () =>
    ({ state: "unsupported", source: "provider-declared", evidence: "absent" }) as const
  const capabilities: LocalModelCapabilities = {
    chat: supported("chat"),
    streaming: { state: "supported", source: "provider-contract", evidence: "ollama-api-chat" },
    tools: tools ? supported("tools") : unsupported(),
    vision: unsupported(),
  }
  return {
    identity: {
      provider: "ollama",
      modelId,
      digest: `sha256:${tools ? "fixture-tools" : "fixture-chat"}`,
      modifiedAt: FIXTURE_CAPTURED_AT,
      family: "flapstack-dev-fixture",
      parameterSize: "deterministic",
      quantizationLevel: null,
      contextWindow: 4096,
    },
    capabilities,
    limitations: [
      ...(!tools
        ? [
            {
              code: "tools-unsupported" as const,
              message: "This labeled chat-only Dev fixture does not expose tools.",
              modelId,
            },
          ]
        : []),
      {
        code: "vision-unsupported",
        message: "The Dev fixture does not expose vision.",
        modelId,
      },
    ],
  }
}

function fixtureLimitations(state: LocalModelDevFixtureState): LocalModelLimitation[] {
  switch (state) {
    case "ready":
      return []
    case "empty":
      return [{ code: "catalog-empty", message: "The Dev fixture catalog is empty." }]
    case "unavailable":
      return [{ code: "provider-unavailable", message: "The Dev fixture is unavailable." }]
    case "error":
      return [{ code: "provider-endpoint-error", message: "The Dev fixture returned an error." }]
    case "stale":
      return [
        {
          code: "catalog-cache-stale",
          message: "The Dev fixture catalog is stale and display-only.",
        },
      ]
  }
}

type FixtureRequest = {
  model: string
  messages: Array<{ role: string; content?: string }>
  tools: unknown[]
}

function parseRequest(body: BodyInit | null | undefined): FixtureRequest | null {
  if (typeof body !== "string") return null
  try {
    const value = JSON.parse(body) as Record<string, unknown>
    if (typeof value.model !== "string" || !Array.isArray(value.messages)) return null
    return {
      model: value.model,
      messages: value.messages.filter((message): message is { role: string; content?: string } => {
        if (!message || typeof message !== "object") return false
        const record = message as Record<string, unknown>
        return (
          typeof record.role === "string" &&
          (record.content === undefined || typeof record.content === "string")
        )
      }),
      tools: Array.isArray(value.tools) ? value.tools : [],
    }
  } catch {
    return null
  }
}

function latestUserPrompt(messages: FixtureRequest["messages"]): string {
  return (
    [...messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content?.toLowerCase() ?? ""
  )
}

function streamResponse(
  rows: Array<Record<string, unknown>>,
  signal?: AbortSignal | null,
  delayMs = 0,
): Response {
  const encoder = new TextEncoder()
  let timer: ReturnType<typeof setTimeout> | null = null
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let index = 0
      const abort = () => {
        if (timer) clearTimeout(timer)
        controller.error(new DOMException("Aborted", "AbortError"))
      }
      signal?.addEventListener("abort", abort, { once: true })
      const push = () => {
        if (signal?.aborted) return abort()
        const row = rows[index++]
        if (!row) {
          signal?.removeEventListener("abort", abort)
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(row)}\n`))
        timer = setTimeout(push, delayMs)
      }
      push()
    },
    cancel() {
      if (timer) clearTimeout(timer)
    },
  })
  return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } })
}
