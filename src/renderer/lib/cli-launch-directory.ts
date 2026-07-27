export function subscribeCliLaunchDirectories<Project>(options: {
  subscribe(callback: () => void): () => void
  openNext(): Promise<Project | null>
  onOpened(project: Project): Promise<void> | void
  onError(error: unknown): void
}): () => void {
  let running = false
  let rerun = false

  const drain = async () => {
    if (running) {
      rerun = true
      return
    }
    running = true
    try {
      do {
        rerun = false
        while (true) {
          const project = await options.openNext()
          if (!project) break
          try {
            await options.onOpened(project)
          } catch (error) {
            options.onError(error)
          }
        }
      } while (rerun)
    } catch (error) {
      options.onError(error)
    } finally {
      running = false
      if (rerun) void drain()
    }
  }

  const unsubscribe = options.subscribe(() => void drain())
  void drain()
  return unsubscribe
}
