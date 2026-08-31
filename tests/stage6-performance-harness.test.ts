import { describe, expect, it } from "vitest"
import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  PERFORMANCE_HARDWARE_CLASSES,
  PERFORMANCE_PLATFORMS,
  REQUIRED_PERFORMANCE_METRICS,
  STAGE6_PERFORMANCE_BUDGETS,
  evaluatePerformanceSamples,
  summarizePerformanceSamples,
  validatePerformanceBudgetCoverage,
  type PerformanceBudget,
} from "../src/main/lib/performance/budgets"
import {
  createPerformanceFixture,
  verifyPerformanceFixture,
} from "../src/main/lib/performance/fixtures"
import {
  createCandidateBinding,
  verifyCandidateBinding,
} from "../src/main/lib/performance/candidate"
import {
  conditionsForBudget,
  createPerformanceReport,
  parsePerformanceBudgetAuthority,
  parsePerformanceReport,
} from "../src/main/lib/performance/report"
import {
  runBuiltInProductPerformancePlan,
  runPerformancePlan,
} from "../src/main/lib/performance/runner"
import {
  createMonotonicDurationAdapter,
  createObservedValueAdapter,
} from "../src/main/lib/performance/adapters"
import { canonicalJson, sha256Bytes } from "../src/main/lib/performance/canonical"
import {
  REQUIRED_PRODUCT_PERFORMANCE_WORKFLOWS,
  validateRequiredPerformanceWorkflowCoverage,
} from "../src/main/lib/performance/workflows"
import {
  createProductPerformanceAdapters,
  durableAppendLatency,
  validateProductPerformanceAdapterCoverage,
  verifyPortableBackupContents,
} from "../src/main/lib/performance/product-adapters"
import {
  localProductPerformanceSupport,
  runLocalProductPerformancePlan,
} from "../src/main/lib/performance/product-runner"
import {
  STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS,
  STAGE6_HEADLESS_CORE_PERFORMANCE_METRICS,
  STAGE6_REQUIRED_EXPLICIT_OMISSIONS,
  STAGE6_REQUIRED_PRODUCT_SEAMS,
} from "../src/main/lib/performance/requirements"
import { createElectronPerformanceBuildIdentity } from "../src/main/lib/performance/electron-control"

const REQUIRED_PRODUCTION_SEAMS = STAGE6_REQUIRED_PRODUCT_SEAMS
const REQUIRED_EXPLICIT_OMISSIONS = STAGE6_REQUIRED_EXPLICIT_OMISSIONS

const testCandidate = createCandidateBinding({
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
  nodeVersion: "22.23.1",
  electronVersion: "39.8.10",
})

