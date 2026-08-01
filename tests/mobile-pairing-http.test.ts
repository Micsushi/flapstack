import { Readable } from "node:stream"
import type { IncomingMessage, ServerResponse } from "node:http"
import { describe, expect, it, vi } from "vitest"
import { createMobilePairingHttpHandler } from "../src/main/lib/mobile-bridge/pairing-http"
import type { MobilePairingService } from "../src/main/lib/mobile-pairing"
import { MOBILE_CONTROL_PROTOCOL_VERSION, mobileControlLimits } from "../src/shared/mobile-control"

const token = "t".repeat(32)
const fingerprint = `sha256:${"a".repeat(64)}` as const
const signature = "s".repeat(64)

describe("mobile pairing HTTPS handler", () => {
  it("routes pairing, challenge authentication, challenge renewal, and rotation", async () => {
    const pairing = {
      pairDevice: vi.fn(() => ({ route: "pair" })),
      authenticateChallenge: vi.fn(() => ({ route: "authenticate" })),
      createChallenge: vi.fn(() => ({ route: "challenge" })),
      rotateSession: vi.fn(() => ({ route: "rotate" })),
    } as unknown as MobilePairingService
    const handler = createMobilePairingHttpHandler(pairing)

    await expect(
      invoke(handler, "/mobile/v1/pair", {
        protocolVersion: MOBILE_CONTROL_PROTOCOL_VERSION,
        oneTimeToken: token,
        certificateFingerprint: fingerprint,
        deviceName: "Phone",
        publicKeyAlgorithm: "Ed25519",
        publicKey: "p".repeat(64),
      }),
    ).resolves.toMatchObject({ status: 201, body: { route: "pair" } })
    await expect(
      invoke(handler, "/mobile/v1/authenticate", {
        sessionId: "session-1",
        deviceId: "device-1",
        challenge: "c".repeat(32),
        signature,
      }),
    ).resolves.toMatchObject({ status: 201, body: { route: "authenticate" } })
    await expect(
      invoke(handler, "/mobile/v1/challenge", { deviceId: "device-1" }),
    ).resolves.toMatchObject({ status: 200, body: { route: "challenge" } })
    await expect(
      invoke(handler, "/mobile/v1/rotate", {
        sessionId: "session-1",
        deviceId: "device-1",
        sessionToken: token,
        nonce: "n".repeat(32),
        issuedAt: 1_800_000_000_000,
        rotation: 0,
        signature,
      }),
    ).resolves.toMatchObject({ status: 200, body: { route: "rotate" } })

    expect(pairing.pairDevice).toHaveBeenCalledOnce()
    expect(pairing.authenticateChallenge).toHaveBeenCalledOnce()
    expect(pairing.createChallenge).toHaveBeenCalledWith("device-1")
    expect(pairing.rotateSession).toHaveBeenCalledOnce()
  })

  it("bounds and validates requests before dispatch and returns redacted recovery errors", async () => {
    const pairing = {
      pairDevice: vi.fn(() => {
        throw new Error("private database detail")
      }),
    } as unknown as MobilePairingService
    const handler = createMobilePairingHttpHandler(pairing)

    await expect(invoke(handler, "/mobile/v1/pair", "not-json")).resolves.toMatchObject({
      status: 400,
      body: { error: { code: "invalid-request" } },
    })
    await expect(
      invoke(handler, "/mobile/v1/pair", "x".repeat(mobileControlLimits.commandBytes + 1)),
    ).resolves.toMatchObject({
      status: 413,
      body: { error: { code: "payload-too-large" } },
    })
    await expect(invoke(handler, "/mobile/v1/unknown", {})).resolves.toMatchObject({
      status: 404,
      body: { error: { code: "route-not-found" } },
    })
    const failure = await invoke(handler, "/mobile/v1/pair", {
      protocolVersion: MOBILE_CONTROL_PROTOCOL_VERSION,
      oneTimeToken: token,
      certificateFingerprint: fingerprint,
      deviceName: "Phone",
      publicKeyAlgorithm: "Ed25519",
      publicKey: "p".repeat(64),
    })
    expect(failure).toMatchObject({
      status: 500,
      body: { error: { code: "mobile-operation-failed" } },
    })
    expect(JSON.stringify(failure.body)).not.toContain("private database detail")
  })
})

async function invoke(
  handler: ReturnType<typeof createMobilePairingHttpHandler>,
  path: string,
  body: unknown,
): Promise<{
  status: number
  headers: Record<string, string>
  body: unknown
}> {
  const source = typeof body === "string" ? body : JSON.stringify(body)
  const request = Readable.from([Buffer.from(source)]) as unknown as IncomingMessage
  request.method = "POST"
  request.url = path
  request.headers = {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(source)),
  }
  let status = 0
  let headers: Record<string, string> = {}
  let responseBody = ""
  const response = {
    headersSent: false,
    writeHead(nextStatus: number, nextHeaders: Record<string, string>) {
      status = nextStatus
      headers = nextHeaders
      this.headersSent = true
      return this
    },
    end(chunk?: string | Uint8Array) {
      if (chunk) responseBody += chunk.toString()
      return this
    },
    destroy: vi.fn(),
  } as unknown as ServerResponse

  await handler(request, response)
  return {
    status,
    headers,
    body: responseBody ? JSON.parse(responseBody) : null,
  }
}
