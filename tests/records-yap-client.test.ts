import { describe, expect, it, vi } from "vitest"
import { ProjectRecordsClient } from "../src/main/lib/project-records/client"

const input = {
  inputId: "input-1",
  version: 1,
  creatorId: "owner",
  inputDigest: "a".repeat(64),
  originalText: "Keep this source",
  segments: [{ id: "segment-1", start: 0, end: 16, text: "Keep this source" }],
  attachments: [],
  sourceValidity: { valid: true, invalidAttachmentIds: [] },
  reviewable: true,
}

const proposal = {
  proposalId: "proposal-1",
  version: 1,
  creatorId: "owner",
  inputId: "input-1",
  inputVersion: 1,
  inputDigest: "a".repeat(64),
  rows: [
    {
      id: "row-1",
      sourceSegmentIds: ["segment-1"],
      sourceImageIds: [],
      interpretedRequest: "Keep this source",
      projectId: null,
      uncertainty: true,
      uncertaintyReason: "Project assignment is unresolved",
    },
  ],
  actions: [{ id: "action-1", kind: "note", rowIds: ["row-1"], executable: false }],
  status: "draft" as const,
  executable: false as const,
  sourceValidity: { valid: true, invalidAttachmentIds: [] },
  reviewable: true,
}

describe("bounded Yap Records client", () => {
  it("allows both bounded inference passes before aborting", async () => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const fetch = vi.fn().mockImplementation(async (_url, options) => {
        signal = options.signal
        await new Promise((resolve) => setTimeout(resolve, 600_000))
        signal?.throwIfAborted()
        return new Response(JSON.stringify({ ok: true }))
      })
      const client = new ProjectRecordsClient({
        endpoint: "http://127.0.0.1:47831",
        token: "private-token",
        fetch,
      })
      const result = client.boardRequest({
        path: "/v1/yap/inference",
        method: "POST",
        body: JSON.stringify({ inputId: "input-1" }),
      })
      await vi.advanceTimersByTimeAsync(599_000)
      expect(signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1_000)
      await expect(result).resolves.toMatchObject({ status: 200 })
    } finally {
      vi.useRealTimers()
    }
  })

  it("allows chunked source upload and validates typed input/proposal responses", async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/v1/yap/input")) return new Response(JSON.stringify({ input }))
      if (url.includes("/v1/yap/proposal")) return new Response(JSON.stringify({ proposal }))
      return new Response(
        JSON.stringify({
          upload: {
            uploadId: "upload-1",
            creatorId: "owner",
            idempotencyKey: null,
            name: "shot.png",
            mime: "image/png",
            byteLength: 3,
            totalChunks: 1,
            sha256: "b".repeat(64),
            receivedChunks: [],
            receivedBytes: 0,
            status: "staging",
          },
        }),
      )
    })
    const client = new ProjectRecordsClient({
      endpoint: "http://127.0.0.1:47831",
      token: "private-token",
      fetch,
    })
    await client.startYapUpload({
      name: "shot.png",
      mime: "image/png",
      byteLength: 3,
      totalChunks: 1,
      sha256: "b".repeat(64),
    })
    await client.uploadYapChunk({ uploadId: "upload-1", index: 0, data: "YWJj" })
    expect(await client.readYapInput("input-1")).toEqual(input)
    expect(await client.readYapProposal("proposal-1")).toEqual(proposal)
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/v1/yap/upload/chunk"))).toBe(
      true,
    )
  })

  it("rejects unallowlisted Yap paths before network access", async () => {
    const fetch = vi.fn()
    const client = new ProjectRecordsClient({
      endpoint: "http://127.0.0.1:47831",
      token: "private-token",
      fetch,
    })
    await expect(client.operation("/v1/yap/../../etc/passwd")).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("forwards embedded inference and cancellation routes through the same allowlist", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      }),
    )
    const client = new ProjectRecordsClient({
      endpoint: "http://127.0.0.1:47831",
      token: "private-token",
      fetch,
    })
    await expect(
      client.boardRequest({
        path: "/v1/yap/inference",
        method: "POST",
        body: JSON.stringify({ inputId: "input-1", requestId: "request-1" }),
      }),
    ).resolves.toMatchObject({ status: 200 })
    await expect(
      client.boardRequest({
        path: "/v1/yap/inference/cancel",
        method: "POST",
        body: JSON.stringify({ requestId: "request-1" }),
      }),
    ).resolves.toMatchObject({ status: 200 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
