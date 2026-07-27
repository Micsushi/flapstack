import { win32 } from "node:path"

export function isPreviewExecutable(executablePath = process.execPath): boolean {
  return win32.basename(executablePath, win32.extname(executablePath)) === "Flapstack Preview"
}

export function resolveFlapstackProtocol(isDev: boolean, isPreview: boolean): string {
  return isDev ? "flapstack-dev" : isPreview ? "flapstack-preview" : "flapstack"
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
