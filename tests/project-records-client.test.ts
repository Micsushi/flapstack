import { describe, expect, it, vi } from "vitest"
import {
  ProjectRecordsClient,
  projectRecordsEndpoint,
} from "../src/main/lib/project-records/client"

const path = "lanes/flapstack/questions.md"
const snapshot = {
  schemaVersion: 1,
  path,
  revision: "a".repeat(64),
  document: { schemaVersion: 1, title: "Questions", records: [] },
}
const response = (status = 200, data: unknown = snapshot) =>
  new Response(JSON.stringify(data), { status })

describe("canonical records client", () => {
  it("confines credentials to the configured loopback service", async () => {
    for (const endpoint of [
      "https://example.com",
      "http://127.0.0.1.evil.test",
      "http://user:pass@127.0.0.1:47831",
      "http://127.0.0.1:47831/?token=x",
    ]) {
      expect(() => projectRecordsEndpoint(endpoint)).toThrow()
    }
    const fetch = vi.fn().mockResolvedValue(response())
    await new ProjectRecordsClient({
      endpoint: "http://127.0.0.1:47831",
      token: "private-token",
      fetch,
    }).read(path)
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:47831/v1/document?path=${encodeURIComponent(path)}`,
      expect.objectContaining({
        redirect: "error",
        headers: { Authorization: "Bearer private-token" },
      }),
    )
  })

  it("returns conflicts without retrying or replacing omitted answers", async () => {
    const fetch = vi.fn().mockResolvedValue(response(409))
    const client = new ProjectRecordsClient({
      endpoint: "http://127.0.0.1:47831",
      token: "secret",
      fetch,
    })
    const result = await client.patch({
      path,
      expectedRevision: "b".repeat(64),
      recordId: "Q-1",
      changes: { draft: "kept" },
    })
    expect(result).toEqual({ conflict: true, snapshot })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      path,
      expectedRevision: "b".repeat(64),
      recordId: "Q-1",
      changes: { draft: "kept" },
    })
  })

  it("rejects traversal and mismatched response identities", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(response(200, { ...snapshot, path: "lanes/vault/questions.md" }))
    const client = new ProjectRecordsClient({
      endpoint: "http://127.0.0.1:47831",
      token: "secret",
      fetch,
    })
    await expect(client.read("../private.md")).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    await expect(client.read(path)).rejects.toThrow("different document")
  })

  it("bounds response bytes and redacts transport errors", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("x".repeat(32 * 1024 * 1024 + 1)))
    const client = new ProjectRecordsClient({
      endpoint: "http://127.0.0.1:47831",
      token: "secret",
      fetch,
    })
    await expect(client.read(path)).rejects.toThrow("too large")
    fetch.mockRejectedValue(new Error("request failed with private-token"))
    await expect(client.read(path)).rejects.toThrow("Project records is unavailable")
  })

  it("reads bounded large snapshots without expanding mutation limits", async () => {
    const raw = JSON.stringify(snapshot).padEnd(32 * 1024 * 1024, " ")
    const fetch = vi.fn().mockResolvedValue(new Response(raw))
    const client = new ProjectRecordsClient({
      endpoint: "http://127.0.0.1:47831",
      token: "fixture",
      fetch,
    })
    expect(await client.read(path)).toEqual(snapshot)
    fetch.mockClear()
    await expect(
      client.patch({
        path,
        expectedRevision: snapshot.revision,
        recordId: "Q-1",
        changes: { draft: "x".repeat(256 * 1024) },
      }),
    ).rejects.toThrow("change is too large")
    await expect(
      client.boardRequest({
        path: "/v1/record",
        method: "POST",
        body: "x".repeat(256 * 1024 + 1),
      }),
    ).rejects.toThrow("change is too large")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("aborts a stalled request", async () => {
    const fetch = vi.fn().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("aborted")))
        }),
    )
    const client = new ProjectRecordsClient({
      endpoint: "http://127.0.0.1:47831",
      token: "secret",
      fetch,
      timeoutMs: 5,
    })
    await expect(client.read(path)).rejects.toThrow("unavailable")
  })
})

it("sends only the native pair receipt operations without exposing them through the Board proxy", async () => {
  const fetch = vi.fn().mockImplementation(async () => response(200, { status: "prepared" }))
  const client = new ProjectRecordsClient({
    endpoint: "http://127.0.0.1:47831",
    token: "fixture",
    fetch,
  })
  const body = { proposalId: "owned-proposal", receiptId: "owned-receipt" }
  for (const operation of ["read", "prepare", "commit", "abort"]) {
    const path = `/v1/yap/chat-pair/${operation}`
    expect(await client.operation(path, body)).toEqual({ status: "prepared" })
    expect(fetch).toHaveBeenLastCalledWith(
      `http://127.0.0.1:47831${path}`,
      expect.objectContaining({ method: "POST", body: JSON.stringify(body), redirect: "error" }),
    )
    await expect(client.operation(path)).rejects.toThrow("method")
    await expect(
      client.boardRequest({ path, method: "POST", body: JSON.stringify(body) }),
    ).rejects.toThrow()
  }
  await expect(client.operation("/v1/yap/chat-pair/unreviewed", body)).rejects.toThrow(
    "unsupported",
  )
  expect(fetch).toHaveBeenCalledTimes(4)
})

