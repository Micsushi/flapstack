import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  MobileBridgeService,
  defaultMobileBridgeSettings,
  validateMobileBridgeBindAddress,
  type MobileBridgeCertificate,
  type MobileBridgeSettings,
  type MobileBridgeSettingsStore,
  type MobileBridgeTransportFactory,
  type MobileBridgeTransportHandle,
  type MobileNetworkInterface,
  type MobileNetworkSource,
} from "../src/main/lib/mobile-bridge"

const fixtureRoot = join(import.meta.dirname, "fixtures", "mobile-bridge")
const interfaceFixtures = JSON.parse(
  readFileSync(join(fixtureRoot, "network-interfaces.json"), "utf8"),
) as Record<string, MobileNetworkInterface[]>

const certificate: MobileBridgeCertificate = {
  certPem: "mock-certificate",
  privateKeyPem: "mock-private-key-never-log",
  fingerprint: `sha256:${"a".repeat(64)}`,
  notBefore: 1,
  notAfter: 4_000_000_000_000,
}

class FakeSettingsStore implements MobileBridgeSettingsStore {
  writes: MobileBridgeSettings[] = []

  constructor(public value: MobileBridgeSettings = { ...defaultMobileBridgeSettings }) {}

  read() {
    return { ...this.value }
  }

  write(settings: MobileBridgeSettings) {
    this.value = { ...settings }
    this.writes.push({ ...settings })
  }
}

class FakeNetworkSource implements MobileNetworkSource {
  private listener: ((interfaces: MobileNetworkInterface[]) => void) | null = null
  failSubscribe = false
  onSubscribe: (() => void) | null = null
  subscriptions = 0

  constructor(public value = interfaceFixtures.private!) {}

  list() {
    return this.value
  }

  subscribe(listener: (interfaces: MobileNetworkInterface[]) => void) {
    this.subscriptions += 1
    this.listener = listener
    if (this.failSubscribe) {
      this.listener = null
      throw new Error("network subscription failed")
    }
    this.onSubscribe?.()
    return () => {
      if (this.listener === listener) this.listener = null
    }
  }

  emit(value: MobileNetworkInterface[]) {
    this.value = value
    this.listener?.(value)
  }
}

class FakeTransportFactory implements MobileBridgeTransportFactory {
  starts: Array<Parameters<MobileBridgeTransportFactory["start"]>[0]> = []
  beforeStartResolves: (() => void | Promise<void>) | null = null
  stopFailuresRemaining = 0
  handles: Array<
    MobileBridgeTransportHandle & {
      closeSessions: ReturnType<typeof vi.fn>
      stop: ReturnType<typeof vi.fn>
    }
  > = []

  async start(input: Parameters<MobileBridgeTransportFactory["start"]>[0]) {
    this.starts.push(input)
    await this.beforeStartResolves?.()
    const handle = {
      address: input.address,
      port: input.port,
      closeSessions: vi.fn(),
      stop: vi.fn(async () => {
        if (this.stopFailuresRemaining > 0) {
          this.stopFailuresRemaining -= 1
          throw new Error("transport stop failed")
        }
      }),
    }
    this.handles.push(handle)
    return handle
  }
}

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

function createFixture(initial?: Partial<MobileBridgeSettings>) {
  const settings = new FakeSettingsStore({ ...defaultMobileBridgeSettings, ...initial })
  const network = new FakeNetworkSource()
  const transport = new FakeTransportFactory()
  const certificates = { getOrCreate: vi.fn(async () => certificate) }
  const service = new MobileBridgeService({ settings, network, transport, certificates })
  return { service, settings, network, transport, certificates }
}

describe("mobile-bridge", () => {
  it("rejects wildcard, loopback, public, inactive, and unapproved binds before TLS work", async () => {
    const fixture = createFixture()
    for (const bindAddress of ["0.0.0.0", "127.0.0.1", "8.8.8.8", "192.168.50.25"]) {
      await expect(fixture.service.configure({ enabled: true, bindAddress })).rejects.toThrow(
        /approved private interface/,
      )
    }
    expect(fixture.transport.starts).toHaveLength(0)
    expect(fixture.certificates.getOrCreate).not.toHaveBeenCalled()
    expect(() =>
      validateMobileBridgeBindAddress("100.96.0.3", fixture.network.list()),
    ).not.toThrow()
  })

  it("shuts down sessions and clears opt-in when the approved interface changes", async () => {
    const fixture = createFixture()
    await fixture.service.configure({ enabled: true, bindAddress: "192.168.50.24" })

    fixture.network.emit(interfaceFixtures.publicOnly!)
    await vi.waitFor(() => expect(fixture.service.getStatus().state).toBe("faulted"))

    expect(fixture.transport.handles[0]!.closeSessions).toHaveBeenCalledWith(
      1001,
      "network-changed",
    )
    expect(fixture.transport.handles[0]!.stop).toHaveBeenCalledOnce()
    expect(fixture.service.getStatus()).toMatchObject({
      enabled: false,
      fingerprint: null,
      failure: "network-changed",
    })
  })
})