describe("Stage 6 deterministic performance authority", () => {
  it("generates byte-stable authoritative fixtures and rejects forged manifests or bytes", () => {
    const first = createPerformanceFixture("large")
    const second = createPerformanceFixture("large")

    expect(first.bytes.equals(second.bytes)).toBe(true)
    expect(first.manifest).toEqual(second.manifest)
    expect(first.manifest.byteLength).toBe(first.bytes.byteLength)
    expect(first.manifest.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(() => verifyPerformanceFixture(first.manifest, first.bytes)).not.toThrow()
    expect(() =>
      verifyPerformanceFixture({ ...first.manifest, sha256: "0".repeat(64) }, first.bytes),
    ).toThrow(/fixture.*digest/i)
    expect(() =>
      verifyPerformanceFixture(first.manifest, Buffer.concat([first.bytes, Buffer.from("x")])),
    ).toThrow(/fixture.*bytes|length|digest/i)
  })

  it("binds candidate/build metadata and detects any candidate field mutation", () => {
    expect(verifyCandidateBinding(testCandidate)).toEqual(testCandidate)
    expect(() => verifyCandidateBinding({ ...testCandidate, gitSha: "0".repeat(40) })).toThrow(
      /candidate.*binding/i,
    )
    expect(() =>
      createCandidateBinding({
        ...candidateInput(),
        logicalCores: 2,
        hardwareClass: "reference-desktop",
      }),
    ).toThrow(/hardware class/i)
  })

  it("accepts standard Azure Windows CPU model labels", () => {
    expect(() =>
      createCandidateBinding({
        ...candidateInput(),
        cpuModel: "Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz",
      }),
    ).not.toThrow()
  })

  it("revalidates package artifact invariants for externally parsed candidate bindings", () => {
    const payload = {
      ...candidateInput(),
      authority: "local-observed" as const,
      buildType: "package" as const,
      buildId: "package-without-artifact",
      artifact: null,
    }
    const forged = {
      ...payload,
      binding: {
        algorithm: "sha256" as const,
        digest: sha256Bytes(canonicalJson(payload)),
      },
    }

    expect(() => verifyCandidateBinding(forged)).toThrow(/package.*artifact/i)
  })

  it("does not let declarative callers mint locally observed candidate authority", () => {
    expect(() =>
      createCandidateBinding({
        ...candidateInput(),
        authority: "local-observed",
      }),
    ).toThrow(/observed.*capture|capture.*observed/i)
  })

  it("covers every required metric across build and declared hardware axes", () => {
    expect(validatePerformanceBudgetCoverage()).toEqual([])
    expect(STAGE6_PERFORMANCE_BUDGETS.authority).toMatchObject({
      status: "reviewed",
      reviewedEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(new Set(STAGE6_PERFORMANCE_BUDGETS.budgets.map((budget) => budget.scenario))).toEqual(
      new Set(["startup", "renderer", "storage-search", "streaming", "background", "concurrency"]),
    )
    for (const metric of REQUIRED_PERFORMANCE_METRICS) {
      const matching = STAGE6_PERFORMANCE_BUDGETS.budgets.filter(
        (budget) => budget.metric === metric,
      )
      expect(new Set(matching.map((budget) => budget.buildType))).toEqual(
        new Set(["dev", "package"]),
      )
      for (const hardwareClass of PERFORMANCE_HARDWARE_CLASSES) {
        expect(matching.some((budget) => budget.hardwareClasses.includes(hardwareClass))).toBe(true)
      }
    }
    expect(STAGE6_PERFORMANCE_BUDGETS.platforms).toEqual(PERFORMANCE_PLATFORMS)
  })

  it("requires a reviewed-evidence digest when budget authority is reviewed", () => {
    expect(
      parsePerformanceBudgetAuthority({
        status: "reviewed",
        reviewedEvidenceSha256: "a".repeat(64),
      }),
    ).toEqual({
      status: "reviewed",
      reviewedEvidenceSha256: "a".repeat(64),
    })
    expect(() =>
      parsePerformanceBudgetAuthority({
        status: "reviewed",
        reviewedEvidenceSha256: null,
      }),
    ).toThrow(/reviewed.*digest|sha256/i)
    expect(() =>
      parsePerformanceBudgetAuthority({
        status: "provisional-unreviewed",
        reviewedEvidenceSha256: "a".repeat(64),
      }),
    ).toThrow(/provisional|unreviewed|digest/i)

    const report = createPerformanceReport({
      budgetVersion: STAGE6_PERFORMANCE_BUDGETS.version,
      measuredAt: "2026-07-30T12:00:00.000Z",
      candidate: testCandidate,
      results: [],
      omissions: [],
    })
    const { integrity: _integrity, ...unsigned } = report
    const forgedUnsigned = {
      ...unsigned,
      budgetAuthority: {
        status: "reviewed" as const,
        reviewedEvidenceSha256: "a".repeat(64),
      },
    }
    const forged = {
      ...forgedUnsigned,
      integrity: {
        algorithm: "sha256" as const,
        digest: sha256Bytes(canonicalJson(forgedUnsigned)),
      },
    }
    expect(() => parsePerformanceReport(JSON.stringify(forged))).toThrow(
      /derived evidence|authority/i,
    )
  })

  it("covers the independent product workflow and methodology contract", () => {
    expect(validateRequiredPerformanceWorkflowCoverage()).toEqual([])
    expect(STAGE6_REQUIRED_PRODUCT_SEAMS).toEqual(REQUIRED_PRODUCTION_SEAMS)
    expect(STAGE6_REQUIRED_EXPLICIT_OMISSIONS).toEqual(REQUIRED_EXPLICIT_OMISSIONS)
    const workflows = new Map(
      REQUIRED_PRODUCT_PERFORMANCE_WORKFLOWS.map((workflow) => [workflow.metric, workflow]),
    )

    expect(
      Object.fromEntries(
        [...workflows.values()]
          .filter((workflow) => workflow.availability === "implemented")
          .map((workflow) => [workflow.metric, workflow.productionSeam]),
      ),
    ).toEqual(REQUIRED_PRODUCTION_SEAMS)
    for (const metric of REQUIRED_EXPLICIT_OMISSIONS) {
      expect(["unavailable", "requires-electron"]).toContain(workflows.get(metric)?.availability)
      expect(workflows.get(metric)?.unavailableReason).toMatch(
        /requires|unavailable|cannot|outside/i,
      )
    }
    expect(
      new Set([...Object.keys(REQUIRED_PRODUCTION_SEAMS), ...REQUIRED_EXPLICIT_OMISSIONS]),
    ).toEqual(new Set(REQUIRED_PERFORMANCE_METRICS))
  })

  it("uses sufficient warmups/repeats for p95 and evaluates unrounded values", () => {
    const p95Budget = {
      ...STAGE6_PERFORMANCE_BUDGETS.budgets.find((budget) => budget.aggregation === "p95")!,
      threshold: 100,
      allowedCoefficientVariationPercent: 100,
    }
    expect(p95Budget.minimumRepeats).toBeGreaterThanOrEqual(20)
    expect(p95Budget.minimumWarmups).toBeGreaterThanOrEqual(1)
    expect(
      evaluatePerformanceSamples(p95Budget, {
        warmupSamples: [1],
        measuredSamples: Array.from({ length: 20 }, () => 100.0004),
      }).status,
    ).toBe("fail")
    expect(
      evaluatePerformanceSamples(p95Budget, {
        warmupSamples: [],
        measuredSamples: Array.from({ length: 20 }, () => 90),
      }).reasons,
    ).toContainEqual(expect.stringMatching(/warmup/i))

    const safelyPassingCvResult = evaluatePerformanceSamples(
      { ...p95Budget, threshold: 1_000, allowedCoefficientVariationPercent: 20 },
      {
        warmupSamples: [1],
        measuredSamples: [...Array(10).fill(80), ...Array(10).fill(120.001)],
      },
    )
    expect(safelyPassingCvResult.summary.display.coefficientVariationPercent).toBe(20)
    expect(safelyPassingCvResult.summary.raw.coefficientVariationPercent).toBeGreaterThan(20)
    expect(safelyPassingCvResult.status).toBe("pass")

    const isolatedOutlierCvResult = evaluatePerformanceSamples(
      { ...p95Budget, threshold: 100, allowedCoefficientVariationPercent: 20 },
      {
        warmupSamples: [1],
        measuredSamples: [...Array(19).fill(50), 120.001],
      },
    )
    expect(isolatedOutlierCvResult.summary.raw.coefficientVariationPercent).toBeGreaterThan(20)
    expect(isolatedOutlierCvResult.status).toBe("pass")
    expect(isolatedOutlierCvResult.reasons).not.toContainEqual(
      expect.stringMatching(/coefficient variation/i),
    )

    const aggregateFailureCvResult = evaluatePerformanceSamples(
      { ...p95Budget, threshold: 100, allowedCoefficientVariationPercent: 20 },
      {
        warmupSamples: [1],
        measuredSamples: [...Array(18).fill(50), 120.001, 120.001],
      },
    )
    expect(aggregateFailureCvResult.status).toBe("fail")
    expect(aggregateFailureCvResult.reasons).toContainEqual(expect.stringMatching(/p95/i))
    expect(aggregateFailureCvResult.reasons).toContainEqual(
      expect.stringMatching(/coefficient variation/i),
    )
  })

  it("requires every repeat to sustain declared minimum capacities", () => {
    const capacityBudget = STAGE6_PERFORMANCE_BUDGETS.budgets.find(
      (budget) => budget.metric === "concurrent-agent-capacity" && budget.buildType === "dev",
    )!
    const result = evaluatePerformanceSamples(capacityBudget, {
      warmupSamples: Array.from({ length: capacityBudget.minimumWarmups }, () => 10),
      measuredSamples: [10, 10, 10, 10, 0],
    })

    expect(capacityBudget.aggregation).toBe("minimum")
    expect(result.status).toBe("fail")
  })

  it("records measured conditions, derives incomplete coverage, and rejects report tampering", () => {
    const budget = applicableBudgets()[0]!
    const report = createPerformanceReport({
      budgetVersion: STAGE6_PERFORMANCE_BUDGETS.version,
      measuredAt: "2026-07-26T12:00:00.000Z",
      candidate: testCandidate,
      results: [passingResult(budget)],
      omissions: [],
    })

    expect(report.results[0]!.conditions).toMatchObject({
      scenario: budget.scenario,
      metric: budget.metric,
      unit: budget.unit,
      aggregation: budget.aggregation,
      temperature: budget.temperature,
      measurementMethod: budget.measurementMethod,
    })
    expect(report.coverage.complete).toBe(false)
    expect(report.evidenceStatus).toBe("incomplete")
    expect(report.integrity.digest).toMatch(/^[a-f0-9]{64}$/)

    const tampered = structuredClone(report)
    tampered.results[0]!.samples.measuredSamples[0] = 0
    expect(() => parsePerformanceReport(JSON.stringify(tampered))).toThrow(/report.*digest/i)
  })

  it("derives complete coverage but never accepts test candidate evidence", () => {
    const report = createPerformanceReport({
      budgetVersion: STAGE6_PERFORMANCE_BUDGETS.version,
      measuredAt: "2026-07-26T12:00:00.000Z",
      candidate: testCandidate,
      results: applicableBudgets().map(passingResult),
      omissions: [],
    })

    expect(report.coverage.complete).toBe(true)
    expect(report.results.every((result) => result.evaluation.status === "pass")).toBe(true)
    expect(report.evidenceStatus).toBe("untrusted")
    expect(report.budgetAuthority.status).toBe("reviewed")
  })

  it("rejects duplicate results and supports bounded evidence-digested exceptions", () => {
    const budget = applicableBudgets()[0]!
    expect(() =>
      createPerformanceReport({
        budgetVersion: STAGE6_PERFORMANCE_BUDGETS.version,
        measuredAt: "2026-07-26T12:00:00.000Z",
        candidate: testCandidate,
        results: [passingResult(budget), passingResult(budget)],
        omissions: [],
      }),
    ).toThrow(/duplicate/i)

    const failed = failingResult(budget)
    const reviewedEvidenceBytes = Buffer.from("reviewed deterministic performance evidence")
    const reviewedEvidenceSha256 = createHash("sha256").update(reviewedEvidenceBytes).digest("hex")
    const report = createPerformanceReport({
      budgetVersion: STAGE6_PERFORMANCE_BUDGETS.version,
      measuredAt: "2026-07-26T12:00:00.000Z",
      candidate: testCandidate,
      results: [
        {
          ...failed,
          exception: {
            owner: "performance-owner",
            rationale: "Reviewed deterministic environment limitation.",
            expiresAt: "2099-08-26T12:00:00.000Z",
            reviewedEvidence: "stage6-performance-review.json",
            reviewedEvidenceSha256,
            reviewedEvidenceByteLength: reviewedEvidenceBytes.byteLength,
          },
          exceptionEvidenceBytes: reviewedEvidenceBytes,
        },
      ],
      omissions: [],
    })
    expect(report.results[0]!.evaluation.status).toBe("exception")
    expect(report.results[0]!.exception?.reviewedEvidenceSha256).toBe(reviewedEvidenceSha256)
    expect(parsePerformanceReport(JSON.stringify(report))).toEqual(report)
  })

  it("embeds exception evidence and rejects exceptions that are expired when parsed", () => {
    const budget = applicableBudgets()[0]!
    const failed = failingResult(budget)
    const reviewedEvidenceBytes = Buffer.from("historical reviewed performance evidence")
    const reviewedEvidenceSha256 = createHash("sha256").update(reviewedEvidenceBytes).digest("hex")
    const report = createPerformanceReport({
      budgetVersion: STAGE6_PERFORMANCE_BUDGETS.version,
      measuredAt: "2020-01-01T00:00:00.000Z",
      candidate: testCandidate,
      results: [
        {
          ...failed,
          exception: {
            owner: "performance-owner",
            rationale: "Historical exception that must no longer be accepted.",
            expiresAt: "2021-01-01T00:00:00.000Z",
            reviewedEvidence: "stage6-expired-review.json",
            reviewedEvidenceSha256,
            reviewedEvidenceByteLength: reviewedEvidenceBytes.byteLength,
          },
          exceptionEvidenceBytes: reviewedEvidenceBytes,
        },
      ],
      omissions: [],
    })

    expect(report.results[0]).toHaveProperty(
      "exceptionEvidenceBase64",
      reviewedEvidenceBytes.toString("base64"),
    )
    expect(report.results[0]!.evaluation.status).toBe("fail")
    expect(() => parsePerformanceReport(JSON.stringify(report))).toThrow(/expired/i)
  })

  it("reverifies embedded exception evidence even when the report digest is recomputed", () => {
    const budget = applicableBudgets()[0]!
    const reviewedEvidenceBytes = Buffer.from("reviewed evidence bytes")
    const reviewedEvidenceSha256 = createHash("sha256").update(reviewedEvidenceBytes).digest("hex")
    const report = createPerformanceReport({
      budgetVersion: STAGE6_PERFORMANCE_BUDGETS.version,
      measuredAt: "2026-07-26T12:00:00.000Z",
      candidate: testCandidate,
      results: [
        {
          ...failingResult(budget),
          exception: {
            owner: "performance-owner",
            rationale: "Bounded reviewed exception.",
            expiresAt: "2099-08-26T12:00:00.000Z",
            reviewedEvidence: "stage6-performance-review.json",
            reviewedEvidenceSha256,
            reviewedEvidenceByteLength: reviewedEvidenceBytes.byteLength,
          },
          exceptionEvidenceBytes: reviewedEvidenceBytes,
        },
      ],
      omissions: [],
    })
    const tampered = structuredClone(report)
    tampered.results[0]!.exceptionEvidenceBase64 = Buffer.from("forged evidence").toString("base64")
    const { integrity: _integrity, ...unsigned } = tampered
    tampered.integrity.digest = sha256Bytes(canonicalJson(unsigned))

    expect(() => parsePerformanceReport(JSON.stringify(tampered))).toThrow(/evidence.*digest/i)
  })

  it("bounds total embedded exception evidence to the report size limit", () => {
    const evidence = [Buffer.alloc(800_000, "a"), Buffer.alloc(800_000, "b")]
    const results = applicableBudgets()
      .slice(0, 2)
      .map((budget, index) => ({
        ...failingResult(budget),
        exception: {
          owner: "performance-owner",
          rationale: "Reviewed exception evidence must remain report-bounded.",
          expiresAt: "2099-08-26T12:00:00.000Z",
          reviewedEvidence: `stage6-performance-review-${index}.json`,
          reviewedEvidenceSha256: sha256Bytes(evidence[index]!),
          reviewedEvidenceByteLength: evidence[index]!.byteLength,
        },
        exceptionEvidenceBytes: evidence[index],
      }))

    expect(() =>
      createPerformanceReport({
        budgetVersion: STAGE6_PERFORMANCE_BUDGETS.version,
        measuredAt: "2026-07-26T12:00:00.000Z",
        candidate: testCandidate,
        results,
        omissions: [],
      }),
    ).toThrow(/report.*size|report.*bytes/i)
  })

  it("runner adapters report unavailable capabilities without fabricating results", async () => {
    const budget = applicableBudgets()[0]!
    const outcome = await runPerformancePlan({
      candidate: testCandidate,
      budgetIds: [budget.id],
      measuredAt: "2026-07-26T12:00:00.000Z",
      adapters: [],
    })

    expect(outcome.report.results).toEqual([])
    expect(outcome.report.coverage.complete).toBe(false)
    expect(outcome.report.evidenceStatus).toBe("incomplete")
    expect(outcome.report.omissions).toEqual([
      expect.objectContaining({ budgetId: budget.id, reason: expect.stringMatching(/adapter/i) }),
    ])
  })

  it("runner refuses self-asserted local candidate authority", async () => {
    const payload = {
      ...candidateInput(),
      authority: "local-observed" as const,
    }
    const forgedCandidate = {
      ...payload,
      binding: {
        algorithm: "sha256" as const,
        digest: sha256Bytes(canonicalJson(payload)),
      },
    }

    await expect(
      runPerformancePlan({
        candidate: forgedCandidate,
        budgetIds: [applicableBudgets()[0]!.id],
        measuredAt: "2026-07-26T12:00:00.000Z",
        adapters: [],
      }),
    ).rejects.toThrow(/not captured|local capture/i)
  })

  it("runner adapters cannot relabel measured conditions", async () => {
    const budget = applicableBudgets()[0]!
    const outcome = await runPerformancePlan({
      candidate: testCandidate,
      budgetIds: [budget.id],
      measuredAt: "2026-07-26T12:00:00.000Z",
      adapters: [
        {
          id: "forged-condition-adapter",
          supports: () => ({ supported: true }),
          measure: async ({ fixtureSha256 }) => ({
            fixtureSha256,
            conditions: { ...conditionsFor(budget), measurementMethod: "forged-method" },
            samples: passingResult(budget).samples,
          }),
        },
      ],
    })

    expect(outcome.report.results).toEqual([])
    expect(outcome.report.omissions).toEqual([
      expect.objectContaining({
        budgetId: budget.id,
        adapterId: "forged-condition-adapter",
        reason: expect.stringMatching(/condition/i),
      }),
    ])
  })

  it("runner adapters bind successful samples to the authoritative fixture and conditions", async () => {
    const budget = applicableBudgets()[0]!
    const outcome = await runPerformancePlan({
      candidate: testCandidate,
      budgetIds: [budget.id],
      measuredAt: "2026-07-26T12:00:00.000Z",
      adapters: [
        {
          id: "deterministic-unit-adapter",
          supports: () => ({ supported: true }),
          measure: async ({ fixtureSha256 }) => ({
            fixtureSha256,
            conditions: conditionsFor(budget),
            samples: passingResult(budget).samples,
          }),
        },
      ],
    })

    expect(outcome.report.results).toHaveLength(1)
    expect(outcome.report.results[0]).toMatchObject({
      budgetId: budget.id,
      evaluation: { status: "pass" },
      provenance: {
        authority: "untrusted-adapter",
        adapterId: "deterministic-unit-adapter",
        productionSeam: null,
        binding: { algorithm: "sha256", digest: expect.stringMatching(/^[a-f0-9]{64}$/) },
      },
    })
    expect(outcome.report.evidenceStatus).toBe("incomplete")
  })

  it("persists and integrity-binds the exact observed Electron build identity", async () => {
    const budget = applicableBudgets().find((entry) => entry.metric === "input-response")!
    const runtimeBuildIdentity = createElectronPerformanceBuildIdentity({
      appVersion: "1.2.3",
      electronVersion: testCandidate.electronVersion!,
      buildType: testCandidate.buildType,
      executableSha256: "a".repeat(64),
      applicationSha256: "b".repeat(64),
      rendererProcessId: 42,
    })
    const samples = passingResult(budget).samples
    const runtimeRendererProcessIds = Array.from(
      { length: samples.warmupSamples.length + samples.measuredSamples.length },
      (_, index) => 42 + index,
    )
    const runtimeBuildIdentities = runtimeRendererProcessIds.map((rendererProcessId) =>
      createElectronPerformanceBuildIdentity({
        appVersion: "1.2.3",
        electronVersion: testCandidate.electronVersion!,
        buildType: testCandidate.buildType,
        executableSha256: "a".repeat(64),
        applicationSha256: "b".repeat(64),
        rendererProcessId,
      }),
    )
    const outcome = await runPerformancePlan({
      candidate: testCandidate,
      budgetIds: [budget.id],
      measuredAt: "2026-07-26T12:00:00.000Z",
      adapters: [
        {
          id: "electron-observer-test",
          supports: () => ({ supported: true }),
          measure: async ({ fixtureSha256 }) => ({
            fixtureSha256,
            conditions: conditionsFor(budget),
            samples,
            runtimeBuildIdentity,
            runtimeBuildIdentities,
            runtimeRendererProcessIds,
          }),
        },
      ],
    })

    expect(outcome.report.results[0]?.runtimeBuildIdentity).toEqual(runtimeBuildIdentity)
    expect(outcome.report.results[0]?.runtimeBuildIdentities).toEqual(runtimeBuildIdentities)
    expect(outcome.report.results[0]?.runtimeRendererProcessIds).toEqual(runtimeRendererProcessIds)
    const tampered = structuredClone(outcome.report)
    tampered.results[0]!.runtimeBuildIdentity!.applicationSha256 = "c".repeat(64)
    const { integrity: _integrity, ...unsigned } = tampered
    tampered.integrity.digest = sha256Bytes(canonicalJson(unsigned))
    expect(() => parsePerformanceReport(JSON.stringify(tampered))).toThrow(
      /build identity|identity.*digest/i,
    )
    const tamperedSample = structuredClone(outcome.report)
    tamperedSample.results[0]!.runtimeBuildIdentities![1]!.applicationSha256 = "d".repeat(64)
    const { integrity: _sampleIntegrity, ...sampleUnsigned } = tamperedSample
    tamperedSample.integrity.digest = sha256Bytes(canonicalJson(sampleUnsigned))
    expect(() => parsePerformanceReport(JSON.stringify(tamperedSample))).toThrow(
      /build identity|identity.*digest/i,
    )
  })

  it("rejects arbitrary adapters from built-in product evidence", async () => {
    const budget = applicableBudgets().find((entry) => entry.metric === "scoped-query")!

    await expect(
      runBuiltInProductPerformancePlan({
        candidate: testCandidate,
        budgetIds: [budget.id],
        measuredAt: "2026-07-26T12:00:00.000Z",
        adapters: [
          {
            id: "stage6-windows-product-seams",
            supports: () => ({ supported: true }),
            measure: async ({ fixtureSha256 }) => ({
              fixtureSha256,
              conditions: conditionsFor(budget),
              samples: passingResult(budget).samples,
            }),
          },
        ],
      }),
    ).rejects.toThrow(/built-in.*adapter|product.*adapter/i)
  })

  it("binds built-in results to the fixed production seam and rejects seam tampering", async () => {
    const budget = applicableBudgets().find((entry) => entry.metric === "scoped-query")!
    const outcome = await runBuiltInProductPerformancePlan({
      candidate: testCandidate,
      budgetIds: [budget.id],
      measuredAt: "2026-07-26T12:00:00.000Z",
      adapters: createProductPerformanceAdapters({
        allowTestCandidate: true,
        testRecordLimit: 8,
      }),
    })

    expect(outcome.report.results[0]?.provenance).toMatchObject({
      authority: "built-in-product",
      adapterId: "stage6-windows-product-seams",
      productionSeam: REQUIRED_PRODUCTION_SEAMS["scoped-query"],
      binding: { algorithm: "sha256", digest: expect.stringMatching(/^[a-f0-9]{64}$/) },
    })

    const tampered = structuredClone(outcome.report)
    tampered.results[0]!.provenance.productionSeam = "createPortableDatabase"
    const { integrity: _integrity, ...unsigned } = tampered
    tampered.integrity.digest = sha256Bytes(canonicalJson(unsigned))
    expect(() => parsePerformanceReport(JSON.stringify(tampered))).toThrow(
      /production seam|provenance/i,
    )
  })

  it("does not let direct report callers declare built-in product authority", () => {
    const budget = applicableBudgets().find((entry) => entry.metric === "scoped-query")!
    const base = {
      budgetVersion: STAGE6_PERFORMANCE_BUDGETS.version,
      measuredAt: "2026-07-26T12:00:00.000Z",
      candidate: testCandidate,
      omissions: [],
    }

    expect(() =>
      createPerformanceReport({
        ...base,
        results: [
          {
            ...passingResult(budget),
            provenance: {
              authority: "built-in-product",
              adapterId: "stage6-windows-product-seams",
              productionSeam: REQUIRED_PRODUCTION_SEAMS["scoped-query"],
            },
          },
        ],
      }),
    ).toThrow(/opaque.*capability|declarative.*authority|built-in.*capability/i)

    expect(() =>
      createPerformanceReport({
        ...base,
        results: [
          {
            ...passingResult(budget),
            builtInCapability: {},
          },
        ],
      }),
    ).toThrow(/opaque.*capability/i)
  })

  it("downgrades reloaded built-in provenance instead of restoring process authority", async () => {
    const budget = applicableBudgets().find((entry) => entry.metric === "scoped-query")!
    const outcome = await runBuiltInProductPerformancePlan({
      candidate: testCandidate,
      budgetIds: [budget.id],
      measuredAt: "2026-07-26T12:00:00.000Z",
      adapters: createProductPerformanceAdapters({
        allowTestCandidate: true,
        testRecordLimit: 8,
      }),
    })

    expect(outcome.report.results[0]!.provenance.authority).toBe("built-in-product")
    const reloaded = parsePerformanceReport(JSON.stringify(outcome.report))
    expect(reloaded.results[0]!.provenance).toMatchObject({
      authority: "persisted-untrusted",
      adapterId: "stage6-windows-product-seams",
      productionSeam: REQUIRED_PRODUCTION_SEAMS["scoped-query"],
    })
    expect(reloaded.integrity.digest).not.toBe(outcome.report.integrity.digest)
  })

  it("does not register caller-selected repository roots as built-in evidence", () => {
    expect(() =>
      createProductPerformanceAdapters({
        allowTestCandidate: true,
        repositoryRoot: join(tmpdir(), "caller-selected-repository"),
      } as never),
    ).toThrow(/repository root.*not accepted|canonical repository/i)
  })

  it("observed-value adapters execute the declared warmup and repeat protocol", async () => {
    const budget = applicableBudgets().find((entry) => entry.unit === "count")!
    const phases: string[] = []
    const adapter = createObservedValueAdapter({
      id: "observed-counter-adapter",
      budgetIds: [budget.id],
      observe: async ({ phase }) => {
        phases.push(phase)
        return budget.direction === "at-most" ? 0 : budget.threshold
      },
    })
    const outcome = await runPerformancePlan({
      candidate: testCandidate,
      budgetIds: [budget.id],
      measuredAt: "2026-07-26T12:00:00.000Z",
      adapters: [adapter],
    })

    expect(phases.filter((phase) => phase === "warmup")).toHaveLength(budget.minimumWarmups)
    expect(phases.filter((phase) => phase === "measured")).toHaveLength(budget.minimumRepeats)
    expect(outcome.report.results[0]!.evaluation.status).toBe("pass")
  })

  it("keeps caller-supplied generic adapters test-only", () => {
    const budget = applicableBudgets()[0]!
    const payload = {
      ...candidateInput(),
      authority: "local-observed" as const,
    }
    const forgedLocalCandidate = {
      ...payload,
      binding: {
        algorithm: "sha256" as const,
        digest: sha256Bytes(canonicalJson(payload)),
      },
    }
    const adapters = [
      createObservedValueAdapter({
        id: "generic-value",
        budgetIds: [budget.id],
        observe: () => 0,
      }),
      createMonotonicDurationAdapter({
        id: "generic-duration",
        budgetIds: [budget.id],
        operation: () => undefined,
      }),
    ]

    for (const adapter of adapters) {
      expect(adapter.supports(budget, forgedLocalCandidate)).toEqual({
        supported: false,
        reason: expect.stringMatching(/test-only|test candidate/i),
      })
    }
  })

  it("binds every implemented workflow to real Windows and macOS development adapters", () => {
    const adapters = createProductPerformanceAdapters({
      allowTestCandidate: true,
      testRecordLimit: 32,
      testStreamEventLimit: 128,
    })
    const darwinCandidate = createCandidateBinding({
      ...candidateInput(),
      platform: "darwin",
      osRelease: "24.6.0",
      architecture: "arm64",
      hardwareClass: "reference-laptop",
      powerProfile: "balanced-ac",
      cpuModel: "Apple M2",
    })

    expect(validateProductPerformanceAdapterCoverage(adapters, testCandidate)).toEqual([])
    expect(validateProductPerformanceAdapterCoverage(adapters, darwinCandidate)).toEqual([])
    for (const metric of Object.keys(REQUIRED_PRODUCTION_SEAMS)) {
      const budget = applicableBudgets().find((entry) => entry.metric === metric)!
      const supported = adapters.some(
        (adapter) => adapter.supports(budget, testCandidate).supported,
      )
      expect(supported).toBe(!STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS.includes(metric as never))
    }
    for (const metric of REQUIRED_EXPLICIT_OMISSIONS) {
      const budget = applicableBudgets().find((entry) => entry.metric === metric)!
      expect(adapters.some((adapter) => adapter.supports(budget, testCandidate).supported)).toBe(
        false,
      )
    }
  })

  it("runs only fixed real migration, activity, stream, and portability seams", async () => {
    const metrics = STAGE6_HEADLESS_CORE_PERFORMANCE_METRICS
    const budgets = metrics.map((metric) =>
      applicableBudgets().find((entry) => entry.metric === metric)!,
    )
    const outcome = await runBuiltInProductPerformancePlan({
      candidate: testCandidate,
      budgetIds: budgets.map((budget) => budget.id),
      measuredAt: "2026-07-26T12:00:00.000Z",
      adapters: createProductPerformanceAdapters({
        allowTestCandidate: true,
        testRecordLimit: 32,
        testStreamEventLimit: 128,
      }),
    })

    expect(outcome.report.results.map((result) => result.budgetId)).toEqual(
      budgets.map((budget) => budget.id),
    )
    expect(outcome.report.omissions).toEqual([])
    expect(
      outcome.report.results.every((result) => result.samples.measuredSamples.length >= 5),
    ).toBe(true)
    expect(outcome.report.evidenceStatus).toBe("incomplete")
  }, 480_000)

  it("supports Windows and macOS headless dev capture while package lanes remain unavailable", () => {
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
    expect(localProductPerformanceSupport({ platform: "win32", buildType: "package" })).toEqual({
      supported: false,
      reason: expect.stringMatching(/unavailable.*exact package/i),
    })
  })

  it("rejects caller-supplied build labels instead of treating them as observed evidence", async () => {
    await expect(
      runLocalProductPerformancePlan({
        buildType: "package",
        hardwareClass: "reference-desktop",
        buildId: "caller-asserted-build",
        electronVersion: "39.8.10",
        artifactPath: "caller-asserted-package.exe",
      } as never),
    ).rejects.toThrow(/caller-supplied.*not accepted/i)
  })

  it("rejects caller control of product adapters and migration authority", async () => {
    await expect(
      runLocalProductPerformancePlan({
        buildType: "package",
        hardwareClass: "reference-desktop",
        adapters: [],
        migrationsFolder: join(tmpdir(), "caller-migrations"),
        adapterOptions: { migrationsFolder: join(tmpdir(), "nested-caller-migrations") },
      } as never),
    ).rejects.toThrow(/caller-supplied.*adapter|migration.*not accepted/i)
  })

  it("measures append durability latency as commit completion, never batch time per event", () => {
    expect(durableAppendLatency(10, 35)).toBe(25)
    expect(() => durableAppendLatency(35, 10)).toThrow(/clock|latency/i)
  })

  it("rejects portable backups with incomplete expected records or content", () => {
    expect(verifyPortableBackupContents).toBeTypeOf("function")
    const root = mkdtempSync(join(tmpdir(), "flapstack-backup-adversary-"))
    const destinationPath = join(root, "incomplete.sqlite")
    const database = new Database(destinationPath)
    try {
      database.exec(`
        CREATE TABLE portable_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        CREATE TABLE portable_records (
          scope_id TEXT NOT NULL,
          table_name TEXT NOT NULL,
          identity_json TEXT NOT NULL,
          row_json TEXT NOT NULL,
          PRIMARY KEY (scope_id, table_name, identity_json)
        );
        INSERT INTO portable_metadata (key, value) VALUES ('schema_version', '1');
        INSERT INTO portable_records (scope_id, table_name, identity_json, row_json)
        VALUES (
          'projects',
          'projects',
          '{"id":"performance-project"}',
          '{"id":"performance-project","name":"Performance Project","path":"redacted"}'
        );
      `)
    } finally {
      database.close()
    }

    try {
      expect(() =>
        verifyPortableBackupContents(destinationPath, {
          expectedRecordCount: 3,
          expectedHistoryGroups: 1,
          expectedMessageCount: 8,
          fixtureSeed: 20260726,
        }),
      ).toThrow(/record count|incomplete|content/i)

      const malformed = new Database(destinationPath)
      try {
        malformed
          .prepare(
            `INSERT INTO portable_records
             (scope_id, table_name, identity_json, row_json)
             VALUES (?, ?, ?, ?)`,
          )
          .run(
            "history",
            "chats",
            '{"id":"wrong-chat"}',
            '{"id":"wrong-chat","project_id":"performance-project"}',
          )
        malformed
          .prepare(
            `INSERT INTO portable_records
             (scope_id, table_name, identity_json, row_json)
             VALUES (?, ?, ?, ?)`,
          )
          .run(
            "history",
            "sub_chats",
            '{"id":"wrong-subchat"}',
            '{"id":"wrong-subchat","chat_id":"wrong-chat","messages":"[]"}',
          )
      } finally {
        malformed.close()
      }
      expect(() =>
        verifyPortableBackupContents(destinationPath, {
          expectedRecordCount: 3,
          expectedHistoryGroups: 1,
          expectedMessageCount: 8,
          fixtureSeed: 20260726,
        }),
      ).toThrow(/identities|relations|message|content/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("parses non-Windows reports as evidence without pretending local capture support", () => {
    const candidate = createCandidateBinding({
      ...candidateInput(),
      platform: "darwin",
      osRelease: "23.6.0",
      architecture: "arm64",
      hardwareClass: "reference-laptop",
      powerProfile: "balanced-ac",
      cpuModel: "Apple M2",
    })
    const budget = STAGE6_PERFORMANCE_BUDGETS.budgets.find(
      (entry) => entry.buildType === "dev" && entry.metric === "shell-ready",
    )!
    const fixture = createPerformanceFixture(budget.dataset)
    const value = budget.threshold / 2
    const report = createPerformanceReport({
      budgetVersion: STAGE6_PERFORMANCE_BUDGETS.version,
      measuredAt: "2026-07-26T12:00:00.000Z",
      candidate,
      results: [
        {
          budgetId: budget.id,
          fixture: fixture.manifest,
          fixtureBytes: fixture.bytes,
          conditions: conditionsForBudget(budget, candidate),
          samples: {
            warmupSamples: Array.from({ length: budget.minimumWarmups }, () => value),
            measuredSamples: Array.from({ length: budget.minimumRepeats }, () => value),
          },
        },
      ],
      omissions: [],
    })

    expect(parsePerformanceReport(JSON.stringify(report))).toEqual(report)
    expect(report.evidenceStatus).toBe("incomplete")
  })

  it("preserves exact unavailable methodology reasons in runner omissions", async () => {
    const budget = applicableBudgets().find((entry) => entry.metric === "trace-capture")!
    const outcome = await runPerformancePlan({
      candidate: testCandidate,
      budgetIds: [budget.id],
      measuredAt: "2026-07-26T12:00:00.000Z",
      adapters: createProductPerformanceAdapters({ allowTestCandidate: true }),
    })

    expect(outcome.report.omissions).toEqual([
      expect.objectContaining({
        budgetId: budget.id,
        adapterId: "stage6-windows-product-seams",
        reason: expect.stringMatching(/native trace.*core lane/i),
      }),
    ])
  })

  it("executes every fixed headless production seam without adapter omissions", async () => {
    const metrics = STAGE6_HEADLESS_CORE_PERFORMANCE_METRICS
    const budgets = metrics.map((metric) =>
      applicableBudgets().find((entry) => entry.metric === metric)!,
    )
    const outcome = await runBuiltInProductPerformancePlan({
      candidate: testCandidate,
      budgetIds: budgets.map((budget) => budget.id),
      measuredAt: "2026-07-26T12:00:00.000Z",
      adapters: createProductPerformanceAdapters({
        allowTestCandidate: true,
        testRecordLimit: 8,
        testStreamEventLimit: 32,
      }),
    })

    expect(outcome.report.omissions).toEqual([])
    expect(outcome.report.results.map((result) => result.budgetId)).toEqual(
      budgets.map((budget) => budget.id),
    )
  }, 480_000)

  it("cleans fixture roots when preparation fails before a database opens", async () => {
    const before = new Set(
      readdirSync(tmpdir()).filter((entry) => entry.startsWith("flapstack-performance-")),
    )
    const budget = applicableBudgets().find((entry) => entry.metric === "migration-upgrade")!
    const outcome = await runPerformancePlan({
      candidate: testCandidate,
      budgetIds: [budget.id],
      measuredAt: "2026-07-26T12:00:00.000Z",
      adapters: createProductPerformanceAdapters({
        allowTestCandidate: true,
        testMigrationsFolder: join(tmpdir(), "missing-flapstack-migrations"),
      }),
    })
    const leaked = readdirSync(tmpdir()).filter(
      (entry) => entry.startsWith("flapstack-performance-") && !before.has(entry),
    )
    try {
      expect(outcome.report.results).toEqual([])
      expect(outcome.report.omissions[0]?.reason).toMatch(/migration|journal|directory|no such/i)
      expect(leaked).toEqual([])
    } finally {
      for (const entry of leaked) {
        rmSync(join(tmpdir(), entry), { recursive: true, force: true })
      }
    }
  })

  it("still computes explicit nearest-rank p95 and population CV summaries", () => {
    expect(
      summarizePerformanceSamples({
        warmupSamples: [9_999],
        measuredSamples: [80, 100, 120, 90, 110],
      }).display,
    ).toEqual({
      repeats: 5,
      minimum: 80,
      maximum: 120,
      median: 100,
      p95: 120,
      mean: 100,
      coefficientVariationPercent: 14.142,
    })
  })
})

function candidateInput() {
  const { binding: _binding, ...input } = testCandidate
  return input
}

function applicableBudgets(): PerformanceBudget[] {
  return STAGE6_PERFORMANCE_BUDGETS.budgets.filter(
    (budget) =>
      budget.buildType === testCandidate.buildType &&
      budget.platforms.includes(testCandidate.platform) &&
      budget.hardwareClasses.includes(testCandidate.hardwareClass),
  )
}

function passingResult(budget: PerformanceBudget) {
  const fixture = createPerformanceFixture(budget.dataset)
  const value =
    budget.direction === "at-most" ? Math.max(0, budget.threshold / 2) : budget.threshold
  return {
    budgetId: budget.id,
    fixture: fixture.manifest,
    fixtureBytes: fixture.bytes,
    conditions: conditionsFor(budget),
    samples: {
      warmupSamples: Array.from({ length: budget.minimumWarmups }, () => value),
      measuredSamples: Array.from({ length: budget.minimumRepeats }, () => value),
    },
  }
}

function failingResult(budget: PerformanceBudget) {
  const fixture = createPerformanceFixture(budget.dataset)
  const value =
    budget.direction === "at-most" ? budget.threshold + 1 : Math.max(0, budget.threshold - 1)
  return {
    budgetId: budget.id,
    fixture: fixture.manifest,
    fixtureBytes: fixture.bytes,
    conditions: conditionsFor(budget),
    samples: {
      warmupSamples: Array.from({ length: budget.minimumWarmups }, () => value),
      measuredSamples: Array.from({ length: budget.minimumRepeats }, () => value),
    },
  }
}

function conditionsFor(budget: PerformanceBudget) {
  return {
    scenario: budget.scenario,
    dataset: budget.dataset,
    buildType: budget.buildType,
    temperature: budget.temperature,
    metric: budget.metric,
    unit: budget.unit,
    aggregation: budget.aggregation,
    measurementMethod: budget.measurementMethod,
    platform: testCandidate.platform,
    hardwareClass: testCandidate.hardwareClass,
  }
}
