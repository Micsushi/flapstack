import { createServer, type Server, type RequestListener } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { fetchOmniRouteModels, omniRouteModelsEndpoint } from "../scripts/omniroute-models.mjs"

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})
async function endpoint(handler: RequestListener) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as { port: number }
  return `http://127.0.0.1:${address.port}`
}

describe("OmniRoute catalog adapter", () => {
  it("preserves live IDs and declared nested capabilities without importing unrelated fields", async () => {
    let authenticated = false
    const baseUrl = await endpoint((request, response) => {
      authenticated = request.headers.authorization === "Bearer synthetic-key"
      expect(request.url).toBe("/v1/models")
      response.end(
        JSON.stringify({
          data: [
            {
              id: "provider/model-thinking",
              context_length: 32000,
              capabilities: { tool_calling: true, thinking: true },
              apiKey: "do-not-project",
            },
            { id: "my-combo" },
          ],
        }),
      )
    })
    const result = await fetchOmniRouteModels({ baseUrl, apiKey: "synthetic-key" })
    expect(authenticated).toBe(true)
    expect(result.provider).toBe("omniroute")
    expect(result.models).toEqual([
      {
        id: "provider/model-thinking",
        context_length: 32000,
        capabilities: { tool_calling: true, thinking: true },
      },
      { id: "my-combo" },
    ])
    expect(JSON.stringify(result)).not.toContain("do-not-project")
  })
  it("does not follow redirects or echo an error body", async () => {
    let redirected = false
    const destination = await endpoint((_request, response) => {
      redirected = true
      response.end("{}")
    })
    const baseUrl = await endpoint((_request, response) => {
      response.writeHead(302, { Location: destination })
      response.end("synthetic-key")
    })
    await expect(fetchOmniRouteModels({ baseUrl, apiKey: "synthetic-key" })).rejects.toThrow(
      "HTTP 302",
    )
    expect(redirected).toBe(false)
  })
  it.each([
    {},
    { data: [{ id: "same" }, { id: "same" }] },
    { data: [{ id: "x", context_length: -1 }] },
    { data: [{ id: "x", capabilities: { thinking: "yes" } }] },
  ])("rejects incompatible or ambiguous catalog data %j", async (payload) => {
    const baseUrl = await endpoint((_request, response) => response.end(JSON.stringify(payload)))
    await expect(fetchOmniRouteModels({ baseUrl })).rejects.toThrow()
  })
  it("bounds the response body", async () => {
    const baseUrl = await endpoint((_request, response) =>
      response.end("x".repeat(2 * 1024 * 1024 + 1)),
    )
    await expect(fetchOmniRouteModels({ baseUrl })).rejects.toThrow("limit")
  })

  it.each(["synthetic-reflected-secret", 'synthetic-"quoted"-secret'])(
    "rejects reflected credential %s",
    async (apiKey) => {
      const baseUrl = await endpoint((_request, response) =>
        response.end(JSON.stringify({ data: [{ id: apiKey }] })),
      )
      await expect(fetchOmniRouteModels({ baseUrl, apiKey })).rejects.toThrow("credential material")
    },
  )

  it.each([401, 403, 429])("reports HTTP %i without echoing response secrets", async (status) => {
    const baseUrl = await endpoint((_request, response) => {
      response.writeHead(status)
      response.end("synthetic-secret-response")
    })
    await expect(fetchOmniRouteModels({ baseUrl })).rejects.toThrow(`HTTP ${status}`)
  })

  it("cancels while reading a response body", async () => {
    const controller = new AbortController()
    const baseUrl = await endpoint((_request, response) => {
      response.writeHead(200)
      response.write("{")
      setImmediate(() => controller.abort())
    })
    await expect(fetchOmniRouteModels({ baseUrl, signal: controller.signal })).rejects.toThrow(
      "cancelled",
    )
  })
  it("cancels a stalled body on timeout", async () => {
    const baseUrl = await endpoint((_request, response) => {
      response.writeHead(200)
      response.write("{")
    })
    await expect(fetchOmniRouteModels({ baseUrl, timeoutMs: 50 })).rejects.toThrow("timed out")
  })
  it("honors caller cancellation", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      fetchOmniRouteModels({ baseUrl: "http://127.0.0.1:47832", signal: controller.signal }),
    ).rejects.toThrow("cancelled")
  })
  it("requires transport-safe URLs and preserves a reverse-proxy prefix", () => {
    for (const url of [
      "http://example.com",
      "https://user:secret@example.com",
      "https://example.com?key=secret",
      "file:///tmp/models",
    ])
      expect(() => omniRouteModelsEndpoint(url)).toThrow()
    expect(omniRouteModelsEndpoint("https://example.com/proxy/v1/").href).toBe(
      "https://example.com/proxy/v1/models",
    )
    expect(omniRouteModelsEndpoint("http://[::1]:47832").href).toBe("http://[::1]:47832/v1/models")
  })
})
