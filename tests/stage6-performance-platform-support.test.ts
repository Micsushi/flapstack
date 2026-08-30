import { describe, expect, it, vi } from "vitest"

vi.mock("../src/main/lib/performance/product-adapters", () => ({
  builtInProductRepositoryRoot: () => process.cwd(),
  createProductPerformanceAdapters: () => [],
}))

import { localProductPerformanceSupport } from "../src/main/lib/performance/product-runner"

describe("Stage 6 local performance platform support", () => {
  it("supports built-in headless product adapters on Windows and macOS", () => {
    expect(localProductPerformanceSupport({ platform: "darwin", buildType: "dev" })).toEqual({
      supported: true,
    })
    expect(localProductPerformanceSupport({ platform: "linux", buildType: "dev" })).toEqual({
      supported: false,
      reason: expect.stringMatching(/adapter.*unavailable.*linux/i),
    })
    expect(localProductPerformanceSupport({ platform: "win32", buildType: "dev" })).toEqual({
      supported: true,
    })
  })
})
