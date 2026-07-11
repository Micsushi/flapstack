/**
 * OpenCode sidecar harness engine (Track E). Barrel export.
 *
 * See docs/harness-research/opencode-sidecar.md for the E0 decision and the
 * ported OpenCode HTTP/SSE contract.
 */

export * from "./contract"
export * from "./catalog"
export * from "./binary"
export * from "./credentials"
export * from "./config"
export * from "./models"
export * from "./permissions"
export * from "./events"
export * from "./persistence"
export * from "./usage"
export { SidecarChunkMapper } from "./chunks"
export { OpencodeClient, generateServerPassword } from "./client"
export { startSidecar, stopSidecar } from "./launcher"
export type { SidecarHandle, SidecarStartResult } from "./launcher"
export { runSidecarSession, streamEvents, isSidecarRuntimeEnabled } from "./session"
