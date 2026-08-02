import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import {
  parsePerformanceCliArguments,
  performanceAcceptanceFailureReasons,
  performanceCiFailureReasons,
  performanceCliBudgetIds,
  resolvePerformanceEvidenceDirectory,
} from "./cli"
import { builtInProductRepositoryRoot } from "./product-adapters"
import { runLocalProductPerformancePlan } from "./product-runner"
import { canonicalJson, sha256Bytes } from "./canonical"

async function main(): Promise<void> {
  const input = parsePerformanceCliArguments(process.argv.slice(2))
  const repositoryRoot = builtInProductRepositoryRoot()
  assertCanonicalRepositoryRoot(repositoryRoot)
  if (input.lane !== "core" || input.buildType !== "dev") {
    throw new Error(
      "This executable runs only development core lanes. Native capability and package evidence use their separate hosts.",
    )
  }
  const outputDirectory = resolvePerformanceEvidenceDirectory(repositoryRoot, input.outputDirectory)
  mkdirSync(outputDirectory, { recursive: true })
  const outcome = await runLocalProductPerformancePlan({
    buildType: "dev",
    hardwareClass: input.hardwareClass,
    lane: input.lane,
    cwd: repositoryRoot,
    budgetIds: performanceCliBudgetIds(input.lane, input.buildType, input.boundedCi),
  })
  if (outcome.status !== "completed") throw new Error(outcome.reason)

  const reportBytes = Buffer.from(`${canonicalJson(outcome.report)}\n`, "utf8")
  const reportName = input.boundedCi
    ? "stage6-performance-core-ci-report.json"
    : "stage6-performance-core-report.json"
  const reportPath = resolve(outputDirectory, reportName)
  writeEvidence(reportPath, reportBytes)
  const summary = {
    schemaVersion: 1,
    lane: input.lane,
    boundedCi: input.boundedCi,
    reportFile: basename(reportPath),
    reportSha256: sha256Bytes(reportBytes),
    reportIntegritySha256: outcome.report.integrity.digest,
    evidenceStatus: outcome.report.evidenceStatus,
    measuredAt: outcome.report.measuredAt,
    candidate: {
      bindingSha256: outcome.report.candidate.binding.digest,
      gitSha: outcome.report.candidate.gitSha,
      worktreeDigest: outcome.report.candidate.worktreeDigest,
      dirty: outcome.report.candidate.dirty,
      buildId: outcome.report.candidate.buildId,
      buildType: outcome.report.candidate.buildType,
      platform: outcome.report.candidate.platform,
      osRelease: outcome.report.candidate.osRelease,
      architecture: outcome.report.candidate.architecture,
      hardwareClass: outcome.report.candidate.hardwareClass,
      powerProfile: outcome.report.candidate.powerProfile,
      cpuModel: outcome.report.candidate.cpuModel,
      logicalCores: outcome.report.candidate.logicalCores,
      memoryBytes: outcome.report.candidate.memoryBytes,
      nodeVersion: outcome.report.candidate.nodeVersion,
      electronVersion: outcome.report.candidate.electronVersion,
    },
    coverage: outcome.report.coverage,
    resultCount: outcome.report.results.length,
    omissionCount: outcome.report.omissions.length,
    failedBudgetIds: outcome.report.results
      .filter((result) => result.evaluation.status === "fail")
      .map((result) => result.budgetId),
  }
  const summaryName = input.boundedCi
    ? "stage6-performance-core-ci-summary.json"
    : "stage6-performance-core-summary.json"
  const summaryPath = resolve(outputDirectory, summaryName)
  writeEvidence(summaryPath, Buffer.from(`${canonicalJson(summary)}\n`, "utf8"))
  await writeStream(
    process.stdout,
    `${JSON.stringify({
      report: reportPath,
      summary: summaryPath,
      evidenceStatus: outcome.report.evidenceStatus,
      results: outcome.report.results.length,
      omissions: outcome.report.omissions.length,
    })}\n`,
  )
  const gateFailures = input.boundedCi
    ? performanceCiFailureReasons(outcome.report)
    : input.acceptance
      ? performanceAcceptanceFailureReasons(outcome.report)
      : []
  if (gateFailures.length > 0) {
    const gate = input.boundedCi ? "CI" : "acceptance"
    throw new Error(`Stage 6 performance ${gate} failed: ${gateFailures.join("; ")}`)
  }
}

function assertCanonicalRepositoryRoot(repositoryRoot: string): void {
  const observed = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  }).trim()
  if (
    resolve(observed) !== resolve(repositoryRoot) ||
    resolve(process.cwd()) !== resolve(repositoryRoot)
  ) {
    throw new Error("Stage 6 performance evidence must execute from the canonical repository root.")
  }
}

function writeEvidence(path: string, bytes: Buffer): void {
  writeFileSync(path, bytes, { flag: "w", mode: 0o600 })
}

function writeStream(stream: NodeJS.WriteStream, value: string): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    stream.write(value, (error) => (error ? rejectReady(error) : resolveReady()))
  })
}

function finish(exitCode: number): void {
  const completionPath = process.env.FLAPSTACK_STAGE6_COMPLETION_PATH
  if (completionPath) {
    const runToken = process.env.FLAPSTACK_STAGE6_RUN_TOKEN
    writeFileSync(
      completionPath,
      `${JSON.stringify({
        schemaVersion: 1,
        exitCode,
        pid: process.pid,
        runToken,
        runtimeEntry: process.argv[1],
      })}\n`,
      { flag: "wx", mode: 0o600 },
    )
  }
  process.exitCode = exitCode
  process.exit(exitCode)
}

main().then(
  () => finish(0),
  async (error) => {
    try {
      await writeStream(
        process.stderr,
        `${error instanceof Error ? error.message : String(error)}\n`,
      )
    } finally {
      finish(1)
    }
  },
)
