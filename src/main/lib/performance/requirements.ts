import { REQUIRED_PERFORMANCE_METRICS, type PerformanceBudget } from "./budgets"

type Metric = PerformanceBudget["metric"]

/** Native host behavior that a headless development process cannot certify. */
export const STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS = [
  "shell-ready",
  "first-use-ready",
  "warm-first-use-ready",
  "input-response",
  "frame-stall",
  "task-stall",
  "long-chat-render",
  "search-response",
  "grid-input-response",
] as const satisfies readonly Metric[]

/** Optional native-host evidence. These rows never block the bounded core run. */
export const STAGE6_CAPABILITY_PERFORMANCE_METRICS = [
  "trace-capture",
  "heap-snapshot",
  "sleep-wake-recovery",
] as const satisfies readonly Metric[]

export const STAGE6_CORE_DEV_PERFORMANCE_METRICS = REQUIRED_PERFORMANCE_METRICS.filter(
  (metric) => !STAGE6_CAPABILITY_PERFORMANCE_METRICS.includes(metric as never),
)

export const STAGE6_HEADLESS_CORE_PERFORMANCE_METRICS = STAGE6_CORE_DEV_PERFORMANCE_METRICS.filter(
  (metric) => !STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS.includes(metric as never),
)

/**
 * Fixed production-seam authority. Callers cannot replace these labels or mint
 * built-in provenance from their own sample values.
 */
export const STAGE6_REQUIRED_PRODUCT_SEAMS = {
  "shell-ready": "electron-test-control:navigation-readiness",
  "first-use-ready": "electron-test-control:first-use-paint",
  "warm-first-use-ready": "electron-test-control:warm-first-use-paint",
  "input-response": "electron-test-control:input-paint",
  "frame-stall": "electron-test-control:animation-frame-gaps",
  "task-stall": "electron-test-control:long-task-observer",
  "long-chat-render": "electron-test-control:bounded-long-chat-render",
  "search-response": "electron-test-control:large-search",
  "grid-input-response": "electron-test-control:grid-input-paint",
  "database-open": "better-sqlite3:open+migrateDatabase",
  "migration-upgrade": "migrateDatabase:prior-release",
  "recovery-reopen": "better-sqlite3:wal-reopen",
  "scoped-query": "AgentActivityStore.query",
  "database-search": "better-sqlite3:chat-history-search",
  "migration-duration": "migrateDatabase:prior-release",
  "recovery-duration": "better-sqlite3:wal-recovery",
  "concurrent-read-write-lock": "better-sqlite3:wal-reader-writer",
  "wal-checkpoint": "better-sqlite3:wal_checkpoint",
  "backup-duration": "createPortableDatabase",
  "maintenance-duration": "better-sqlite3:optimize",
  "integrity-check": "better-sqlite3:integrity_check",
  "restart-recovery": "better-sqlite3:close-reopen",
  "stream-throughput": "AgentActivityStore.appendBatch",
  "stream-event-latency": "AgentActivityStore.appendBatch",
  "ordered-event-loss": "AgentActivityStore.replayRun",
  "output-flood-loss": "AgentActivityStore.replayRun",
  "output-flood-backlog": "AgentActivityStore.appendBatch+replayRun",
  "steady-state-cpu": "process.cpuUsage:bounded-product-control-cycle",
  "steady-state-memory": "process.memoryUsage:bounded-product-soak",
  "file-descriptor-delta": "runAppShutdown:better-sqlite3-handle",
  "listener-delta": "runAppShutdown:EventEmitter+process-listener",
  "watcher-delta": "runAppShutdown:FSWatcher",
  "socket-delta": "runAppShutdown:loopback-TCP-servers",
  "deterministic-soak-memory-growth":
    "bounded-product-soak:SQLite-loop+RuntimeLaunchCoordinator-cycles+TerminalManager-PTY-cycles",
  "deterministic-soak-resource-delta":
    "bounded-product-soak:SQLite-loop+RuntimeLaunchCoordinator-cycles+TerminalManager-PTY-cycles",
  "harness-overhead": "node:perf_hooks",
  "process-delta": "runAppShutdown:TerminalManager-owned-PTY-PIDs",
  "timer-delta": "runAppShutdown:automation-interval",
  "agent-start-latency": "RuntimeLaunchCoordinator:flapstack-native-test-control",
  "terminal-start-latency": "TerminalManager:createPerformanceTestControl",
  "cancel-latency": "RuntimeLaunchCoordinator.cancel",
  "cleanup-process-delta": "runAppShutdown:RuntimeLaunchCoordinator+TerminalManager-owned-PTY-PIDs",
  "concurrent-agent-capacity": "RuntimeLaunchCoordinator:activeRunIds",
  "concurrent-terminal-capacity": "TerminalManager:getSessionCountByWorkspaceId",
  "visible-grid-pane-capacity": "chatWorkbenchLayoutSchema:max-groups",
} as const satisfies Partial<Record<Metric, string>>

export const STAGE6_REQUIRED_EXPLICIT_OMISSIONS = [
  ...STAGE6_CAPABILITY_PERFORMANCE_METRICS,
] as const satisfies readonly Metric[]
