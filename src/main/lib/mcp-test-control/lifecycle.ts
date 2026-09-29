import { readFileSync } from "node:fs"
import { join, win32 } from "node:path"

export function isPreviewExecutable(executablePath = process.execPath): boolean {
  const name = win32.basename(executablePath, win32.extname(executablePath)).toLowerCase()
  return name === "flapstack preview" || name === "flapstack-preview"
}

export function resolveFlapstackProtocol(isDev: boolean, isPreview: boolean): string {
  return isDev ? "flapstack-dev" : isPreview ? "flapstack-preview" : "flapstack"
}

export function isStage6PerformanceProfile(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.FLAPSTACK_STAGE6_PERFORMANCE_PROFILE === "1"
}

export function isHiddenPreviewVerification(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.FLAPSTACK_PREVIEW_HEADLESS === "1"
}

/** A hidden launch must never fall back to an ordinary or shared user profile. */
export function isHeadlessPerformanceProfile(
  isPackaged: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env,
  executablePath = process.execPath,
  resourcesPath = process.resourcesPath,
): boolean {
  if (env.FLAPSTACK_PREVIEW_HEADLESS !== undefined) {
    const instance = env.FLAPSTACK_PREVIEW_INSTANCE ?? ""
    const identity = /^preview-bridge-(\d+-[a-z0-9]+)$/.exec(instance)?.[1]
    if (
      env.FLAPSTACK_PREVIEW_HEADLESS !== "1" ||
      !isPackaged ||
      !isPreviewExecutable(executablePath) ||
      !identity ||
      !new RegExp(`^pb-${identity}-[a-f0-9]{12}$`).test(env.FLAPSTACK_PREVIEW_RUN_TOKEN ?? "") ||
      env.FLAPSTACK_STAGE6_HEADLESS !== undefined ||
      env.FLAPSTACK_STAGE6_PERFORMANCE_PROFILE !== undefined ||
      env.FLAPSTACK_DEV_INSTANCE !== undefined ||
      env.FLAPSTACK_DEV_MCP_PROFILE !== undefined ||
      env.FLAPSTACK_ENABLE_DEV_TEST_CONTROL !== undefined
    ) {
      throw new Error("Hidden Preview verification requires an isolated Preview package profile.")
    }
    try {
      const provenance = JSON.parse(
        readFileSync(join(resourcesPath, "package-provenance.json"), "utf8"),
      )
      if (
        provenance?.build?.channel !== "preview" ||
        provenance?.package?.productName !== "Flapstack Preview"
      ) {
        throw new Error("Preview package identity mismatch")
      }
    } catch {
      throw new Error("Hidden Preview verification requires embedded Preview package provenance.")
    }
    return true
  }
  if (env.FLAPSTACK_STAGE6_HEADLESS !== "1") return false
  const instance = env.FLAPSTACK_DEV_INSTANCE ?? ""
  if (
    isPackaged ||
    !isStage6PerformanceProfile(env) ||
    !/^stage6-perf-\d+-[a-z0-9]+$/.test(instance) ||
    env.FLAPSTACK_DEV_MCP_PROFILE !== `Flapstack Dev ${instance}` ||
    !/^s6-\d+-[a-z0-9]+-[a-f0-9]{12}$/.test(env.FLAPSTACK_STAGE6_RUN_TOKEN ?? "")
  ) {
    throw new Error("Hidden runtime verification requires an isolated supervised test profile.")
  }
  return true
}

export function isDevTestControlEnabled(
  isDev: boolean,
  isPreview: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isDev || (isPreview && env.FLAPSTACK_ENABLE_DEV_TEST_CONTROL === "1")
}

export function resolvePreviewUserDataName(instance?: string): string {
  const trimmed = instance?.trim()
  if (!trimmed) return "Flapstack Preview"
  return `Flapstack Preview ${trimmed.replace(/[^a-zA-Z0-9_-]/g, "-")}`
}
