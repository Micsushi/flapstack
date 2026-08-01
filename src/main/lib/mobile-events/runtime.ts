import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type { ProductMcpRendererInvalidation } from "../../../shared/product-mcp-invalidation"
import * as schema from "../db/schema"
import { createMobileHttpHandler } from "../mobile-bridge/pairing-http"
import type { MobileBridgeRequestHandler } from "../mobile-bridge/types"
import type { MobileBridgeTransportSession } from "../mobile-bridge/types"
import {
  MobileActionService,
  MobileStepUpTokenService,
  createProductionMobileActionDispatchers,
} from "../mobile-actions"
import { MobileDeviceConnectionRegistry, MobilePairingService } from "../mobile-pairing"
import { agentInputLifecycle } from "../agent-input/service"
import { MobileScopeGrantService } from "./grants"
import { MobileEventService } from "./service"

export class MobileControlRuntime {
  readonly connections = new MobileDeviceConnectionRegistry()
  readonly pairing: MobilePairingService
  readonly grants: MobileScopeGrantService
  readonly events: MobileEventService
  readonly actions: MobileActionService | null
  readonly stepUp = new MobileStepUpTokenService()
  readonly handleRequest: MobileBridgeRequestHandler
  private readonly unsubscribeAgentInput: () => void

  constructor(
    database: BetterSQLite3Database<typeof schema>,
    options: {
      now?: () => number
      databasePath?: string
      bridgeEnabled?: () => boolean
    } = {},
  ) {
    this.pairing = new MobilePairingService({
      database,
      connections: this.connections,
      now: options.now,
    })
    this.pairing.revokeActiveSessionsForRuntimeRestart()
    this.handleRequest = createMobileHttpHandler(this.pairing)
    this.grants = new MobileScopeGrantService({
      database,
      connections: this.connections,
      now: options.now,
    })
    this.actions = options.databasePath
      ? new MobileActionService({
          database,
          pairing: this.pairing,
          now: options.now,
          bridgeEnabled: options.bridgeEnabled ?? (() => false),
          dispatch: createProductionMobileActionDispatchers(database, options.databasePath),
          verifyStepUp: (command) => this.stepUp.consume(command),
        })
      : null
    this.events = new MobileEventService({
      database,
      pairing: this.pairing,
      grants: this.grants,
      connections: this.connections,
      now: options.now,
      ...(this.actions ? { actions: this.actions } : {}),
      listAgentInputs: () => agentInputLifecycle.list(),
    })
    this.unsubscribeAgentInput = agentInputLifecycle.subscribe((event) =>
      this.events.ingestAgentInputStatus(event),
    )
  }

  handleWebSocket = (session: MobileBridgeTransportSession): void => {
    this.events.handleWebSocket(session)
  }

  ingestInvalidation(event: ProductMcpRendererInvalidation): void {
    this.events.ingestInvalidation(event)
  }

  stop(): void {
    this.unsubscribeAgentInput()
    this.events.stop()
  }
}

let appMobileControlRuntime: MobileControlRuntime | null = null

export function setAppMobileControlRuntime(runtime: MobileControlRuntime | null): void {
  appMobileControlRuntime = runtime
}

export function getAppMobileControlRuntime(): MobileControlRuntime {
  if (!appMobileControlRuntime) throw new Error("Mobile control runtime is not initialized.")
  return appMobileControlRuntime
}
