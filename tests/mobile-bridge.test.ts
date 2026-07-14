import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ExactMobileBridgeRequestPolicy,
  FileMobileBridgeCertificateProvider,
  FileMobileBridgeSettingsStore,
  MobileBridgeService,
  SlidingWindowMobileBridgeAdmission,
  defaultMobileBridgeSettings,
  normalizeMobileBridgeSettings,
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
const requestFixtures = JSON.parse(
  readFileSync(join(fixtureRoot, "requests.json"), "utf8"),
) as Record<string, { host: string; origin: string }>

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

  constructor(public value = interfaceFixtures.private!) {}

  list() {
    return this.value
  }

  subscribe(listener: (interfaces: MobileNetworkInterface[]) => void) {
    this.listener = listener
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
  handles: Array<
    MobileBridgeTransportHandle & {
      closeSessions: ReturnType<typeof vi.fn>
      stop: ReturnType<typeof vi.fn>
    }
  > = []

  async start(input: Parameters<MobileBridgeTransportFactory["start"]>[0]) {
    this.starts.push(input)
    const handle = {
      address: input.address,
      port: input.port,
      closeSessions: vi.fn(),
      stop: vi.fn(async () => undefined),
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
  it("keeps missing and malformed settings default-off without starting a listener", async () => {
    expect(normalizeMobileBridgeSettings(undefined)).toEqual(defaultMobileBridgeSettings)
    expect(normalizeMobileBridgeSettings({ enabled: "yes", bindAddress: "", port: 80 })).toEqual(
      defaultMobileBridgeSettings,
    )
    const fixture = createFixture()

    await expect(fixture.service.startFromSettings()).resolves.toMatchObject({
      state: "disabled",
      enabled: false,
      fingerprint: null,
    })
    expect(fixture.transport.starts).toHaveLength(0)
    expect(fixture.certificates.getOrCreate).not.toHaveBeenCalled()
  })

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

  it("enables with TLS material, persists opt-in only after start, and exposes fingerprint only", async () => {
    const fixture = createFixture()

    const status = await fixture.service.configure({
      enabled: true,
      bindAddress: "192.168.50.24",
      port: 4317,
    })

    expect(status).toMatchObject({
      state: "running",
      enabled: true,
      bindAddress: "192.168.50.24",
      port: 4317,
      fingerprint: certificate.fingerprint,
      failure: null,
    })
    expect(fixture.transport.starts).toHaveLength(1)
    expect(fixture.transport.starts[0]!.certificate).toBe(certificate)
    expect(fixture.settings.writes[0]).toMatchObject({ enabled: false })
    expect(fixture.settings.writes.at(-1)).toMatchObject({ enabled: true })
    expect(JSON.stringify(status)).not.toContain(certificate.privateKeyPem)
  })

  it("restores an explicit enabled setting on startup and fails closed if its interface disappeared", async () => {
    const restart = createFixture({ enabled: true, bindAddress: "192.168.50.24" })
    await expect(restart.service.startFromSettings()).resolves.toMatchObject({ state: "running" })
    expect(restart.transport.starts).toHaveLength(1)

    const missing = createFixture({ enabled: true, bindAddress: "192.168.50.24" })
    missing.network.value = interfaceFixtures.rebound!
    await expect(missing.service.startFromSettings()).resolves.toMatchObject({
      state: "faulted",
      enabled: false,
    })
    expect(missing.transport.starts).toHaveLength(0)
    expect(missing.settings.value.enabled).toBe(false)
  })

  it("disables and rebinds by closing sessions and the old listener first", async () => {
    const fixture = createFixture()
    await fixture.service.configure({ enabled: true, bindAddress: "192.168.50.24" })
    fixture.network.value = [...interfaceFixtures.private!, interfaceFixtures.rebound![0]!]

    await fixture.service.configure({ enabled: true, bindAddress: "192.168.50.25", port: 4417 })

    expect(fixture.transport.handles[0]!.closeSessions).toHaveBeenCalledWith(1001, "rebind")
    expect(fixture.transport.handles[0]!.stop).toHaveBeenCalledOnce()
    expect(fixture.transport.starts[1]).toMatchObject({ address: "192.168.50.25", port: 4417 })

    await expect(fixture.service.configure({ enabled: false })).resolves.toMatchObject({
      state: "disabled",
      enabled: false,
      fingerprint: null,
    })
    expect(fixture.transport.handles[1]!.closeSessions).toHaveBeenCalledWith(1001, "disabled")
    expect(fixture.transport.handles[1]!.stop).toHaveBeenCalledOnce()
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

  it("enforces exact host/origin and bounded request/connection admission", () => {
    const policy = new ExactMobileBridgeRequestPolicy("192.168.50.24", 4317)
    expect(policy.authorize(requestFixtures.accepted!, "https")).toEqual({ allowed: true })
    expect(policy.authorize(requestFixtures.accepted!, "websocket")).toEqual({ allowed: true })
    expect(policy.authorize(requestFixtures.wrongHost!, "https")).toMatchObject({
      allowed: false,
      status: 400,
    })
    expect(policy.authorize(requestFixtures.wrongOrigin!, "websocket")).toMatchObject({
      allowed: false,
      status: 403,
    })
    expect(policy.authorize({ host: requestFixtures.accepted!.host }, "websocket")).toMatchObject({
      allowed: false,
      status: 403,
    })

    const admission = new SlidingWindowMobileBridgeAdmission(2, 2, 1)
    expect(admission.acceptRequest("10.0.0.4", 1_000)).toBe(true)
    expect(admission.acceptRequest("10.0.0.4", 2_000)).toBe(true)
    expect(admission.acceptRequest("10.0.0.4", 3_000)).toBe(false)
    expect(admission.acceptRequest("10.0.0.4", 62_000)).toBe(true)
    expect(admission.openConnection("10.0.0.4")).toBe(true)
    expect(admission.openConnection("10.0.0.4")).toBe(false)
    expect(admission.openConnection("10.0.0.5")).toBe(true)
    expect(admission.openConnection("10.0.0.6")).toBe(false)
    admission.closeConnection("10.0.0.4")
    expect(admission.openConnection("10.0.0.6")).toBe(true)

    const boundedAdmission = new SlidingWindowMobileBridgeAdmission(2, 2, 1, 2)
    expect(boundedAdmission.acceptRequest("10.0.0.1", 1_000)).toBe(true)
    expect(boundedAdmission.acceptRequest("10.0.0.1", 1_001)).toBe(true)
    expect(boundedAdmission.acceptRequest("10.0.0.2", 2_000)).toBe(true)
    expect(boundedAdmission.acceptRequest("10.0.0.3", 3_000)).toBe(true)
    expect(boundedAdmission.acceptRequest("10.0.0.1", 4_000)).toBe(true)
  })

  it("stores generated certificate keys owner-only and returns a stable SHA-256 fingerprint", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-mobile-bridge-"))
    temporaryDirectories.push(directory)
    const provider = new FileMobileBridgeCertificateProvider(directory, () => 2_000_000)

    const first = await provider.getOrCreate("192.168.50.24")
    const second = await provider.getOrCreate("192.168.50.24")

    expect(first.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(second.fingerprint).toBe(first.fingerprint)
    expect(statSync(directory).mode & 0o077).toBe(0)
    expect(statSync(join(directory, "private-key.pem")).mode & 0o077).toBe(0)
    expect(readFileSync(join(directory, "certificate.pem"), "utf8")).not.toContain(
      first.privateKeyPem,
    )
  })

  it("stores bridge settings owner-only without a database migration", () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-mobile-settings-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "mobile-bridge-settings.json")
    const store = new FileMobileBridgeSettingsStore(path)

    expect(store.read()).toEqual(defaultMobileBridgeSettings)
    store.write({
      ...defaultMobileBridgeSettings,
      enabled: true,
      bindAddress: "192.168.50.24",
    })

    expect(store.read()).toMatchObject({ enabled: true, bindAddress: "192.168.50.24" })
    expect(statSync(path).mode & 0o077).toBe(0)
  })
})
