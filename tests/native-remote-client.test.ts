import { EventEmitter } from "node:events"
import { generateKeyPairSync, X509Certificate } from "node:crypto"
import { generate } from "selfsigned"
import { describe, it, expect } from "vitest"
import { RemoteComputerClient } from "../src/main/lib/mobile-client/service"
import {
  remoteEndpoint,
  RemoteTransport,
  verifyRemoteCertificate,
} from "../src/main/lib/mobile-client/transport"

const privateKey = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey
function fixture() {
  let time = 10,
    server = 100_000
  const sockets: FakeSocket[] = [],
    calls: string[] = []
  const identity = {
    endpoint: "https://100.78.162.80:4317",
    fingerprint: "sha256:" + "a".repeat(64),
    label: "Test host",
    deviceId: "device1",
    privateKey,
  }
  class FakeSocket extends EventEmitter {
    readyState = 1
    sent: Record<string, any>[] = []
    send(value: string, callback?: (error?: Error) => void) {
      this.sent.push(JSON.parse(value))
      callback?.()
    }
    terminate() {
      this.readyState = 3
    }
  }
  const transports: any[] = []
  const client = new RemoteComputerClient(
    { load: () => identity, save: () => "encrypted" },
    () => {
      const transport = {
        close() {},
        async post(path: string) {
          calls.push(path)
          return path.endsWith("challenge")
            ? {
                sessionId: `session${server}`,
                deviceId: "device1",
                challenge: "a".repeat(43),
                issuedAt: server,
                expiresAt: server + 60000,
              }
            : {
                sessionToken: "b".repeat(43),
                session: {
                  sessionId: `session${server}`,
                  deviceId: "device1",
                  issuedAt: server,
                  lastSeenAt: server,
                  idleExpiresAt: server + 600000,
                  absoluteExpiresAt: server + 1000000,
                  scopeVersion: 1,
                  rotation: 0,
                },
              }
        },
        socket() {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket
        },
      }
      transports.push(transport)
      return transport as unknown as RemoteTransport
    },
    () => time,
  )
  const snapshot = () => ({
    protocolVersion: 1,
    kind: "snapshot",
    snapshotId: "snapshot1",
    scopeVersion: 1,
    sequence: 1,
    generatedAt: server,
    freshUntil: server + 30000,
    items: [
      {
        kind: "agent-input",
        id: "input1",
        version: 1,
        updatedAt: server,
        chatId: "chat1",
        runId: "run1",
        questions: [
          {
            id: "q1",
            question: "Continue?",
            options: ["Yes"],
            multiSelect: false,
            allowCustom: false,
          },
        ],
      },
    ],
  })
  const start = async () => {
    await client.connect("grant1")
    sockets.at(-1)!.emit("open")
    sockets.at(-1)!.emit("message", Buffer.from(JSON.stringify(snapshot())))
  }
  const answer = () =>
    client.answer({
      connectionId: client.status().connectionId,
      scopeVersion: 1,
      targetId: "input1",
      targetVersion: 1,
      answers: { q1: ["Yes"] },
      confirmed: true,
    })
  return {
    client,
    sockets,
    calls,
    transports,
    snapshot,
    start,
    answer,
    advance: (amount: number) => {
      time += amount
    },
    serverTime: (value: number) => {
      server = value
    },
  }
}

