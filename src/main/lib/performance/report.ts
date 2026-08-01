import { z } from "zod"
import {
  PERFORMANCE_BUILD_TYPES,
  PERFORMANCE_HARDWARE_CLASSES,
  PERFORMANCE_PLATFORMS,
  PERFORMANCE_SCENARIOS,
  REQUIRED_PERFORMANCE_METRICS,
  STAGE6_PERFORMANCE_BUDGETS,
  evaluatePerformanceSamples,
  type PerformanceAggregation,
  type PerformanceBudgetAuthority,
  type PerformanceBudget,
  type PerformanceException,
  type PerformanceSampleSet,
  type PerformanceTemperature,
  type PerformanceUnit,
} from "./budgets"
import { candidateBindingSchema, verifyCandidateBinding, type CandidateBinding } from "./candidate"
import { canonicalJson, sha256Bytes } from "./canonical"
import { conditionsForBudget, type PerformanceConditions } from "./conditions"
import {
  createPerformanceFixture,
  performanceFixtureManifestSchema,
  verifyPerformanceFixture,
  type PerformanceFixtureManifest,
} from "./fixtures"
import {
  STAGE6_CAPABILITY_PERFORMANCE_METRICS,
  STAGE6_CORE_DEV_PERFORMANCE_METRICS,
  STAGE6_REQUIRED_PRODUCT_SEAMS,
} from "./requirements"
import {
  consumeBuiltInMeasurementCapability,
  type BuiltInMeasurementCapability,
} from "./product-adapters"
import { verifyReviewedPerformanceBudgetAuthority } from "./budget-review"
import {
  verifyElectronPerformanceBuildIdentity,
  type ElectronPerformanceBuildIdentity,
} from "./electron-control"

const MAX_REPORT_BYTES = 2_000_000
const MAX_RESULTS = STAGE6_PERFORMANCE_BUDGETS.supportLimits.maxResultsPerReport
const MAX_SAMPLES = STAGE6_PERFORMANCE_BUDGETS.supportLimits.maxMeasuredSamplesPerResult
const MAX_OMISSIONS = STAGE6_PERFORMANCE_BUDGETS.supportLimits.maxOmissionsPerReport
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/

export const PERFORMANCE_REPORT_LANES = ["all", "core", "capability"] as const
export type PerformanceReportLane = (typeof PERFORMANCE_REPORT_LANES)[number]

const performanceBudgetAuthoritySchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("provisional-unreviewed"),
      reviewedEvidenceSha256: z.null(),
    })
    .strict(),
  z
    .object({
      status: z.literal("reviewed"),
      reviewedEvidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
])

export function parsePerformanceBudgetAuthority(input: unknown): PerformanceBudgetAuthority {
  const parsed = performanceBudgetAuthoritySchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(
      "Reviewed performance budget authority requires a SHA-256 reviewed-evidence digest; provisional authority cannot claim one.",
    )
  }
  return parsed.data
}

export const performanceConditionsSchema = z
  .object({
    scenario: z.enum(PERFORMANCE_SCENARIOS),
    dataset: z.enum(["small", "medium", "large", "stress"]),
    buildType: z.enum(PERFORMANCE_BUILD_TYPES),
    temperature: z.enum(["cold", "warm", "steady", "soak"]),
    metric: z.enum(REQUIRED_PERFORMANCE_METRICS),
    unit: z.enum(["milliseconds", "percent", "bytes", "count"]),
    aggregation: z.enum(["minimum", "median", "p95", "maximum", "mean"]),
    measurementMethod: z.string().min(1).max(240),
    platform: z.enum(PERFORMANCE_PLATFORMS),
    hardwareClass: z.enum(PERFORMANCE_HARDWARE_CLASSES),
  })
  .strict()

const sampleSetSchema = z
  .object({
    warmupSamples: z.array(z.number().finite().nonnegative()).max(MAX_SAMPLES),
    measuredSamples: z.array(z.number().finite().nonnegative()).min(1).max(MAX_SAMPLES),
  })
  .strict()

const summarySchema = z
  .object({
    repeats: z.number().int().positive().max(MAX_SAMPLES),
    minimum: z.number().finite().nonnegative(),
    maximum: z.number().finite().nonnegative(),
    median: z.number().finite().nonnegative(),
    p95: z.number().finite().nonnegative(),
    mean: z.number().finite().nonnegative(),
    coefficientVariationPercent: z.number().finite().nonnegative(),
  })
  .strict()

