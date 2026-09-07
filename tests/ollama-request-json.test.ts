import { afterEach, describe, expect, it, vi } from "vitest"
import { requestOllamaJson } from "../src/main/lib/ollama/request-json"
import { checkOllamaStatus } from "../src/main/lib/ollama/detector"
import { generateChatMetadataWithOllama } from "../src/main/lib/ollama/chat-metadata"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const limits = { timeoutMs: 100, maxBytes: 100 }

describe("bounded local Ollama requests", () => {
  it("preserves a single-token title even when the model invents an action", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: "local" }] })))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              response: JSON.stringify({
                title: "Discuss hi",
                tags: [],
              }),
            }),
          ),
        ),
    )
    await expect(
      generateChatMetadataWithOllama({
        userMessage: "hi",
        titleStyle: "concise",
        includeTags: false,
      }),
    ).resolves.toEqual({ title: "hi", tags: [] })
  })

  it("uses only the fixed local origin and disallows redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'))
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      requestOllamaJson("/api/generate", { ...limits, body: { model: "local" } }),
    ).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/generate",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        body: '{"model":"local"}',
      }),
    )
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
  })

  it.each(["headers", "body"])("aborts stalled %s and clears its timer", async (phase) => {
    vi.useFakeTimers()
    let signal: AbortSignal
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        signal = init.signal
        if (phase === "headers")
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
          })
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                signal.addEventListener("abort", () => controller.error(new Error("aborted")), {
                  once: true,
                })
              },
            }),
          ),
        )
      }),
    )
    const result = expect(requestOllamaJson("/api/tags", limits)).rejects.toThrow("aborted")
    await vi.advanceTimersByTimeAsync(100)
    await result
    expect(signal!.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("caps decoded response bytes and cancels oversized streams", async () => {
    const cancel = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("x".repeat(101)))
            },
            cancel,
          }),
        ),
      ),
    )
    await expect(requestOllamaJson("/api/tags", limits)).rejects.toThrow("exceeded limit")
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each([new Response("not JSON"), new Response("private detail", { status: 500 })])(
    "rejects invalid responses",
    async (response) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))
      await expect(requestOllamaJson("/api/tags", limits)).rejects.toThrow()
    },
  )

  it("validates discovery before selecting a model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ models: [{ name: 12 }] }))),
    )
    await expect(checkOllamaStatus()).resolves.toEqual({ available: false, models: [] })
  })

  it("generates schema-checked metadata using the selected local model", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: "local-model" }] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            response: JSON.stringify({ title: "Repair chat navigation", tags: [] }),
          }),
        ),
      )
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      generateChatMetadataWithOllama({
        userMessage: "Navigation is broken",
        titleStyle: "concise",
        includeTags: false,
        model: "chosen-model",
      }),
    ).resolves.toEqual({ title: "Repair chat navigation", tags: [] })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe("chosen-model")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([{ response: 3 }, { response: '{"title":false,"tags":[]}' }])(
    "returns fallback eligibility for invalid generated metadata",
    async (payload) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: "local" }] })))
          .mockResolvedValueOnce(new Response(JSON.stringify(payload))),
      )
      await expect(
        generateChatMetadataWithOllama({
          userMessage: "task",
          titleStyle: "concise",
          includeTags: false,
        }),
      ).resolves.toBeNull()
    },
  )

  it("does not generate when discovery fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"))
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      generateChatMetadataWithOllama({
        userMessage: "task",
        titleStyle: "concise",
        includeTags: false,
      }),
    ).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each(["discovery", "generation"])("falls back when %s stalls after headers", async (phase) => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal.addEventListener("abort", () => controller.error(new Error("aborted")), {
                once: true,
              })
            },
          }),
        ),
      ),
    )
    if (phase === "generation") {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: "local" }] })))
    }
    vi.stubGlobal("fetch", fetchMock)
    const result = generateChatMetadataWithOllama({
      userMessage: "task",
      titleStyle: "concise",
      includeTags: false,
    })
    await vi.advanceTimersByTimeAsync(phase === "discovery" ? 2_000 : 30_000)
    await expect(result).resolves.toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
