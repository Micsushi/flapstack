import type { IncomingMessage, ServerResponse } from "node:http"
import { z } from "zod"
import {
  mobileChallengeProofSchema,
  mobileControlLimits,
  mobilePairingRequestSchema,
  mobileSessionProofSchema,
} from "../../../shared/mobile-control"
import { MobilePairingError, type MobilePairingService } from "../mobile-pairing"
import type { MobileBridgeRequestHandler } from "./types"
import { getMobileCompanionAsset } from "./pwa"

const challengeRequestSchema = z.object({ deviceId: z.string().trim().min(1).max(200) }).strict()

type PairingRoute = {
  status: number
  parse(value: unknown): unknown
  run(pairing: MobilePairingService, value: never): unknown
}

const routes: Record<string, PairingRoute> = {
  "/mobile/v1/pair": {
    status: 201,
    parse: (value) => mobilePairingRequestSchema.parse(value),
    run: (pairing, value) => pairing.pairDevice(value),
  },
  "/mobile/v1/challenge": {
    status: 200,
    parse: (value) => challengeRequestSchema.parse(value),
    run: (pairing, value: { deviceId: string }) => pairing.createChallenge(value.deviceId),
  },
  "/mobile/v1/authenticate": {
    status: 201,
    parse: (value) => mobileChallengeProofSchema.parse(value),
    run: (pairing, value) => pairing.authenticateChallenge(value),
  },
  "/mobile/v1/rotate": {
    status: 200,
    parse: (value) => mobileSessionProofSchema.parse(value),
    run: (pairing, value) => pairing.rotateSession(value),
  },
}

export function createMobilePairingHttpHandler(
  pairing: MobilePairingService,
): MobileBridgeRequestHandler {
  return async (request, response) => {
    try {
      if (request.method !== "POST")
        throw new MobileHttpError(405, "method-not-allowed", "Use POST for this endpoint.")
      const contentType = firstHeader(request.headers["content-type"])
      if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType))
        throw new MobileHttpError(415, "content-type-required", "Use application/json.")
      const route = routes[pathname(request)]
      if (!route)
        throw new MobileHttpError(404, "route-not-found", "Mobile pairing route was not found.")
      const parsed = route.parse(await readJson(request))
      writeJson(response, route.status, route.run(pairing, parsed as never))
    } catch (error) {
      const failure = normalizeHttpError(error)
      writeJson(response, failure.status, {
        error: { code: failure.code, recovery: failure.recovery },
      })
    }
  }
}

export function createMobileHttpHandler(pairing: MobilePairingService): MobileBridgeRequestHandler {
  const pairingHandler = createMobilePairingHttpHandler(pairing)
  return async (request, response) => {
    const asset = request.method === "GET" ? getMobileCompanionAsset(pathname(request)) : null
    if (!asset) return pairingHandler(request, response)
    const body = Buffer.from(asset.body)
    response.writeHead(asset.status, {
      "cache-control":
        pathname(request) === "/service-worker.js" ? "no-cache" : "private, max-age=300",
      "content-security-policy":
        "default-src 'self'; connect-src 'self' wss:; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "content-type": asset.contentType,
      "content-length": String(body.byteLength),
      "cross-origin-opener-policy": "same-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    })
    response.end(body)
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(firstHeader(request.headers["content-length"]) ?? "0")
  if (
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > mobileControlLimits.commandBytes
  )
    throw new MobileHttpError(413, "payload-too-large", "Send a smaller bounded pairing request.")

  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > mobileControlLimits.commandBytes)
      throw new MobileHttpError(413, "payload-too-large", "Send a smaller bounded pairing request.")
    chunks.push(buffer)
  }
  if (bytes === 0) throw new MobileHttpError(400, "invalid-request", "Send a JSON request body.")
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as unknown
  } catch {
    throw new MobileHttpError(400, "invalid-request", "Send valid JSON.")
  }
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value))
  if (body.byteLength > mobileControlLimits.commandBytes) {
    writeJson(response, 500, {
      error: {
        code: "response-too-large",
        recovery: "Retry from the desktop and review mobile diagnostics.",
      },
    })
    return
  }
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.byteLength),
    "x-content-type-options": "nosniff",
  })
  response.end(body)
}

function pathname(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "https://mobile.invalid").pathname
  } catch {
    return "/"
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

class MobileHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly recovery: string,
  ) {
    super(code)
  }
}

function normalizeHttpError(error: unknown): MobileHttpError {
  if (error instanceof MobileHttpError) return error
  if (error instanceof z.ZodError)
    return new MobileHttpError(400, "invalid-request", "Review the request and try again.")
  if (error instanceof MobilePairingError) {
    const status =
      error.code === "pairing-used" || error.code === "credential-exists"
        ? 409
        : error.code === "pairing-expired" ||
            error.code === "challenge-expired" ||
            error.code === "session-expired" ||
            error.code === "device-revoked"
          ? 410
          : error.code === "device-not-found"
            ? 404
            : error.code === "invalid-request"
              ? 400
              : 401
    return new MobileHttpError(status, error.code, recoveryFor(error.code))
  }
  return new MobileHttpError(
    500,
    "mobile-operation-failed",
    "Retry from the desktop and review mobile diagnostics.",
  )
}

function recoveryFor(code: MobilePairingError["code"]): string {
  if (code.startsWith("pairing-") || code === "fingerprint-mismatch")
    return "Create and scan a fresh desktop pairing offer."
  if (code === "device-not-found" || code === "device-revoked")
    return "Pair this device again from the desktop."
  if (code === "challenge-expired" || code === "challenge-invalid")
    return "Request and sign a fresh device challenge."
  if (
    code === "session-expired" ||
    code === "session-invalid" ||
    code === "rotation-mismatch" ||
    code === "replay"
  )
    return "Authenticate with a fresh challenge."
  return "Review the request and try again."
}
