import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type { ProductMcpRendererInvalidation } from "../../../shared/product-mcp-invalidation"
import * as schema from "../db/schema"
import type { MobileBridgeTransportSession } from "../mobile-bridge/types"
import { MobileDeviceConnectionRegistry, MobilePairingService } from "../mobile-pairing"
import { MobileScopeGrantService } from "./grants"
import { MobileEventService } from "./service"

export class MobileControlRuntime {
  readonly connections = new MobileDeviceConnectionRegistry()
  readonly pairing: MobilePairingService
  readonly grants: MobileScopeGrantService
  readonly events: MobileEventService

  constructor(database: BetterSQLite3Database<typeof schema>) {
    this.pairing = new MobilePairingService({ database, connections: this.connections })
    this.grants = new MobileScopeGrantService({
      database,
      connections: this.connections,
    })
    this.events = new MobileEventService({
      database,
      pairing: this.pairing,
      grants: this.grants,
      connections: this.connections,
    })
  }

  handleWebSocket = (session: MobileBridgeTransportSession): void => {
    this.events.handleWebSocket(session)
  }

  ingestInvalidation(event: ProductMcpRendererInvalidation): void {
    this.events.ingestInvalidation(event)
  }

  stop(): void {
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
