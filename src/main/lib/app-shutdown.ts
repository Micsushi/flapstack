export type BeforeQuitEvent = {
  preventDefault(): void
}

export type QuitApp = {
  on(event: "before-quit", listener: (event: BeforeQuitEvent) => void): void
  exit(code?: number): void
}

export type AppShutdownSteps = {
  persistProviderSessions(): void | Promise<void>
  cancelPendingOAuth(): void | Promise<void>
  stopDevMcpServer(): void | Promise<void>
  stopProductMcpBridge(): void | Promise<void>
  cleanupGitWatchers(): void | Promise<void>
  shutdownAnalytics(): void | Promise<void>
  closeDatabase(): void | Promise<void>
}

export type ShutdownWaitOptions = {
  isIdle: () => boolean
  timeoutMs: number
  pollMs?: number
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

/** Bound shutdown waits so a stuck provider cannot prevent the process from exiting forever. */
export async function waitForShutdownIdle(options: ShutdownWaitOptions): Promise<boolean> {
  const now = options.now ?? Date.now
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds)
      }))
  const deadline = now() + options.timeoutMs

  while (!options.isIdle()) {
    if (now() >= deadline) return false
    await sleep(Math.min(options.pollMs ?? 10, Math.max(0, deadline - now())))
  }
  return true
}

/** Run every cleanup step in order. SQLite is always attempted last. */
export async function runAppShutdown(steps: AppShutdownSteps): Promise<void> {
  const errors: unknown[] = []
  const run = async (step: () => void | Promise<void>) => {
    try {
      await step()
    } catch (error) {
      errors.push(error)
    }
  }

  await run(steps.persistProviderSessions)
  await run(steps.cancelPendingOAuth)
  await run(steps.stopDevMcpServer)
  await run(steps.stopProductMcpBridge)
  await run(steps.cleanupGitWatchers)
  await run(steps.shutdownAnalytics)
  await run(steps.closeDatabase)

  if (errors.length > 0) throw new AggregateError(errors, "Application shutdown was incomplete")
}

/**
 * Electron does not await async before-quit listeners. Hold the first and all
 * duplicate quit requests, run one shutdown promise, then exit directly so the
 * before-quit handler cannot loop.
 */
export function installBeforeQuitShutdown(input: {
  app: QuitApp
  shutdown: () => Promise<void>
  reportError?: (error: unknown) => void
}): void {
  let shutdownPromise: Promise<void> | null = null

  input.app.on("before-quit", (event) => {
    event.preventDefault()
    if (shutdownPromise) return

    shutdownPromise = input
      .shutdown()
      .catch((error) => input.reportError?.(error))
      .then(() => input.app.exit(0))
  })
}
