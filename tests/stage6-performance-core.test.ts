import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { createPerformanceFixture } from "../src/main/lib/performance/fixtures"
import {
  REQUIRED_PERFORMANCE_METRICS,
  STAGE6_PERFORMANCE_BUDGETS,
  assertPerformanceSupportRequest,
} from "../src/main/lib/performance/budgets"
import {
  STAGE6_CAPABILITY_PERFORMANCE_METRICS,
  STAGE6_CORE_DEV_PERFORMANCE_METRICS,
  STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS,
  STAGE6_HEADLESS_CORE_PERFORMANCE_METRICS,
  STAGE6_REQUIRED_EXPLICIT_OMISSIONS,
  STAGE6_REQUIRED_PRODUCT_SEAMS,
} from "../src/main/lib/performance/requirements"
import {
  activityStreamBatchSize,
  classifyRuntimeResources,
  createProductPerformanceAdapters,
  databaseSearchResultLimit,
  measureSteadyStateCpu,
  measureMonotonicClockHarnessOverhead,
  waitForResourceSettlement,
  validateProductPerformanceAdapterCoverage,
} from "../src/main/lib/performance/product-adapters"
import {
  REQUIRED_PRODUCT_PERFORMANCE_WORKFLOWS,
  validateRequiredPerformanceWorkflowCoverage,
} from "../src/main/lib/performance/workflows"
import { createCandidateBinding } from "../src/main/lib/performance/candidate"
import { createPerformanceReport } from "../src/main/lib/performance/report"
import {
  parsePerformanceCliArguments,
  performanceCiFailureReasons,
  performanceCliBudgetIds,
} from "../src/main/lib/performance/cli"

const candidate = createCandidateBinding({
  authority: "test-fixture",
  gitSha: "e2f786f36be5108931f20014f8859e27386431e2",
  worktreeDigest: "b".repeat(64),
  dirty: false,
  buildId: "dev-node22",
  buildType: "dev",
  artifact: null,
  platform: "win32",
  osRelease: "10.0.26100",
  architecture: "x64",
  hardwareClass: "reference-desktop",
  powerProfile: "performance-ac",
  powerProfileEvidenceSha256: "d".repeat(64),
  cpuModel: "Fixture CPU 8 Core",
  logicalCores: 8,
  memoryBytes: 16 * 1024 ** 3,
  nodeVersion: "22.23.2",
  electronVersion: "39.8.10",
})

