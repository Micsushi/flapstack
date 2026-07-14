export type RequiredStartupDependencies = {
  initialize: () => void | Promise<void>
  cleanup: () => void | Promise<void>
  continueStartup: () => void | Promise<void>
  exit: (code: number) => void
  report: (error: unknown) => void
}

export type IsolatedStartupTask = {
  name: string
  run: () => void | Promise<void>
}

/** Run optional startup tasks independently so one failure cannot skip later services. */
export async function runIsolatedStartupTasks(
  tasks: IsolatedStartupTask[],
  report: (name: string, error: unknown) => void,
): Promise<void> {
  for (const task of tasks) {
    try {
      await task.run()
    } catch (error) {
      report(task.name, error)
    }
  }
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