const exceptionSchema = z
  .object({
    owner: z.string().trim().min(1).max(120),
    rationale: z.string().trim().min(1).max(1_000),
    expiresAt: z.string().datetime(),
    reviewedEvidence: z.string().regex(SAFE_IDENTIFIER),
    reviewedEvidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    reviewedEvidenceByteLength: z.number().int().positive().max(1_000_000),
  })
  .strict()

const evaluationSchema = z
  .object({
    status: z.enum(["pass", "fail", "exception"]),
    reasons: z.array(z.string().min(1).max(240)).max(4),
  })
  .strict()

const provenanceInputSchema = z
  .object({
    authority: z.enum(["built-in-product", "untrusted-adapter", "persisted-untrusted"]),
    adapterId: z.string().regex(SAFE_IDENTIFIER),
    productionSeam: z.string().min(1).max(160).nullable(),
  })
  .strict()

const provenanceSchema = provenanceInputSchema
  .extend({
    binding: z
      .object({
        algorithm: z.literal("sha256"),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict()

const runtimeBuildIdentitySchema = z
  .object({
    appVersion: z.string().min(1).max(120),
    electronVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/),
    buildType: z.enum(PERFORMANCE_BUILD_TYPES),
    executableSha256: z.string().regex(/^[a-f0-9]{64}$/),
    applicationSha256: z.string().regex(/^[a-f0-9]{64}$/),
    rendererProcessId: z.number().int().positive(),
    identitySha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

const resultSchema = z
  .object({
    budgetId: z.string().regex(SAFE_IDENTIFIER),
    fixture: performanceFixtureManifestSchema,
    conditions: performanceConditionsSchema,
    samples: sampleSetSchema,
    summary: summarySchema,
    evaluation: evaluationSchema,
    provenance: provenanceSchema,
    runtimeBuildIdentity: runtimeBuildIdentitySchema.optional(),
    runtimeBuildIdentities: z.array(runtimeBuildIdentitySchema).max(MAX_SAMPLES).optional(),
    runtimeRendererProcessIds: z.array(z.number().int().positive()).max(MAX_SAMPLES).optional(),
    exception: exceptionSchema.optional(),
    exceptionEvidenceBase64: z.string().max(1_400_000).optional(),
  })
  .strict()

const omissionSchema = z
  .object({
    budgetId: z.string().regex(SAFE_IDENTIFIER),
    reason: z.string().trim().min(1).max(240),
    adapterId: z.string().regex(SAFE_IDENTIFIER).optional(),
  })
  .strict()

const coverageSchema = z
  .object({
    requiredBudgetIds: z.array(z.string().regex(SAFE_IDENTIFIER)).max(MAX_RESULTS),
    observedBudgetIds: z.array(z.string().regex(SAFE_IDENTIFIER)).max(MAX_RESULTS),
    missingBudgetIds: z.array(z.string().regex(SAFE_IDENTIFIER)).max(MAX_RESULTS),
    complete: z.boolean(),
  })
  .strict()

const reportWithoutIntegritySchema = z
  .object({
    schemaVersion: z.literal(3),
    budgetVersion: z.literal("s6-v7"),
    lane: z.enum(PERFORMANCE_REPORT_LANES),
    measuredAt: z.string().datetime(),
    candidate: candidateBindingSchema,
    budgetAuthority: performanceBudgetAuthoritySchema,
    results: z.array(resultSchema).max(MAX_RESULTS),
    omissions: z.array(omissionSchema).max(MAX_OMISSIONS),
    coverage: coverageSchema,
    evidenceStatus: z.enum(["incomplete", "untrusted", "fail", "exception", "pass"]),
  })
  .strict()

const performanceReportSchema = reportWithoutIntegritySchema
  .extend({
    integrity: z
      .object({
        algorithm: z.literal("sha256"),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict()

export type PerformanceReport = z.infer<typeof performanceReportSchema>

export interface PerformanceResultInput {
  budgetId: string
  fixture: PerformanceFixtureManifest
  fixtureBytes: Buffer
  conditions: PerformanceConditions
  samples: PerformanceSampleSet
  adapterId?: string
  builtInCapability?: BuiltInMeasurementCapability
  runtimeBuildIdentity?: ElectronPerformanceBuildIdentity
  runtimeBuildIdentities?: ElectronPerformanceBuildIdentity[]
  runtimeRendererProcessIds?: number[]
  /** Rejected on live creation; retained only to produce a clear legacy escalation error. */
  provenance?: z.input<typeof provenanceInputSchema>
  exception?: PerformanceException
  exceptionEvidenceBytes?: Buffer
}

export interface CreatePerformanceReportInput {
  budgetVersion: typeof STAGE6_PERFORMANCE_BUDGETS.version
  lane?: PerformanceReportLane
  measuredAt: string
  candidate: CandidateBinding
  results: PerformanceResultInput[]
  omissions: Array<z.input<typeof omissionSchema>>
}

export function createPerformanceReport(input: CreatePerformanceReportInput): PerformanceReport {
  return createPerformanceReportInternal(input, "live")
}

type InternalPerformanceResultInput = PerformanceResultInput & {
  persistedProvenance?: z.input<typeof provenanceSchema>
}

function createPerformanceReportInternal(
  input: CreatePerformanceReportInput,
  mode: "live" | "parsed-verify",
): PerformanceReport {
  verifyReviewedPerformanceBudgetAuthority()
  if (input.budgetVersion !== STAGE6_PERFORMANCE_BUDGETS.version) {
    throw new Error(`Unsupported performance budget version: ${input.budgetVersion}`)
  }
  if (input.results.length > MAX_RESULTS) {
    throw new Error(`Performance report result count cannot exceed ${MAX_RESULTS}.`)
  }
  const lane = input.lane ?? "all"
  const measuredAt = z.string().datetime().parse(input.measuredAt)
  const candidate = verifyCandidateBinding(input.candidate)
  const seen = new Set<string>()
  const results = input.results.map((result) => {
    if (seen.has(result.budgetId)) {
      throw new Error(`Duplicate performance result: ${result.budgetId}`)
    }
    seen.add(result.budgetId)
    const budget = budgetForCandidate(result.budgetId, candidate, lane)
    const fixture = verifyPerformanceFixture(result.fixture, result.fixtureBytes)
    if (fixture.dataset !== budget.dataset) {
      throw new Error(`Performance fixture does not match budget dataset: ${result.budgetId}`)
    }
    const conditions = performanceConditionsSchema.parse(result.conditions)
    if (canonicalJson(conditions) !== canonicalJson(conditionsForBudget(budget, candidate))) {
      throw new Error(`Measured conditions do not match budget authority: ${result.budgetId}`)
    }
    const samples = sampleSetSchema.parse(result.samples)
    const runtimeBuildIdentity = result.runtimeBuildIdentity
      ? verifyRuntimeBuildIdentity(result.runtimeBuildIdentity, candidate)
      : undefined
    const runtimeBuildIdentities = result.runtimeBuildIdentities?.map((identity) =>
      verifyRuntimeBuildIdentity(identity, candidate),
    )
    const runtimeRendererProcessIds = result.runtimeRendererProcessIds
      ? z
          .array(z.number().int().positive())
          .max(MAX_SAMPLES)
          .parse(result.runtimeRendererProcessIds)
      : undefined
    const runtimeEvidenceFields = [
      runtimeBuildIdentity,
      runtimeBuildIdentities,
      runtimeRendererProcessIds,
    ].filter((value) => value !== undefined).length
    if (runtimeEvidenceFields !== 0 && runtimeEvidenceFields !== 3) {
      throw new Error("Electron runtime evidence requires a complete identity for every sample.")
    }
    if (
      (runtimeRendererProcessIds &&
        runtimeRendererProcessIds.length !==
          samples.warmupSamples.length + samples.measuredSamples.length) ||
      (runtimeBuildIdentities &&
        runtimeBuildIdentities.length !==
          samples.warmupSamples.length + samples.measuredSamples.length)
    ) {
      throw new Error("Electron runtime process identity count does not match measured samples.")
    }
    if (
      runtimeBuildIdentities &&
      runtimeBuildIdentity &&
      canonicalJson(runtimeBuildIdentities[0]) !== canonicalJson(runtimeBuildIdentity)
    ) {
      throw new Error("Electron runtime build identity does not match the first sample identity.")
    }
    if (
      runtimeBuildIdentities &&
      runtimeRendererProcessIds &&
      runtimeBuildIdentities.some(
        (identity, index) => identity.rendererProcessId !== runtimeRendererProcessIds[index],
      )
    ) {
      throw new Error("Electron runtime sample identities do not match renderer processes.")
    }
    const internalResult = result as InternalPerformanceResultInput
    let provenanceInput: z.infer<typeof provenanceInputSchema>
    if (mode === "parsed-verify") {
      const persisted = provenanceSchema.parse(internalResult.persistedProvenance)
      const expectedBinding = createProvenance(
        {
          authority: persisted.authority,
          adapterId: persisted.adapterId,
          productionSeam: persisted.productionSeam,
        },
        budget,
        candidate,
        fixture.sha256,
        conditions,
        samples,
        runtimeBuildIdentity,
        runtimeBuildIdentities,
        runtimeRendererProcessIds,
      )
      if (persisted.binding.digest !== expectedBinding.binding.digest) {
        throw new Error(`Performance provenance binding does not match: ${budget.id}`)
      }
      provenanceInput = {
        authority: persisted.authority,
        adapterId: persisted.adapterId,
        productionSeam: persisted.productionSeam,
      }
    } else {
      if (result.provenance) {
        throw new Error(
          "Declarative built-in authority is forbidden; an opaque measurement capability is required.",
        )
      }
      if (result.builtInCapability) {
        const observed = consumeBuiltInMeasurementCapability({
          capability: result.builtInCapability,
          budget,
          candidate,
          fixtureSha256: fixture.sha256,
          conditions,
          samples,
          runtimeBuildIdentity,
          runtimeBuildIdentities,
          runtimeRendererProcessIds,
        })
        provenanceInput = {
          authority: "built-in-product",
          adapterId: observed.adapterId,
          productionSeam: observed.productionSeam,
        }
      } else {
        provenanceInput = {
          authority: "untrusted-adapter",
          adapterId: result.adapterId ?? "direct-report-input",
          productionSeam: null,
        }
      }
    }
    validateProvenanceForBudget(provenanceInput, budget)
    const provenance = createProvenance(
      provenanceInput,
      budget,
      candidate,
      fixture.sha256,
      conditions,
      samples,
      runtimeBuildIdentity,
      runtimeBuildIdentities,
      runtimeRendererProcessIds,
    )
    const exception = result.exception ? exceptionSchema.parse(result.exception) : undefined
    let exceptionEvidenceBase64: string | undefined
    if (exception) {
      if (!result.exceptionEvidenceBytes) {
        throw new Error(`Performance exception evidence bytes are required: ${result.budgetId}`)
      }
      if (
        result.exceptionEvidenceBytes.byteLength !== exception.reviewedEvidenceByteLength ||
        sha256Bytes(result.exceptionEvidenceBytes) !== exception.reviewedEvidenceSha256
      ) {
        throw new Error(`Performance exception evidence digest does not match: ${result.budgetId}`)
      }
      exceptionEvidenceBase64 = result.exceptionEvidenceBytes.toString("base64")
    } else if (result.exceptionEvidenceBytes) {
      throw new Error(`Performance exception evidence has no exception: ${result.budgetId}`)
    }
    const evaluation = evaluatePerformanceSamples(budget, samples, exception, new Date())
    return resultSchema.parse({
      budgetId: budget.id,
      fixture,
      conditions,
      samples,
      summary: evaluation.summary.display,
      evaluation: { status: evaluation.status, reasons: evaluation.reasons },
      provenance,
      ...(runtimeBuildIdentity ? { runtimeBuildIdentity } : {}),
      ...(runtimeBuildIdentities ? { runtimeBuildIdentities } : {}),
      ...(runtimeRendererProcessIds ? { runtimeRendererProcessIds } : {}),
      ...(exception ? { exception } : {}),
      ...(exceptionEvidenceBase64 ? { exceptionEvidenceBase64 } : {}),
    })
  })

  const requiredBudgetIds = applicableBudgets(candidate, lane).map((budget) => budget.id)
  const observedBudgetIds = requiredBudgetIds.filter((id) => seen.has(id))
  const missingBudgetIds = requiredBudgetIds.filter((id) => !seen.has(id))
  const omissions = input.omissions.map((omission) => omissionSchema.parse(omission))
  const omissionIds = new Set<string>()
  for (const omission of omissions) {
    if (omissionIds.has(omission.budgetId)) {
      throw new Error(`Duplicate performance omission: ${omission.budgetId}`)
    }
    omissionIds.add(omission.budgetId)
    if (!requiredBudgetIds.includes(omission.budgetId) || seen.has(omission.budgetId)) {
      throw new Error(`Performance omission does not identify a missing applicable budget.`)
    }
  }
  const coverage = coverageSchema.parse({
    requiredBudgetIds,
    observedBudgetIds,
    missingBudgetIds,
    complete: missingBudgetIds.length === 0,
  })
  const evidenceStatus = deriveEvidenceStatus(candidate, coverage.complete, results)
  const unsigned = reportWithoutIntegritySchema.parse({
    schemaVersion: 3,
    budgetVersion: input.budgetVersion,
    lane,
    measuredAt,
    candidate,
    budgetAuthority: STAGE6_PERFORMANCE_BUDGETS.authority,
    results,
    omissions,
    coverage,
    evidenceStatus,
  })
  const report = performanceReportSchema.parse({
    ...unsigned,
    integrity: { algorithm: "sha256", digest: sha256Bytes(canonicalJson(unsigned)) },
  })
  if (Buffer.byteLength(canonicalJson(report), "utf8") > MAX_REPORT_BYTES) {
    throw new Error(`Performance report exceeds the ${MAX_REPORT_BYTES}-byte size limit.`)
  }
  return report
}

export function parsePerformanceReport(serialized: string): PerformanceReport {
  if (Buffer.byteLength(serialized, "utf8") > MAX_REPORT_BYTES) {
    throw new Error(`Performance report exceeds the ${MAX_REPORT_BYTES}-byte size limit.`)
  }
  const parsed = performanceReportSchema.parse(JSON.parse(serialized))
  const { integrity, ...unsigned } = parsed
  if (integrity.digest !== sha256Bytes(canonicalJson(unsigned))) {
    throw new Error("Performance report digest does not match report content.")
  }
  for (const result of parsed.results) {
    if (result.exception && Date.parse(result.exception.expiresAt) <= Date.now()) {
      throw new Error(`Performance exception is expired: ${result.budgetId}`)
    }
  }
  const recomputed = createPerformanceReportInternal(
    {
      budgetVersion: parsed.budgetVersion,
      lane: parsed.lane,
      measuredAt: parsed.measuredAt,
      candidate: parsed.candidate,
      results: parsed.results.map((result) => ({
        budgetId: result.budgetId,
        fixture: result.fixture,
        fixtureBytes: createPerformanceFixture(result.fixture.dataset).bytes,
        conditions: result.conditions,
        samples: result.samples,
        runtimeBuildIdentity: result.runtimeBuildIdentity,
        runtimeBuildIdentities: result.runtimeBuildIdentities,
        runtimeRendererProcessIds: result.runtimeRendererProcessIds,
        persistedProvenance: result.provenance,
        exception: result.exception,
        exceptionEvidenceBytes: result.exceptionEvidenceBase64
          ? decodeEmbeddedEvidence(result.exceptionEvidenceBase64)
          : undefined,
      })),
      omissions: parsed.omissions,
    },
    "parsed-verify",
  )
  if (canonicalJson(parsed) !== canonicalJson(recomputed)) {
    throw new Error("Performance report derived evidence does not match recomputed evidence.")
  }
  return downgradePersistedProductAuthority(recomputed)
}

function decodeEmbeddedEvidence(value: string): Buffer {
  const decoded = Buffer.from(value, "base64")
  if (decoded.toString("base64") !== value) {
    throw new Error("Performance exception evidence is not canonical base64.")
  }
  return decoded
}

function applicableBudgets(
  candidate: CandidateBinding,
  lane: PerformanceReportLane,
): PerformanceBudget[] {
  const laneMetrics =
    lane === "core"
      ? STAGE6_CORE_DEV_PERFORMANCE_METRICS
      : lane === "capability"
        ? STAGE6_CAPABILITY_PERFORMANCE_METRICS
        : null
  return STAGE6_PERFORMANCE_BUDGETS.budgets.filter(
    (budget) =>
      budget.buildType === candidate.buildType &&
      budget.platforms.includes(candidate.platform) &&
      budget.hardwareClasses.includes(candidate.hardwareClass) &&
      (!laneMetrics || laneMetrics.includes(budget.metric as never)),
  )
}

function budgetForCandidate(
  id: string,
  candidate: CandidateBinding,
  lane: PerformanceReportLane,
): PerformanceBudget {
  const budget = STAGE6_PERFORMANCE_BUDGETS.budgets.find((entry) => entry.id === id)
  if (!budget) throw new Error(`Unknown performance budget: ${id}`)
  if (!applicableBudgets(candidate, lane).some((entry) => entry.id === id)) {
    throw new Error(`Performance budget does not apply to candidate: ${id}`)
  }
  return budget
}

function deriveEvidenceStatus(
  candidate: CandidateBinding,
  complete: boolean,
  results: Array<z.infer<typeof resultSchema>>,
): PerformanceReport["evidenceStatus"] {
  if (!complete) return "incomplete"
  const budgetAuthorityStatus: string = STAGE6_PERFORMANCE_BUDGETS.authority.status
  if (
    candidate.authority !== "local-observed" ||
    candidate.dirty ||
    budgetAuthorityStatus !== "reviewed" ||
    results.some((result) => result.provenance.authority !== "built-in-product")
  ) {
    return "untrusted"
  }
  if (results.some((result) => result.evaluation.status === "fail")) return "fail"
  if (results.some((result) => result.evaluation.status === "exception")) return "exception"
  return "pass"
}

function validateProvenanceForBudget(
  provenance: z.infer<typeof provenanceInputSchema>,
  budget: PerformanceBudget,
): void {
  if (provenance.authority === "untrusted-adapter") {
    if (provenance.productionSeam !== null) {
      throw new Error("Untrusted performance adapters cannot claim a production seam.")
    }
    return
  }
  const expected =
    STAGE6_REQUIRED_PRODUCT_SEAMS[budget.metric as keyof typeof STAGE6_REQUIRED_PRODUCT_SEAMS]
  if (!expected || provenance.productionSeam !== expected) {
    throw new Error(`Performance provenance does not match the fixed production seam: ${budget.id}`)
  }
}

function createProvenance(
  input: z.infer<typeof provenanceInputSchema>,
  budget: PerformanceBudget,
  candidate: CandidateBinding,
  fixtureSha256: string,
  conditions: PerformanceConditions,
  samples: PerformanceSampleSet,
  runtimeBuildIdentity?: ElectronPerformanceBuildIdentity,
  runtimeBuildIdentities?: ElectronPerformanceBuildIdentity[],
  runtimeRendererProcessIds?: number[],
): z.infer<typeof provenanceSchema> {
  return provenanceSchema.parse({
    ...input,
    binding: {
      algorithm: "sha256",
      digest: sha256Bytes(
        canonicalJson({
          schemaVersion: 1,
          budgetId: budget.id,
          candidateBindingSha256: candidate.binding.digest,
          fixtureSha256,
          conditions,
          samples,
          runtimeBuildIdentity,
          runtimeBuildIdentities,
          runtimeRendererProcessIds,
          authority: input.authority,
          adapterId: input.adapterId,
          productionSeam: input.productionSeam,
        }),
      ),
    },
  })
}

function verifyRuntimeBuildIdentity(
  input: ElectronPerformanceBuildIdentity,
  candidate: CandidateBinding,
): ElectronPerformanceBuildIdentity {
  const parsed = runtimeBuildIdentitySchema.parse(input) as ElectronPerformanceBuildIdentity
  verifyElectronPerformanceBuildIdentity(parsed)
  if (parsed.buildType !== candidate.buildType) {
    throw new Error("Electron runtime build identity does not match candidate build type.")
  }
  if (candidate.electronVersion && parsed.electronVersion !== candidate.electronVersion) {
    throw new Error("Electron runtime build identity does not match candidate Electron version.")
  }
  return parsed
}

function downgradePersistedProductAuthority(report: PerformanceReport): PerformanceReport {
  if (!report.results.some((result) => result.provenance.authority === "built-in-product")) {
    return report
  }
  const results = report.results.map((result) => {
    if (result.provenance.authority !== "built-in-product") return result
    const budget = budgetForCandidate(result.budgetId, report.candidate, report.lane)
    return {
      ...result,
      provenance: createProvenance(
        {
          authority: "persisted-untrusted",
          adapterId: result.provenance.adapterId,
          productionSeam: result.provenance.productionSeam,
        },
        budget,
        report.candidate,
        result.fixture.sha256,
        result.conditions,
        result.samples,
        result.runtimeBuildIdentity,
        result.runtimeBuildIdentities,
        result.runtimeRendererProcessIds,
      ),
    }
  })
  const { integrity: _previousIntegrity, ...previousUnsigned } = report
  const unsigned = reportWithoutIntegritySchema.parse({
    ...previousUnsigned,
    results,
    evidenceStatus: report.coverage.complete ? "untrusted" : "incomplete",
  })
  return performanceReportSchema.parse({
    ...unsigned,
    integrity: {
      algorithm: "sha256",
      digest: sha256Bytes(canonicalJson(unsigned)),
    },
  })
}

export { conditionsForBudget }
export type {
  PerformanceAggregation,
  PerformanceConditions,
  PerformanceTemperature,
  PerformanceUnit,
}
