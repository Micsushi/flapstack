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