describe("native remote computer boundaries", () => {
  it("pairs with the host schema's normalized public key and saves only protected identity", async () => {
    let saved: unknown
    const offer = {
      protocolVersion: 1,
      endpoint: "https://100.78.162.80:4317",
      certificateFingerprint: "sha256:" + "a".repeat(64),
      oneTimeToken: "a".repeat(43),
      createdAt: 100000,
      expiresAt: 200000,
    }
    const client = new RemoteComputerClient(
      {
        load: () => null,
        save: (value) => {
          saved = value
          return "encrypted"
        },
      },
      () =>
        ({
          close() {},
          async post(_path: string, body: any) {
            return {
              device: {
                deviceId: "device1",
                name: "Office",
                publicKeyAlgorithm: "P-256",
                publicKey: body.publicKey.trim(),
                createdAt: 100000,
                scopeVersion: 1,
              },
              challenge: {
                sessionId: "session1",
                deviceId: "device1",
                challenge: "c".repeat(43),
                issuedAt: 100000,
                expiresAt: 160000,
              },
            }
          },
        }) as unknown as RemoteTransport,
    )
    await client.pair({
      offer,
      label: "Office",
      confirmedEndpoint: offer.endpoint,
      confirmedFingerprint: offer.certificateFingerprint,
    })
    expect(saved).toHaveProperty("privateKey")
    expect(client.status().host?.label).toBe("Office")
    expect(JSON.stringify(client.status())).not.toContain("PRIVATE KEY")
  })
  it("accepts only exact private HTTPS endpoints and rejects invalid certificate bytes", () => {
    expect(remoteEndpoint("https://100.78.162.80:4317").origin).toBe("https://100.78.162.80:4317")
    for (const endpoint of [
      "http://100.78.162.80:4317",
      "https://example.com:4317",
      "https://8.8.8.8:4317",
      "https://user@100.78.162.80:4317",
      "https://100.78.162.80:4317/redirect",
    ])
      expect(() => remoteEndpoint(endpoint)).toThrow()
    expect(() =>
      verifyRemoteCertificate(Buffer.from("invalid"), "sha256:" + "a".repeat(64)),
    ).toThrow()
  })
  it("checks a real certificate pin and expiry without changing OS trust", async () => {
    const pem = await generate([{ name: "commonName", value: "Owned native client test" }], {
      keyType: "ec",
      curve: "P-256",
      algorithm: "sha256",
    })
    const cert = new X509Certificate(pem.cert),
      pin = `sha256:${cert.fingerprint256.replaceAll(":", "").toLowerCase()}`
    expect(() => verifyRemoteCertificate(cert.raw, pin)).not.toThrow()
    expect(() => verifyRemoteCertificate(cert.raw, "sha256:" + "0".repeat(64))).toThrow()
    expect(() => verifyRemoteCertificate(cert.raw, pin, Date.parse(cert.validTo) + 1)).toThrow()
  })
  it("requires a fresh snapshot before enabling answers", async () => {
    const f = fixture()
    await f.client.connect("grant1")
    f.sockets[0].emit("open")
    expect(f.client.status().current).toBe(false)
    expect(f.answer).toThrow()
    f.sockets[0].emit("message", Buffer.from(JSON.stringify(f.snapshot())))
    expect(f.client.status().current).toBe(true)
  })
  it("uses authenticated server time, dispatches once and correlates host receipt", async () => {
    const f = fixture()
    await f.start()
    f.advance(123)
    f.answer()
    const command = f.sockets[0].sent.at(-1)!
    expect(command.issuedAt).toBe(100123)
    expect(command.target.id).toBe("input1")
    expect(f.answer).toThrow()
    f.sockets[0].emit(
      "message",
      Buffer.from(
        JSON.stringify({
          protocolVersion: 1,
          kind: "event",
          eventId: "e1",
          snapshotId: "snapshot1",
          scopeVersion: 1,
          sequence: 2,
          occurredAt: 100123,
          payload: {
            type: "action.result",
            commandId: command.commandId,
            action: "clarification.answer",
            status: "completed",
          },
        }),
      ),
    )
    expect(f.client.status().receipt?.commandId).toBe(command.commandId)
    expect(f.client.status().receipt?.status).toBe("completed")
    expect(f.answer).toThrow()
  })
  it("refuses stale, offline and wrong-version answers", async () => {
    const f = fixture()
    await f.start()
    expect(() =>
      f.client.answer({
        connectionId: f.client.status().connectionId,
        targetId: "input1",
        targetVersion: 2,
        scopeVersion: 1,
        answers: { q1: ["Yes"] },
        confirmed: true,
      }),
    ).toThrow()
    f.advance(30001)
    expect(f.answer).toThrow()
    f.client.disconnect()
    expect(f.answer).toThrow()
  })
  it.each([{}, { q1: ["Yes", "Other"] }, { q1: ["Other"] }, { q1: ["Yes"], other: ["Yes"] }])(
    "rejects invalid answers before consuming the target",
    async (answers) => {
      const f = fixture()
      await f.start()
      expect(() =>
        f.client.answer({
          connectionId: f.client.status().connectionId,
          targetId: "input1",
          targetVersion: 1,
          scopeVersion: 1,
          answers: answers as Record<string, string[]>,
          confirmed: true,
        }),
      ).toThrow()
      expect(f.sockets[0].sent).toHaveLength(1)
      expect(f.answer).not.toThrow()
    },
  )
  it("reconnect replaces clock/snapshot and invalidates old host actions", async () => {
    const f = fixture()
    await f.start()
    const old = f.client.status().connectionId
    f.serverTime(900000)
    await f.start()
    expect(f.calls.filter((path) => path.endsWith("authenticate"))).toHaveLength(2)
    expect(() =>
      f.client.answer({
        connectionId: old,
        targetId: "input1",
        targetVersion: 1,
        scopeVersion: 1,
        answers: { q1: ["Yes"] },
        confirmed: true,
      }),
    ).toThrow()
    f.answer()
    expect(f.sockets[1].sent.at(-1)!.issuedAt).toBe(900000)
    f.sockets[0].emit("message", Buffer.from(JSON.stringify(f.snapshot())))
    expect(f.client.status().connectionId).not.toBe(old)
  })
  it.each(["scope.revoked", "resnapshot.required"])("fails closed on %s", async (type) => {
    const f = fixture()
    await f.start()
    f.sockets[0].emit(
      "message",
      Buffer.from(
        JSON.stringify({
          protocolVersion: 1,
          kind: "event",
          eventId: "e1",
          snapshotId: "snapshot1",
          scopeVersion: 1,
          sequence: 2,
          occurredAt: 100000,
          payload: {
            type,
            ...(type === "scope.revoked" ? { scopeVersion: 2 } : {}),
            reason: "Host changed access",
          },
        }),
      ),
    )
    expect(f.client.status().current).toBe(false)
    expect(f.answer).toThrow()
  })
  it("rejects invalid, replayed and wrong-scope envelopes", async () => {
    for (const value of [
      { kind: "invalid" },
      {
        protocolVersion: 1,
        kind: "event",
        eventId: "gap",
        snapshotId: "snapshot1",
        scopeVersion: 1,
        sequence: 3,
        occurredAt: 100000,
        payload: { type: "heartbeat" },
      },
      {
        protocolVersion: 1,
        kind: "event",
        eventId: "e",
        snapshotId: "snapshot1",
        scopeVersion: 1,
        sequence: 1,
        occurredAt: 100000,
        payload: { type: "heartbeat" },
      },
      {
        protocolVersion: 1,
        kind: "event",
        eventId: "e",
        snapshotId: "snapshot1",
        scopeVersion: 2,
        sequence: 2,
        occurredAt: 100000,
        payload: { type: "heartbeat" },
      },
    ]) {
      const f = fixture()
      await f.start()
      f.sockets[0].emit("message", Buffer.from(JSON.stringify(value)))
      expect(f.client.status().current).toBe(false)
    }
  })
  it("ignores authentication that returns after disconnect", async () => {
    const f = fixture()
    await f.start()
    const pending = f.client.connect("grant1")
    f.client.disconnect()
    await expect(pending).rejects.toThrow("changed")
    expect(f.client.status().current).toBe(false)
  })
})
