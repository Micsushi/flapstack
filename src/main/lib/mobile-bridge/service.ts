import { FileMobileBridgeCertificateProvider } from "./certificate"
import { PollingMobileNetworkSource, validateMobileBridgeBindAddress } from "./network"
import { ExactMobileBridgeRequestPolicy, SlidingWindowMobileBridgeAdmission } from "./policy"
import { FileMobileBridgeSettingsStore } from "./settings"
import { NodeMobileBridgeTransportFactory } from "./transport"
import type {
  MobileBridgeAdmissionController,
  MobileBridgeCertificateProvider,
  MobileBridgeRequestHandler,
  MobileBridgeRequestPolicy,
  MobileBridgeSettings,
  MobileBridgeSettingsStore,
  MobileBridgeStatus,
  MobileBridgeTransportFactory,
  MobileBridgeTransportHandle,
  MobileBridgeWebSocketHandler,
  MobileNetworkInterface,
  MobileNetworkSource,
} from "./types"

export type MobileBridgeServiceOptions = {
  settings: MobileBridgeSettingsStore
  certificates: MobileBridgeCertificateProvider
  network: MobileNetworkSource
  transport: MobileBridgeTransportFactory
  createPolicy?: (address: string, port: number) => MobileBridgeRequestPolicy
  createAdmission?: () => MobileBridgeAdmissionController
  onRequest?: MobileBridgeRequestHandler
  onWebSocket?: MobileBridgeWebSocketHandler
}

export class MobileBridgeService {
  private settings: MobileBridgeSettings
  private handle: MobileBridgeTransportHandle | null = null
  private unsubscribeNetwork: (() => void) | null = null
  private admission: MobileBridgeAdmissionController | null = null
  private state: MobileBridgeStatus["state"] = "disabled"
  private fingerprint: MobileBridgeStatus["fingerprint"] = null
  private failure: string | null = null
  private operation = Promise.resolve()

  constructor(private readonly options: MobileBridgeServiceOptions) {
    this.settings = options.settings.read()
  }

  getStatus(): MobileBridgeStatus {
    return {
      state: this.state,
      enabled: this.settings.enabled,
      bindAddress: this.settings.bindAddress,
      port: this.settings.port,
      fingerprint: this.fingerprint,
      failure: this.failure,
    }
  }

  startFromSettings(): Promise<MobileBridgeStatus> {
    return this.enqueue(async () => {
      if (!this.settings.enabled) {
        this.state = "disabled"
        return this.getStatus()
      }
      try {
        await this.startLocked(this.settings.bindAddress, this.settings.port)
      } catch (error) {
        await this.stopLocked("startup-failed")
        this.settings = { ...this.settings, enabled: false }
        this.options.settings.write(this.settings)
        this.state = "faulted"
        this.failure = safeFailure(error)
      }
      return this.getStatus()
    })
  }

  configure(input: {
    enabled: boolean
    bindAddress?: string | null
    port?: number
  }): Promise<MobileBridgeStatus> {
    return this.enqueue(async () => {
      const next: MobileBridgeSettings = {
        ...this.settings,
        enabled: input.enabled,
        ...(input.bindAddress !== undefined ? { bindAddress: input.bindAddress } : {}),
        ...(input.port !== undefined ? { port: input.port } : {}),
      }
      if (!next.enabled) {
        await this.stopLocked("disabled")
        this.settings = next
        this.options.settings.write(next)
        this.state = "disabled"
        this.failure = null
        return this.getStatus()
      }

      validateMobileBridgeBindAddress(next.bindAddress ?? "", this.options.network.list())
      if (
        this.handle &&
        this.handle.address === next.bindAddress &&
        this.handle.port === next.port
      ) {
        this.settings = next
        this.options.settings.write(next)
        return this.getStatus()
      }

      await this.stopLocked("rebind")
      const disabledNext = { ...next, enabled: false }
      try {
        // Persist the target in a fail-closed state before any listener exists.
        // A crash or failed TLS start therefore cannot auto-enable on restart.
        this.options.settings.write(disabledNext)
        this.settings = disabledNext
        await this.startLocked(next.bindAddress, next.port)
        this.settings = next
        try {
          this.options.settings.write(next)
        } catch (error) {
          await this.stopLocked("settings-write-failed")
          this.settings = disabledNext
          this.state = "faulted"
          throw error
        }
      } catch (error) {
        this.settings = disabledNext
        this.state = "faulted"
        this.failure = safeFailure(error)
        throw error
      }
      return this.getStatus()
    })
  }

