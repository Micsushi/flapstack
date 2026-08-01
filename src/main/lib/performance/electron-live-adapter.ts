import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { resolve } from "node:path"
import {
  getStage6ElectronMeasurementContract,
  type Stage6ElectronBuildType,
} from "../../../shared/stage6-electron-performance-control"
import type { PerformanceBudget, PerformanceSampleSet } from "./budgets"
import type { CandidateBinding } from "./candidate"
import { verifyElectronPerformanceBuildIdentity } from "./electron-control"

type ElectronBuildIdentity = {
  appVersion: string
  electronVersion: string
  buildType: Stage6ElectronBuildType
  executableSha256: string
  applicationSha256: string
  rendererProcessId: number
  identitySha256: string
}

const execFileAsync = promisify(execFile)

export async function observeLiveElectronSamples(input: {
  budget: PerformanceBudget
  candidate: CandidateBinding
  repositoryRoot: string
}): Promise<{
  samples: PerformanceSampleSet
  buildIdentity: ElectronBuildIdentity
  buildIdentities: ElectronBuildIdentity[]
  sampleRendererProcessIds: number[]
}> {
  const contract = getStage6ElectronMeasurementContract(input.budget.id)
  const script = resolve(input.repositoryRoot, "scripts/stage6-electron-supervisor.mjs")
  const nodeExecutableText = process.env.FLAPSTACK_STAGE6_NODE_EXECUTABLE
  const electronExecutableText = process.env.FLAPSTACK_STAGE6_ELECTRON_EXECUTABLE
  if (
    !process.env.FLAPSTACK_STAGE6_ELECTRON_HOSTED ||
    !nodeExecutableText ||
    !electronExecutableText
  ) {
    throw new Error("Live Electron performance requires exact Node and Electron host runtimes.")
  }
  const nodeExecutable = resolve(nodeExecutableText)
  const electronExecutable = resolve(electronExecutableText)
  if (nodeExecutable === electronExecutable) {
    throw new Error("Live Electron performance Node and Electron runtimes must be distinct.")
  }
  let stdout: string | Buffer
  try {
    const result = await execFileAsync(
      nodeExecutable,
      [
        script,
        contract.budgetId,
        contract.action,
        String(input.budget.minimumWarmups),
        String(input.budget.minimumRepeats),
        input.repositoryRoot,
        process.env.FLAPSTACK_STAGE6_RUN_TOKEN || "standalone",
      ],
      {
        cwd: input.repositoryRoot,
        windowsHide: true,
        maxBuffer: 5_000_000,
        env: {
          ...process.env,
          FLAPSTACK_STAGE6_ELECTRON_EXECUTABLE: electronExecutable,
        },
      },
    )
    stdout = result.stdout
  } catch (error) {
    throw new Error(electronOrchestratorFailureReason(error))
  }
  const parsed = JSON.parse(String(stdout)) as {
    warmupSamples?: unknown
    measuredSamples?: unknown
    buildIdentity?: unknown
    buildIdentities?: unknown
    sampleRendererProcessIds?: unknown
  }
  if (
    !Array.isArray(parsed.warmupSamples) ||
    !Array.isArray(parsed.measuredSamples) ||
    parsed.warmupSamples.length !== input.budget.minimumWarmups ||
    parsed.measuredSamples.length !== input.budget.minimumRepeats ||
    ![...parsed.warmupSamples, ...parsed.measuredSamples].every(
      (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
    ) ||
    !parsed.buildIdentity ||
    typeof parsed.buildIdentity !== "object" ||
    !Array.isArray(parsed.buildIdentities) ||
    parsed.buildIdentities.length !== input.budget.minimumWarmups + input.budget.minimumRepeats ||
    !Array.isArray(parsed.sampleRendererProcessIds) ||
    parsed.sampleRendererProcessIds.length !==
      input.budget.minimumWarmups + input.budget.minimumRepeats ||
    !parsed.sampleRendererProcessIds.every((value) => Number.isInteger(value) && Number(value) > 0)
  ) {
    throw new Error("External Electron performance orchestrator returned invalid evidence.")
  }
  const identity = parseIdentity(parsed.buildIdentity as Record<string, unknown>)
  validateIdentity(identity, input.candidate, null)
  const sampleRendererProcessIds = parsed.sampleRendererProcessIds as number[]
  const buildIdentities = parsed.buildIdentities.map((value, index) => {
    if (!value || typeof value !== "object") {
      throw new Error("Live Electron performance sample build identity is invalid.")
    }
    const sampleIdentity = parseIdentity(value as Record<string, unknown>)
    validateIdentity(sampleIdentity, input.candidate, identity)
    if (sampleIdentity.rendererProcessId !== sampleRendererProcessIds[index]) {
      throw new Error("Live Electron sample identity does not match its renderer process.")
    }
    return sampleIdentity
  })
  return {
    samples: {
      warmupSamples: parsed.warmupSamples as number[],
      measuredSamples: parsed.measuredSamples as number[],
    },
    buildIdentity: identity,
    buildIdentities,
    sampleRendererProcessIds,
  }
}

export function electronOrchestratorFailureReason(error: unknown): string {
  const failure =
    error && typeof error === "object"
      ? (error as { message?: unknown; stderr?: unknown })
      : undefined
  const sources = [failure?.stderr, failure?.message, error]
    .map((value) => {
      if (Buffer.isBuffer(value)) return value.toString("utf8")
      return typeof value === "string" ? value : null
    })
    .filter((value): value is string => value !== null)

  const stage6Failures = sources.flatMap((source) =>
    source
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(?:[A-Za-z]*Error:\s*)?(Stage 6 .+?)\s*$/)?.[1])
      .filter((value): value is string => value !== undefined),
  )

  const nestedChildFailure = sources
    .flatMap((source) => source.split(/\r?\n/))
    .map((line) => {
      const match = line.match(/^\s*[A-Za-z]*Error:\s*(\{.+\})\s*$/)
      if (!match) return undefined
      try {
        const parsed = JSON.parse(match[1]!) as { error?: unknown }
        return typeof parsed.error === "string" && parsed.error.trim()
          ? parsed.error.trim()
          : undefined
      } catch {
        return undefined
      }
    })
    .find((value): value is string => value !== undefined)

  const readiness = stage6Failures.find((failure) =>
    failure.startsWith("Stage 6 product sample readiness timed out:"),
  )
  if (readiness) return readiness
  if (nestedChildFailure) {
    return `Stage 6 Electron child failed: ${nestedChildFailure}`
  }
  if (stage6Failures[0]) return stage6Failures[0]
  return sources.find((source) => source.trim())?.trim() || "Electron orchestrator failed."
}

