export type RequiredStartupDependencies = {
  initialize: () => void | Promise<void>
  cleanup: () => void | Promise<void>
  continueStartup: () => void | Promise<void>
  exit: (code: number) => void
  report: (error: unknown) => void
}

/** Fail closed: a required startup failure cannot publish a database or window. */
export async function runRequiredStartup(
  dependencies: RequiredStartupDependencies,
): Promise<boolean> {
  try {
    await dependencies.initialize()
  } catch (error) {
    dependencies.report(error)
    try {
      await dependencies.cleanup()
    } finally {
      dependencies.exit(1)
    }
    return false
  }

  await dependencies.continueStartup()
  return true
}
