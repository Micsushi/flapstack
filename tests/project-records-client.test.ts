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
  it("binds durable associations to authenticated SQLite identity, never the transport port", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(response(200, { backend: "sqlite", storeIdentity: "a".repeat(64) }))
    const client = new ProjectRecordsClient({
      endpoint: "http://127.0.0.1:47831",
      token: "private-token",
      fetch,
    })
    expect(await client.storeIdentity()).toBe(`sqlite:${"a".repeat(64)}`)
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:47831/v1/storage",
      expect.objectContaining({
        headers: { Authorization: "Bearer private-token" },
        redirect: "error",
      }),
    )
    for (const storage of [
      { backend: "files", storeIdentity: "a".repeat(64) },
      { backend: "sqlite" },
      { backend: "sqlite", storeIdentity: "short" },
    ]) {
      fetch.mockResolvedValue(response(200, storage))
      await expect(client.storeIdentity()).rejects.toThrow("stable SQLite")
    }
  })
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

  it("reads responses above 32 MiB and redacts transport errors", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot) + " ".repeat(32 * 1024 * 1024)))
    const client = new ProjectRecordsClient({
      endpoint: "http://127.0.0.1:47831",
      token: "secret",
      fetch,
    })
    await expect(client.read(path)).resolves.toEqual(snapshot)
    fetch.mockRejectedValue(new Error("request failed with private-token"))
    await expect(client.read(path)).rejects.toThrow("Project records is unavailable")
  })
})
