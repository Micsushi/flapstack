import { beforeEach, describe, expect, it } from "vitest"

import {
  incrementPerformanceCounter,
  readPerformanceCounters,
  resetPerformanceCounters,
} from "../src/renderer/lib/performance-counters"

describe("performance diagnostic counters", () => {
  beforeEach(resetPerformanceCounters)

  it("records interaction and render frequency without wall-clock assertions", () => {
    incrementPerformanceCounter("chat-switch")
    incrementPerformanceCounter("stream-render-commit", 2)

    expect(readPerformanceCounters()).toMatchObject({
      "chat-switch": 1,
      "stream-render-commit": 2,
    })
  })

  it("keeps the diagnostics bridge disabled without an explicit profiling flag", () => {
    expect(globalThis.__flapstackPerformanceDiagnostics).toBeUndefined()
  })
})