function parseIdentity(value: Record<string, unknown>): ElectronBuildIdentity {
  if (
    typeof value.appVersion !== "string" ||
    typeof value.electronVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(value.electronVersion) ||
    (value.buildType !== "dev" && value.buildType !== "package") ||
    typeof value.executableSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.executableSha256) ||
    typeof value.applicationSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.applicationSha256) ||
    !Number.isInteger(value.rendererProcessId) ||
    Number(value.rendererProcessId) <= 0 ||
    typeof value.identitySha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.identitySha256)
  ) {
    throw new Error("Live Electron performance build identity is invalid.")
  }
  return verifyElectronPerformanceBuildIdentity(value as ElectronBuildIdentity)
}

function validateIdentity(
  identity: ElectronBuildIdentity,
  candidate: CandidateBinding,
  prior: ElectronBuildIdentity | null,
): void {
  if (identity.buildType !== candidate.buildType) {
    throw new Error("Live Electron build type does not match the candidate.")
  }
  if (candidate.electronVersion && identity.electronVersion !== candidate.electronVersion) {
    throw new Error("Live Electron version does not match the candidate.")
  }
  if (
    prior &&
    (identity.appVersion !== prior.appVersion ||
      identity.electronVersion !== prior.electronVersion ||
      identity.buildType !== prior.buildType ||
      identity.executableSha256 !== prior.executableSha256 ||
      identity.applicationSha256 !== prior.applicationSha256)
  ) {
    throw new Error("Live Electron build identity changed during measurement.")
  }
}
