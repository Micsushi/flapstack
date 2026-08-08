const counters = new Map<string, number>()
const durations = new Map<string, { count: number; totalMs: number; maxMs: number }>()

export function incrementPerformanceCounter(name: string, amount = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + amount)
}

export function recordPerformanceDuration(name: string, milliseconds: number): void {
  const current = durations.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 }
  durations.set(name, {
    count: current.count + 1,
    totalMs: current.totalMs + milliseconds,
    maxMs: Math.max(current.maxMs, milliseconds),
  })
}

export function measurePerformanceNextFrame(name: string): void {
  const startedAt = performance.now()
  requestAnimationFrame(() => recordPerformanceDuration(name, performance.now() - startedAt))
}

export function readPerformanceCounters(): Record<string, number> {
  return Object.fromEntries(counters)
}

export function readPerformanceDiagnostics() {
  return {
    counters: readPerformanceCounters(),
    durations: Object.fromEntries(
      [...durations].map(([name, value]) => [
        name,
        { ...value, averageMs: value.count === 0 ? 0 : value.totalMs / value.count },
      ]),
    ),
  }
}

export function resetPerformanceCounters(): void {
  counters.clear()
  durations.clear()
}

export type PerformanceDiagnosticsBridge = {
  read: typeof readPerformanceDiagnostics
  reset: typeof resetPerformanceCounters
}

declare global {
  // Available only in explicitly profiled renderer builds.
  var __flapstackPerformanceDiagnostics: PerformanceDiagnosticsBridge | undefined
}

if (import.meta.env.VITE_PROFILE_PERFORMANCE === "true") {
  globalThis.__flapstackPerformanceDiagnostics = {
    read: readPerformanceDiagnostics,
    reset: resetPerformanceCounters,
  }
}
