import { createHash } from "node:crypto"
import type { Stage6ElectronBuildType } from "../../../shared/stage6-electron-performance-control"

export type ElectronPerformanceBuildIdentity = {
  appVersion: string
  electronVersion: string
  buildType: Stage6ElectronBuildType
  executableSha256: string
  applicationSha256: string
  rendererProcessId: number
  identitySha256: string
}

export function createElectronPerformanceBuildIdentity(input: {
  appVersion: string
  electronVersion: string
  buildType: Stage6ElectronBuildType
  executableSha256: string
  applicationSha256: string
  rendererProcessId: number
}): ElectronPerformanceBuildIdentity {
  validateElectronPerformanceBuildIdentityFields(input)
  const payload = electronPerformanceBuildIdentityPayload(input)
  return {
    ...payload,
    identitySha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  }
}

export function verifyElectronPerformanceBuildIdentity(
  input: ElectronPerformanceBuildIdentity,
): ElectronPerformanceBuildIdentity {
  validateElectronPerformanceBuildIdentityFields(input)
  const payload = electronPerformanceBuildIdentityPayload(input)
  const expected = createHash("sha256").update(JSON.stringify(payload)).digest("hex")
  if (input.identitySha256 !== expected) {
    throw new Error("Electron performance build identity digest does not match its fields.")
  }
  return input
}

function validateElectronPerformanceBuildIdentityFields(input: {
  electronVersion: string
  executableSha256: string
  applicationSha256: string
  rendererProcessId: number
}): void {
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(input.electronVersion)) {
    throw new Error("Electron performance control requires an observed Electron version.")
  }
  if (!/^[a-f0-9]{64}$/.test(input.executableSha256)) {
    throw new Error("Electron performance control requires an executable SHA-256.")
  }
  if (!/^[a-f0-9]{64}$/.test(input.applicationSha256)) {
    throw new Error("Electron performance control requires an application SHA-256.")
  }
  if (!Number.isInteger(input.rendererProcessId) || input.rendererProcessId <= 0) {
    throw new Error("Electron performance control requires a live renderer process.")
  }
}

function electronPerformanceBuildIdentityPayload(input: {
  appVersion: string
  electronVersion: string
  buildType: Stage6ElectronBuildType
  executableSha256: string
  applicationSha256: string
  rendererProcessId: number
}) {
  return {
    appVersion: input.appVersion,
    electronVersion: input.electronVersion,
    buildType: input.buildType,
    executableSha256: input.executableSha256,
    applicationSha256: input.applicationSha256,
    rendererProcessId: input.rendererProcessId,
  }
}