  stop(reason = "shutdown"): Promise<MobileBridgeStatus> {
    return this.enqueue(async () => {
      await this.stopLocked(reason)
      this.state = "disabled"
      return this.getStatus()
    })
  }

  private async startLocked(address: string | null, port: number): Promise<void> {
    if (!address) throw new Error("Mobile bridge requires an approved private bind address.")
    validateMobileBridgeBindAddress(address, this.options.network.list())
    this.state = "starting"
    this.failure = null
    const certificate = await this.options.certificates.getOrCreate(address)
    const admission = this.options.createAdmission?.() ?? new SlidingWindowMobileBridgeAdmission()
    const policy =
      this.options.createPolicy?.(address, port) ??
      new ExactMobileBridgeRequestPolicy(address, port)
    const handle = await this.options.transport.start({
      address,
      port,
      certificate,
      requestPolicy: policy,
      admission,
      onRequest: this.options.onRequest,
      onWebSocket: this.options.onWebSocket,
      onFailure: (error) => void this.handleTransportFailure(error),
    })
    this.handle = handle
    this.admission = admission
    this.fingerprint = certificate.fingerprint
    this.settings = { ...this.settings, enabled: true, bindAddress: address, port }
    this.unsubscribeNetwork = this.options.network.subscribe((interfaces) => {
      void this.handleNetworkChange(interfaces)
    })
    this.state = "running"
  }

  private async stopLocked(reason: string): Promise<void> {
    this.unsubscribeNetwork?.()
    this.unsubscribeNetwork = null
    const handle = this.handle
    this.handle = null
    this.fingerprint = null
    if (!handle) {
      this.admission?.reset()
      this.admission = null
      return
    }
    this.state = "stopping"
    handle.closeSessions(1001, reason)
    try {
      await handle.stop()
    } finally {
      this.admission?.reset()
      this.admission = null
    }
  }

  private handleNetworkChange(interfaces: MobileNetworkInterface[]): Promise<void> {
    return this.enqueue(async () => {
      if (!this.handle || !this.settings.bindAddress) return
      try {
        validateMobileBridgeBindAddress(this.settings.bindAddress, interfaces)
      } catch {
        await this.stopLocked("network-changed")
        this.settings = { ...this.settings, enabled: false }
        this.options.settings.write(this.settings)
        this.state = "faulted"
        this.failure = "network-changed"
      }
    })
  }

  private handleTransportFailure(error: Error): Promise<void> {
    return this.enqueue(async () => {
      if (!this.handle) return
      await this.stopLocked("transport-failed")
      this.settings = { ...this.settings, enabled: false }
      this.options.settings.write(this.settings)
      this.state = "faulted"
      this.failure = safeFailure(error)
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation)
    this.operation = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

export function createDefaultMobileBridgeService(
  handlers: Pick<MobileBridgeServiceOptions, "onRequest" | "onWebSocket"> = {},
): MobileBridgeService {
  return new MobileBridgeService({
    settings: new FileMobileBridgeSettingsStore(),
    certificates: new FileMobileBridgeCertificateProvider(),
    network: new PollingMobileNetworkSource(),
    transport: new NodeMobileBridgeTransportFactory(),
    ...handlers,
  })
}

let appMobileBridgeService: MobileBridgeService | null = null

export function setAppMobileBridgeService(service: MobileBridgeService | null): void {
  appMobileBridgeService = service
}

export function getAppMobileBridgeService(): MobileBridgeService {
  if (!appMobileBridgeService) throw new Error("Mobile bridge service is not initialized.")
  return appMobileBridgeService
}

function safeFailure(error: unknown): string {
  if (!(error instanceof Error)) return "mobile-bridge-failed"
  const code = (error as NodeJS.ErrnoException).code
  return code ? `mobile-bridge-${code.toLowerCase()}` : "mobile-bridge-failed"
}
