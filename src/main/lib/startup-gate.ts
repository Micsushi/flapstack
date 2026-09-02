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

export type RequiredStartupFailureNotice = {
  title: string
  message: string
  detail: string
}

export function describeRequiredStartupFailure(
  error: unknown,
  databasePath: string,
): RequiredStartupFailureNotice {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : ""
  const message = error instanceof Error ? error.message : ""
  const databaseCorrupt =
    /^SQLITE_(?:CORRUPT|NOTADB)$/.test(code) ||
    /file is not a database|database disk image is malformed/i.test(message)
  const reason = databaseCorrupt
    ? "SQLite reported that the database is damaged or unreadable."
    : "A required startup check failed."

  return {
    title: "Flapstack could not start safely",
    message: databaseCorrupt
      ? "The local database could not be opened."
      : "Flapstack stopped before opening a window.",
    detail: [
      "Flapstack did not reset or replace your local data.",
      "",
      `Database: ${databasePath}`,
      "",
      "Keep this file for recovery. Restore a known-good backup or move the damaged profile aside, then reopen Flapstack.",
      "",
      `Reason: ${reason}`,
    ].join("\n"),
  }
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