describe("Stage 6 T2-core performance coverage", () => {
  it("binds every applicable development metric to a fixed production or test-control seam", () => {
    expect(STAGE6_CAPABILITY_PERFORMANCE_METRICS).toEqual([
      "trace-capture",
      "heap-snapshot",
      "sleep-wake-recovery",
    ])
    expect(STAGE6_REQUIRED_EXPLICIT_OMISSIONS).toEqual(STAGE6_CAPABILITY_PERFORMANCE_METRICS)
    expect(new Set(STAGE6_CORE_DEV_PERFORMANCE_METRICS)).toEqual(
      new Set(
        REQUIRED_PERFORMANCE_METRICS.filter(
          (metric) => !STAGE6_CAPABILITY_PERFORMANCE_METRICS.includes(metric as never),
        ),
      ),
    )
    expect(new Set(Object.keys(STAGE6_REQUIRED_PRODUCT_SEAMS))).toEqual(
      new Set(STAGE6_CORE_DEV_PERFORMANCE_METRICS),
    )
    expect(validateRequiredPerformanceWorkflowCoverage()).toEqual([])

    const workflows = new Map(
      REQUIRED_PRODUCT_PERFORMANCE_WORKFLOWS.map((workflow) => [workflow.metric, workflow]),
    )
    for (const metric of STAGE6_HEADLESS_CORE_PERFORMANCE_METRICS) {
      expect(workflows.get(metric)).toMatchObject({
        availability: "implemented",
        productionSeam: STAGE6_REQUIRED_PRODUCT_SEAMS[metric],
      })
    }
    for (const metric of STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS) {
      expect(workflows.get(metric)).toMatchObject({
        availability: "implemented",
        evidenceClass: "core",
        productionSeam: STAGE6_REQUIRED_PRODUCT_SEAMS[metric],
        runPrerequisite: expect.stringMatching(/Electron.*test.control/i),
      })
    }
    for (const metric of STAGE6_CAPABILITY_PERFORMANCE_METRICS) {
      expect(workflows.get(metric)).toMatchObject({
        availability: "unavailable",
        evidenceClass: "capability",
        runPrerequisite: expect.stringMatching(/Electron|sleep|wake/i),
      })
    }
  })

  it("registers adapters for all core development metrics without claiming package evidence", () => {
    const adapters = createProductPerformanceAdapters({
      allowTestCandidate: true,
      testRecordLimit: 12,
      testStreamEventLimit: 32,
      testSoakIterations: 3,
    })
    expect(validateProductPerformanceAdapterCoverage(adapters, candidate)).toEqual([])
    for (const metric of STAGE6_HEADLESS_CORE_PERFORMANCE_METRICS) {
      const budget = budgetFor(metric)
      expect(adapters.some((adapter) => adapter.supports(budget, candidate).supported)).toBe(true)
    }
    for (const metric of [
      ...STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS,
      ...STAGE6_CAPABILITY_PERFORMANCE_METRICS,
    ]) {
      const budget = budgetFor(metric)
      expect(adapters.some((adapter) => adapter.supports(budget, candidate).supported)).toBe(false)
    }

    const { binding: _binding, ...candidatePayload } = candidate
    const packageCandidate = createCandidateBinding({
      ...candidatePayload,
      authority: "test-fixture",
      buildType: "package",
      buildId: "fixture-package",
      artifact: {
        name: "Flapstack Preview.exe",
        byteLength: 100,
        sha256: "a".repeat(64),
      },
    })
    expect(
      adapters.some(
        (adapter) => adapter.supports(budgetFor("database-open"), packageCandidate).supported,
      ),
    ).toBe(false)
  })

  it("executes representative startup, renderer, storage, stream, resource, and scale seams", async () => {
    const adapter = createProductPerformanceAdapters({
      allowTestCandidate: true,
      testRecordLimit: 12,
      testStreamEventLimit: 32,
      testSoakIterations: 3,
    })[0]!
    for (const metric of [
      "database-open",
      "database-search",
      "integrity-check",
      "output-flood-backlog",
      "listener-delta",
      "process-delta",
      "deterministic-soak-resource-delta",
      "cancel-latency",
      "cleanup-process-delta",
      "concurrent-agent-capacity",
      "concurrent-terminal-capacity",
      "visible-grid-pane-capacity",
    ] as const) {
      const authoritative = budgetFor(metric)
      const budget = { ...authoritative, minimumWarmups: 0, minimumRepeats: 1 }
      const fixture = createPerformanceFixture(budget.dataset)
      const measured = await adapter.measure({
        budget,
        candidate,
        fixtureBytes: fixture.bytes,
        fixtureSha256: fixture.manifest.sha256,
      })
      expect(measured.fixtureSha256).toBe(fixture.manifest.sha256)
      expect(measured.samples.measuredSamples).toHaveLength(1)
      expect(measured.samples.measuredSamples[0]).toBeGreaterThanOrEqual(0)
      if (metric === "process-delta" || metric === "cleanup-process-delta") {
        expect(measured.samples.measuredSamples).toEqual([0])
      }
    }
  }, 60_000)

  it("enforces documented support limits before admitting excess work", () => {
    expect(() =>
      assertPerformanceSupportRequest({ agents: 10, terminals: 10, visibleChatPanes: 4 }),
    ).not.toThrow()
    expect(() => assertPerformanceSupportRequest({ agents: 11 })).toThrow(/agents.*10/i)
    expect(() => assertPerformanceSupportRequest({ terminals: 11 })).toThrow(/terminals.*10/i)
    expect(() => assertPerformanceSupportRequest({ visibleChatPanes: 5 })).toThrow(/panes.*4/i)
  })

  it("parses a bounded fixed-root CLI plan and keeps capability and package lanes separate", () => {
    expect(
      parsePerformanceCliArguments(["--core", "--output", ".local-evidence/stage6-performance"]),
    ).toMatchObject({
      lane: "core",
      buildType: "dev",
      outputDirectory: ".local-evidence/stage6-performance",
    })
    expect(() => parsePerformanceCliArguments(["--core", "--output", "../outside"])).toThrow(
      /output.*repository|evidence/i,
    )
    expect(() => parsePerformanceCliArguments(["--core", "--package"])).toThrow(
      /package.*separate|core.*development/i,
    )
    expect(new Set(performanceCliBudgetIds("core", "dev"))).toEqual(
      new Set(
        STAGE6_PERFORMANCE_BUDGETS.budgets
          .filter(
            (budget) =>
              budget.buildType === "dev" &&
              STAGE6_CORE_DEV_PERFORMANCE_METRICS.includes(budget.metric as never),
          )
          .map((budget) => budget.id),
      ),
    )
    expect(
      performanceCliBudgetIds("capability", "dev").every((id) =>
        STAGE6_CAPABILITY_PERFORMANCE_METRICS.some((metric) => id.includes(`.${metric}.`)),
      ),
    ).toBe(true)
    const coreIds = performanceCliBudgetIds("core", "dev")
    expect(coreIds.indexOf("background.steady-state-memory.medium.dev.steady")).toBeLessThan(
      coreIds.indexOf("streaming.stream-throughput.stress.dev.steady"),
    )
  })

  it("keeps complete search coverage and bounds durability-latency batches", () => {
    expect(databaseSearchResultLimit(100_000)).toBe(1_000)
    expect(activityStreamBatchSize("stream-event-latency")).toBe(250)
    expect(activityStreamBatchSize("stream-throughput")).toBe(1_000)
  })

  it("keeps core and capability report coverage authoritative and separate", () => {
    const core = createPerformanceReport({
      lane: "core",
      budgetVersion: STAGE6_PERFORMANCE_BUDGETS.version,
      measuredAt: "2026-07-30T12:00:00.000Z",
      candidate,
      results: [],
      omissions: [],
    })
    const capability = createPerformanceReport({
      lane: "capability",
      budgetVersion: STAGE6_PERFORMANCE_BUDGETS.version,
      measuredAt: "2026-07-30T12:00:00.000Z",
      candidate,
      results: [],
      omissions: [],
    })

    expect(core.schemaVersion).toBe(3)
    expect(core.lane).toBe("core")
    expect(new Set(core.coverage.requiredBudgetIds)).toEqual(
      new Set(performanceCliBudgetIds("core", "dev")),
    )
    expect(core.coverage.requiredBudgetIds).toHaveLength(46)
    expect(
      core.coverage.requiredBudgetIds.some((id) =>
        STAGE6_CAPABILITY_PERFORMANCE_METRICS.some((metric) => id.includes(`.${metric}.`)),
      ),
    ).toBe(false)
    expect(capability.lane).toBe("capability")
    expect(new Set(capability.coverage.requiredBudgetIds)).toEqual(
      new Set(performanceCliBudgetIds("capability", "dev")),
    )
    expect(capability.coverage.requiredBudgetIds).toHaveLength(3)
  })

  it("runs the bounded performance gate only from the supported Windows check path", () => {
    const source = readFileSync("scripts/check.mjs", "utf8")
    const runner = readFileSync("scripts/stage6-performance.mjs", "utf8")

    expect(source).toContain("scripts/stage6-performance.mjs")
    expect(source).toContain('"--ci"')
    expect(source).toMatch(/process\.platform\s*===\s*"win32"/)
    expect(runner).toMatch(/if \(boundedCi\) \{\s*ensureNativeAbi\("node"\)/)
  })

  it("measures harness overhead in outlier-resistant fixed batches", () => {
    const batchDurations = [1, 1.1, 0.9, 50, 1.05]
    let batch = 0
    let call = 0
    const now = () => {
      const position = call++ % 3
      if (position === 0) return 100
      if (position === 1) return 100.1
      return 100 + batchDurations[batch++]!
    }

    expect(
      measureMonotonicClockHarnessOverhead({ now, batchCount: 5, callsPerBatch: 1 }),
    ).toBeCloseTo(1.05)
  })

  it("measures steady-state CPU after preparation over the default one-second window", async () => {
    const events: string[] = []
    let cpuRead = 0
    const observed = await measureSteadyStateCpu({
      prepare: async () => {
        events.push("prepare")
      },
      cpuUsage: () => {
        events.push(cpuRead === 0 ? "cpu-before" : "cpu-after")
        return cpuRead++ === 0 ? { user: 100, system: 100 } : { user: 15_625, system: 15_625 }
      },
      now: (() => {
        const values = [1_000, 2_000]
        return () => values.shift()!
      })(),
      wait: async (milliseconds) => {
        expect(milliseconds).toBe(1_000)
        events.push("idle-wait")
      },
    })

    expect(observed).toBe(3.125)
    expect(events).toEqual(["prepare", "cpu-before", "idle-wait", "cpu-after"])
  })

  it("waits a bounded number of turns for cleanup-owned resources to settle", async () => {
    const baseline = {
      total: 3,
      filesystem: 0,
      listeners: 2,
      watchers: 0,
      sockets: 1,
      processes: 0,
      timers: 0,
    }
    const observations = [
      { ...baseline, total: 5, sockets: 2, timers: 1 },
      { ...baseline, total: 4, sockets: 2 },
      baseline,
    ]
    let waits = 0

    const settled = await waitForResourceSettlement(baseline, {
      maximumAttempts: 3,
      snapshot: () => observations.shift()!,
      wait: async () => {
        waits += 1
      },
    })

    expect(settled).toEqual(baseline)
    expect(waits).toBe(2)
  })

  it("allows Windows PTY worker resources to settle beyond the old 475 ms window", async () => {
    const baseline = {
      total: 3,
      filesystem: 0,
      listeners: 2,
      watchers: 0,
      sockets: 1,
      processes: 0,
      timers: 0,
    }
    const pending = { ...baseline, total: 5, timers: 2 }
    let snapshots = 0
    let waits = 0

    const settled = await waitForResourceSettlement(baseline, {
      snapshot: () => (++snapshots <= 20 ? pending : baseline),
      wait: async () => {
        waits += 1
      },
    })

    expect(settled).toEqual(baseline)
    expect(waits).toBe(20)
  })

  it("counts all active resources in total while limiting sockets to TCP and UDP", () => {
    expect(
      classifyRuntimeResources(
        [
          "MessagePort",
          "MessagePort",
          "PipeWrap",
          "PipeWrap",
          "TCPSocketWrap",
          "Timeout",
          "ChildProcess",
        ],
        2,
      ),
    ).toEqual({
      total: 8,
      filesystem: 0,
      listeners: 2,
      watchers: 0,
      sockets: 1,
      processes: 1,
      timers: 1,
    })
  })

  it("makes bounded CI fail measured budget failures and requested omissions only", () => {
    expect(
      performanceCiFailureReasons({
        results: [
          { budgetId: "passing", evaluation: { status: "pass" } },
          { budgetId: "variance", evaluation: { status: "fail" } },
        ],
        omissions: [{ budgetId: "missing-seam" }],
        coverage: { complete: false, missingBudgetIds: ["outside-bounded-lane"] },
      }),
    ).toEqual([
      "failed performance budgets: variance",
      "omitted requested performance budgets: missing-seam",
    ])
    expect(
      performanceCiFailureReasons({
        results: [{ budgetId: "passing", evaluation: { status: "pass" } }],
        omissions: [],
        coverage: { complete: false, missingBudgetIds: ["outside-bounded-lane"] },
      }),
    ).toEqual([])
  })
})

function budgetFor(metric: (typeof REQUIRED_PERFORMANCE_METRICS)[number]) {
  return STAGE6_PERFORMANCE_BUDGETS.budgets.find(
    (budget) => budget.metric === metric && budget.buildType === "dev",
  )!
}