it("allows explicit answer continuation through native and Board POST routes only", async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async () =>
      response(200, { runId: "run-1", phase: "running", replayed: false }),
    )
  const client = new ProjectRecordsClient({
    endpoint: "http://127.0.0.1:47831",
    token: "fixture",
    fetch,
  })
  const path = "/v1/agents/continue-answer"
  const body = {
    path: "lanes/vault/questions.md",
    recordId: "Q1",
    answer: "Alpha",
    requestId: "request-1",
    storeIdentity: "1".repeat(64),
    confirmed: true,
  }
  expect(await client.operation(path, body)).toMatchObject({ runId: "run-1" })
  expect(
    (await client.boardRequest({ path, method: "POST", body: JSON.stringify(body) })).status,
  ).toBe(200)
  await expect(client.operation(path)).rejects.toThrow("method")
  await expect(client.boardRequest({ path, method: "GET" })).rejects.toThrow("unsupported")
  expect(fetch).toHaveBeenCalledTimes(2)
})

it.each([
  { endpoint: "/v1/agents/start", body: {}, deadline: 60_000 },
  { endpoint: "/v1/agents/resume", body: {}, deadline: 60_000 },
  { endpoint: "/v1/agents/continue-answer", body: {}, deadline: 60_000 },
  { endpoint: "/v1/agents", body: undefined, deadline: 10_000 },
  { endpoint: "/v1/yap/inference", body: {}, deadline: 630_000 },
  { endpoint: "/v1/agents/start", body: {}, deadline: 25, override: 25 },
])(
  "bounds $endpoint at $deadline ms while respecting explicit overrides",
  async ({ endpoint, body, deadline, override }) => {
    vi.useFakeTimers()
    let signal!: AbortSignal
    const fetch = vi.fn().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          signal = options.signal
          signal.addEventListener("abort", () => reject(new Error("aborted")))
        }),
    )
    const client = new ProjectRecordsClient({
      endpoint: "http://127.0.0.1:47831",
      token: "fixture",
      fetch,
      timeoutMs: override,
    })
    try {
      const result = client.operation(endpoint, body).catch((error) => error)
      if (deadline === 60_000) {
        await vi.advanceTimersByTimeAsync(10_000)
        expect(signal.aborted).toBe(false)
        await vi.advanceTimersByTimeAsync(49_999)
      } else {
        await vi.advanceTimersByTimeAsync(deadline - 1)
      }
      expect(signal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(signal.aborted).toBe(true)
      expect(await result).toBeInstanceOf(Error)
      expect((await result).message).toContain("unavailable")
    } finally {
      vi.useRealTimers()
    }
  },
)

it("does not expose dispatch just because execution requests have a longer timeout", async () => {
  const fetch = vi.fn()
  const client = new ProjectRecordsClient({
    endpoint: "http://127.0.0.1:47831",
    token: "fixture",
    fetch,
  })
  await expect(client.operation("/v1/agents/dispatch", {})).rejects.toThrow("unsupported")
  await expect(
    client.boardRequest({ path: "/v1/agents/dispatch", method: "POST", body: "{}" }),
  ).rejects.toThrow("unsupported")
  expect(fetch).not.toHaveBeenCalled()
})
