import { execFileSync } from "node:child_process"
import { cpus, release, totalmem } from "node:os"
import { resolve } from "node:path"
import { readFileSync, readdirSync } from "node:fs"
import { z } from "zod"
import {
  PERFORMANCE_HARDWARE_CLASSES,
  PERFORMANCE_PLATFORMS,
  STAGE6_PERFORMANCE_BUDGETS,
  type PerformanceBuildType,
  type PerformanceHardwareClass,
  type PerformancePlatform,
} from "./budgets"
import { canonicalJson, sha256Bytes } from "./canonical"

const artifactSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,159}$/),
    byteLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

const candidatePayloadSchema = z
  .object({
    authority: z.enum(["local-observed", "test-fixture"]),
    gitSha: z.string().regex(/^[a-f0-9]{40}$/),
    worktreeDigest: z.string().regex(/^[a-f0-9]{64}$/),
    dirty: z.boolean(),
    buildId: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/)
      .nullable(),
    buildType: z.enum(["dev", "package"]),
    artifact: artifactSchema.nullable(),
    platform: z.enum(PERFORMANCE_PLATFORMS),
    osRelease: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,159}$/),
    architecture: z.enum(["arm64", "x64"]),
    hardwareClass: z.enum(PERFORMANCE_HARDWARE_CLASSES),
    powerProfile: z.enum(["balanced-ac", "performance-ac"]),
    powerProfileEvidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    cpuModel: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._()+@-]{0,159}$/),
    logicalCores: z.number().int().positive().max(1_024),
    memoryBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    nodeVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/),
    electronVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/)
      .nullable(),
  })
  .strict()

