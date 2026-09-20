import { expect, it, vi } from "vitest"
const seen = vi.hoisted(() => ({ url: "", options: {} as any }))
vi.mock("ws", () => ({
  default: class {
    constructor(url: string, options: unknown) {
      seen.url = url
      seen.options = options
    }
  },
}))
import { RemoteTransport } from "../src/main/lib/mobile-client/transport"
it("uses exact HTTPS Origin and scoped pin agent for WebSocket without redirects", () => {
  const transport = new RemoteTransport("https://100.78.162.80:4317", "sha256:" + "a".repeat(64))
  try {
    transport.socket()
    expect(seen.url).toBe("wss://100.78.162.80:4317/mobile/v1/events")
    expect(seen.options.origin).toBe("https://100.78.162.80:4317")
    expect(seen.options.agent).toBe(transport.agent)
    expect(seen.options.followRedirects).toBe(false)
    expect(seen.options.maxPayload).toBe(512 * 1024)
  } finally {
    transport.close()
  }
})

it("uses the production HTTPS pairing statuses and rejects wrong status and certificate", async () => {
  const { createServer } = await import("node:https")
  const { networkInterfaces } = await import("node:os")
  const { X509Certificate } = await import("node:crypto")
  const { generate } = await import("selfsigned")
  const { classifyMobileBindAddress } = await import("../src/shared/mobile-control")
  const { createMobilePairingHttpHandler } =
    await import("../src/main/lib/mobile-bridge/pairing-http")
  const address = Object.values(networkInterfaces())
    .flat()
    .find(
      (entry) =>
        entry &&
        entry.family === "IPv4" &&
        ["private", "private-overlay"].includes(classifyMobileBindAddress(entry.address)),
    )?.address
  expect(address, "Real TLS regression requires a local private interface").toBeTruthy()
  const certificate = await generate([{ name: "commonName", value: "Owned HTTPS regression" }], {
    keyType: "ec",
    curve: "P-256",
    algorithm: "sha256",
    extensions: [{ name: "subjectAltName", altNames: [{ type: 7, ip: address! }] }],
  })
  const fingerprint =
    "sha256:" +
    new X509Certificate(certificate.cert).fingerprint256.replaceAll(":", "").toLowerCase()
  const handler = createMobilePairingHttpHandler({
    pairDevice: () => ({ route: "pair" }),
    createChallenge: () => ({ route: "challenge" }),
    authenticateChallenge: () => ({ route: "authenticate" }),
  } as unknown as Parameters<typeof createMobilePairingHttpHandler>[0])
  let overrideStatus: number | undefined,
    requestCount = 0
  const statuses: number[] = []
  const server = createServer(
    { key: certificate.private, cert: certificate.cert },
    (request, response) => {
      requestCount++
      response.on("finish", () => statuses.push(response.statusCode))
      if (overrideStatus) {
        response.writeHead(overrideStatus, { Location: "https://example.invalid" })
        response.end("{}")
        return
      }
      void handler(request, response)
    },
  )
  let transport: RemoteTransport | undefined, wrongPin: RemoteTransport | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, address!, resolve)
    })
    const endpoint = `https://${address}:${(server.address() as import("node:net").AddressInfo).port}`
    transport = new RemoteTransport(endpoint, fingerprint)
    const pair = {
      protocolVersion: 1,
      oneTimeToken: "t".repeat(32),
      certificateFingerprint: fingerprint,
      deviceName: "Owned test",
      publicKeyAlgorithm: "P-256",
      publicKey: "p".repeat(64),
    }
    await expect(transport.post("/mobile/v1/pair", pair)).resolves.toEqual({ route: "pair" })
    await expect(
      transport.post("/mobile/v1/authenticate", {
        sessionId: "session",
        deviceId: "device",
        challenge: "c".repeat(32),
        signature: "s".repeat(64),
      }),
    ).resolves.toEqual({ route: "authenticate" })
    await expect(transport.post("/mobile/v1/challenge", { deviceId: "device" })).resolves.toEqual({
      route: "challenge",
    })
    expect(statuses).toEqual([201, 201, 200])
    await expect(transport.post("/mobile/v1/pair", {})).rejects.toThrow("refused")
    for (const status of [200, 202, 302, 401, 500]) {
      overrideStatus = status
      await expect(transport.post("/mobile/v1/pair", pair)).rejects.toThrow("refused")
    }
    overrideStatus = 201
    await expect(transport.post("/mobile/v1/challenge", { deviceId: "device" })).rejects.toThrow(
      "refused",
    )
    const beforeWrongPin = requestCount
    wrongPin = new RemoteTransport(endpoint, "sha256:" + "0".repeat(64))
    await expect(wrongPin.post("/mobile/v1/challenge", { deviceId: "device" })).rejects.toThrow(
      "certificate verification",
    )
    expect(requestCount).toBe(beforeWrongPin)
  } finally {
    wrongPin?.close()
    transport?.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