export const candidateBindingSchema = candidatePayloadSchema
  .extend({
    binding: z
      .object({
        algorithm: z.literal("sha256"),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict()

export type CandidateBinding = z.infer<typeof candidateBindingSchema>
export type CandidateBindingInput = z.input<typeof candidatePayloadSchema>

export interface LocalPowerProfileObservationSeams {
  execFile?: (file: string, args: readonly string[]) => string
  readDirectory?: (path: string) => string[]
  readTextFile?: (path: string) => string | null
}

type LocalCandidateCaptureInput = Parameters<typeof captureLocalCandidate>[0]

const observedCandidateState = new WeakMap<
  object,
  {
    capture: LocalCandidateCaptureInput & { cwd: string }
    repositoryRoot: string
  }
>()

export function createCandidateBinding(input: CandidateBindingInput): CandidateBinding {
  if (input.authority === "local-observed") {
    throw new Error("Locally observed performance candidates must come from local capture.")
  }
  return bindCandidate(input)
}

function bindCandidate(input: CandidateBindingInput): CandidateBinding {
  const payload = candidatePayloadSchema.parse(input)
  validateHardwareClass(payload.hardwareClass, payload)
  validateBuildArtifactBinding(payload)
  return candidateBindingSchema.parse({
    ...payload,
    binding: { algorithm: "sha256", digest: sha256Bytes(canonicalJson(payload)) },
  })
}

export function verifyCandidateBinding(input: unknown): CandidateBinding {
  const candidate = candidateBindingSchema.parse(input)
  const { binding, ...payload } = candidate
  const expected = sha256Bytes(canonicalJson(payload))
  if (binding.digest !== expected) {
    throw new Error("Performance candidate binding digest does not match candidate metadata.")
  }
  validateHardwareClass(candidate.hardwareClass, candidate)
  validateBuildArtifactBinding(candidate)
  return candidate
}

export function captureLocalCandidate(input: {
  buildType: PerformanceBuildType
  hardwareClass: PerformanceHardwareClass
  cwd?: string
}): CandidateBinding {
  if (input.buildType === "package") {
    throw new Error(
      "Package performance capture is unavailable without executing and observing the exact package.",
    )
  }
  const captureSupport = localCandidateCaptureSupport(process.platform)
  if (!captureSupport.supported) {
    throw new Error(captureSupport.reason)
  }
  const platform = z.enum(PERFORMANCE_PLATFORMS).parse(process.platform)
  const architecture = z.enum(["arm64", "x64"]).parse(process.arch)
  const cwd = resolve(input.cwd ?? process.cwd())
  const root = git(cwd, ["rev-parse", "--show-toplevel"]).trim()
  const gitSha = git(root, ["rev-parse", "HEAD"]).trim()
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
  const diff = git(root, ["diff", "--binary", "HEAD"])
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .sort()
  const untrackedManifest: Array<{ path: string; byteLength: number; sha256: string }> = []
  let untrackedBytes = 0
  for (const relativePath of untracked) {
    const bytes = readFileSync(resolve(root, relativePath))
    untrackedBytes += bytes.byteLength
    if (untrackedBytes > 64 * 1024 * 1024) {
      throw new Error("Untracked candidate content exceeds the 64 MiB binding limit.")
    }
    untrackedManifest.push({
      path: relativePath.replaceAll("\\", "/"),
      byteLength: bytes.byteLength,
      sha256: sha256Bytes(bytes),
    })
  }
  const cpu = cpus()[0]?.model.trim() || "Unknown CPU"
  const powerProfile = observeLocalPowerProfile(platform)
  const electronVersion = observedElectronDependencyVersion(root)
  const worktreeDigest = sha256Bytes(
    canonicalJson({
      algorithm: "stage6-worktree-v1",
      statusSha256: sha256Bytes(status),
      diffSha256: sha256Bytes(diff),
      untracked: untrackedManifest,
    }),
  )
  const candidate = bindCandidate({
    authority: "local-observed",
    gitSha,
    worktreeDigest,
    dirty: status.length > 0,
    buildId: `dev-${gitSha.slice(0, 12)}-${worktreeDigest.slice(0, 12)}-node${process.versions.node}`,
    buildType: input.buildType,
    artifact: null,
    platform,
    osRelease: release(),
    architecture,
    hardwareClass: input.hardwareClass,
    powerProfile: powerProfile.profile,
    powerProfileEvidenceSha256: powerProfile.evidenceSha256,
    cpuModel: cpu,
    logicalCores: cpus().length,
    memoryBytes: totalmem(),
    nodeVersion: process.versions.node,
    electronVersion,
  })
  observedCandidateState.set(candidate, {
    capture: { ...input, cwd },
    repositoryRoot: root,
  })
  return candidate
}

function observedElectronDependencyVersion(repositoryRoot: string): string | null {
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(repositoryRoot, "node_modules", "electron", "package.json"), "utf8"),
    ) as { version?: unknown }
    return typeof manifest.version === "string" &&
      /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(manifest.version)
      ? manifest.version
      : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

export function verifyObservedCandidateNow(input: CandidateBinding): CandidateBinding {
  const capture = observedCandidateState.get(input)
  if (!capture) {
    throw new Error("Local performance candidate was not captured by this process.")
  }
  const observed = captureLocalCandidate(capture.capture)
  if (canonicalJson(observed) !== canonicalJson(input)) {
    throw new Error("Executing performance candidate changed after local capture.")
  }
  return input
}

export function observedCandidateRepositoryRoot(input: CandidateBinding): string {
  const capture = observedCandidateState.get(input)
  if (!capture) {
    throw new Error("Local performance candidate was not captured by this process.")
  }
  return capture.repositoryRoot
}

export function localCandidateCaptureSupport(
  platform: NodeJS.Platform = process.platform,
): { supported: true } | { supported: false; reason: string } {
  if (PERFORMANCE_PLATFORMS.some((supported) => supported === platform)) {
    return { supported: true }
  }
  return {
    supported: false,
    reason: `Trusted local performance candidate capture is unavailable on ${platform}.`,
  }
}

export function observeLocalPowerProfile(
  platform: PerformancePlatform,
  seams: LocalPowerProfileObservationSeams = {},
): {
  profile: "balanced-ac" | "performance-ac"
  evidenceSha256: string
} {
  if (platform === "win32") {
    const observed = boundedNativeEvidence(
      "Windows power profile",
      (seams.execFile ?? executeNativeText)("powercfg", ["/GETACTIVESCHEME"]),
    )
    const normalized = observed.toLowerCase()
    const profile = normalized.includes("381b4222-f694-41f0-9685-ff5bb260df2e")
      ? "balanced-ac"
      : normalized.includes("8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c")
        ? "performance-ac"
        : null
    if (!profile) {
      throw new Error("Active Windows power profile is not a recognized Stage 6 profile.")
    }
    return {
      profile,
      evidenceSha256: powerEvidenceDigest(platform, { scheme: profile }),
    }
  }

  if (platform === "darwin") {
    const execute = seams.execFile ?? executeNativeText
    const battery = boundedNativeEvidence("macOS power source", execute("pmset", ["-g", "batt"]))
    if (!/drawing from ['"]AC Power['"]/i.test(battery)) {
      throw new Error("macOS performance capture requires observed AC power.")
    }
    const settings = boundedNativeEvidence(
      "macOS power profile",
      execute("pmset", ["-g", "custom"]),
    )
    const acSettings = macosAcSettings(settings)
    const powerMode = integerSetting(acSettings, "powermode")
    const lowPowerMode = integerSetting(acSettings, "lowpowermode")
    const profile =
      powerMode === 2
        ? "performance-ac"
        : powerMode === 0 || (powerMode === null && lowPowerMode === 0)
          ? "balanced-ac"
          : null
    if (!profile) {
      throw new Error("Active macOS power profile is not a recognized Stage 6 profile.")
    }
    return {
      profile,
      evidenceSha256: powerEvidenceDigest(platform, {
        acPower: true,
        lowPowerMode,
        powerMode,
        profile,
      }),
    }
  }

  const readDirectory = seams.readDirectory ?? readNativeDirectory
  const readTextFile = seams.readTextFile ?? readNativeText
  const supplyNames = readDirectory("/sys/class/power_supply").sort()
  if (supplyNames.length > 64) {
    throw new Error("Linux power-supply evidence exceeds 64 entries.")
  }
  const supplies: Array<{ name: string; online: boolean; type: string }> = []
  for (const name of supplyNames) {
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(name)) {
      throw new Error("Linux power-supply entry is not a safe native identifier.")
    }
    const base = `/sys/class/power_supply/${name}`
    const type = boundedOptionalNativeEvidence(
      "Linux power-supply type",
      readTextFile(`${base}/type`),
    )
    if (!type || !["mains", "usb", "usb_c", "wireless"].includes(type.trim().toLowerCase())) {
      continue
    }
    const online = boundedOptionalNativeEvidence(
      "Linux power-supply status",
      readTextFile(`${base}/online`),
    )
    supplies.push({ name, online: online?.trim() === "1", type: type.trim() })
  }
  if (!supplies.some((supply) => supply.online)) {
    throw new Error("Linux performance capture requires observed AC power.")
  }
  const platformProfile = boundedOptionalNativeEvidence(
    "Linux platform profile",
    readTextFile("/sys/firmware/acpi/platform_profile"),
  )?.trim()
  const energyPreference = platformProfile
    ? null
    : boundedOptionalNativeEvidence(
        "Linux energy preference",
        readTextFile("/sys/devices/system/cpu/cpu0/cpufreq/energy_performance_preference"),
      )?.trim()
  const normalizedMode = (platformProfile ?? energyPreference ?? "").toLowerCase()
  const profile =
    normalizedMode === "performance"
      ? "performance-ac"
      : ["balanced", "balance_performance", "default"].includes(normalizedMode)
        ? "balanced-ac"
        : null
  if (!profile) {
    throw new Error("Active Linux power profile is not a recognized Stage 6 profile.")
  }
  return {
    profile,
    evidenceSha256: powerEvidenceDigest(platform, {
      acPower: true,
      energyPreference,
      platformProfile,
      profile,
      supplies,
    }),
  }
}

function executeNativeText(file: string, args: readonly string[]): string {
  return execFileSync(file, [...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    windowsHide: true,
  })
}

function readNativeDirectory(path: string): string[] {
  try {
    return readdirSync(path, { encoding: "utf8" })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

function readNativeText(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

function boundedNativeEvidence(label: string, value: string): string {
  if (Buffer.byteLength(value, "utf8") > 64 * 1024 || value.includes("\0")) {
    throw new Error(`${label} evidence is invalid or exceeds 64 KiB.`)
  }
  return value
}

function boundedOptionalNativeEvidence(label: string, value: string | null): string | null {
  return value === null ? null : boundedNativeEvidence(label, value)
}

function macosAcSettings(value: string): string {
  const match = /(?:^|\n)AC Power:\s*\n([\s\S]*?)(?=\n(?:Battery|UPS) Power:|$)/i.exec(value)
  if (!match) {
    throw new Error("macOS AC power-profile settings are unavailable.")
  }
  return match[1]!
}

function integerSetting(value: string, key: string): number | null {
  const match = new RegExp(`(?:^|\\n)\\s*${key}\\s+(\\d+)\\s*$`, "im").exec(value)
  return match ? Number.parseInt(match[1]!, 10) : null
}

function powerEvidenceDigest(platform: PerformancePlatform, evidence: object): string {
  return sha256Bytes(canonicalJson({ schemaVersion: 1, platform, ...evidence }))
}

function validateHardwareClass(
  hardwareClass: PerformanceHardwareClass,
  candidate: { logicalCores: number; memoryBytes: number; powerProfile: string },
): void {
  const definition = STAGE6_PERFORMANCE_BUDGETS.hardwareClasses.find(
    (entry) => entry.id === hardwareClass,
  )!
  if (
    candidate.logicalCores < definition.minimumLogicalCores ||
    candidate.memoryBytes < definition.minimumMemoryBytes ||
    candidate.powerProfile !== definition.powerProfile
  ) {
    throw new Error(`Observed hardware does not satisfy hardware class ${hardwareClass}.`)
  }
}

function validateBuildArtifactBinding(candidate: {
  authority?: CandidateBinding["authority"]
  buildType: PerformanceBuildType
  artifact: CandidateBinding["artifact"]
}): void {
  if (candidate.buildType === "package" && !candidate.artifact) {
    throw new Error("Packaged performance candidates require an artifact digest.")
  }
  if (candidate.buildType === "dev" && candidate.artifact) {
    throw new Error("Development performance candidates cannot claim a package artifact.")
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  })
}
