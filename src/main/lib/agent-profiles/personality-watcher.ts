import { watch, type FSWatcher } from "chokidar"
import { basename } from "node:path"

export class AgentPersonalityRootWatcher {
  private readonly watchers = new Map<string, { watcher: FSWatcher; ready: Promise<void> }>()
  private notificationTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly notify: () => void,
    private readonly debounceMs = 75,
  ) {}

  async observe(root: string): Promise<void> {
    const existing = this.watchers.get(root)
    if (existing) return existing.ready
    const watcher = watch(root, {
      ignoreInitial: true,
      persistent: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 20,
      },
    })
    const changed = (path: string) => {
      const name = basename(path)
      if (
        name === ".write.lock" ||
        name.endsWith(".tmp") ||
        path.includes(`${process.platform === "win32" ? "\\" : "/"}.quarantine`)
      ) {
        return
      }
      if (this.notificationTimer) clearTimeout(this.notificationTimer)
      this.notificationTimer = setTimeout(() => {
        this.notificationTimer = null
        this.notify()
      }, this.debounceMs)
    }
    watcher.on("add", changed).on("change", changed).on("unlink", changed)
    watcher.on("error", (error) => {
      console.warn("[AgentPersonalityWatcher] Filesystem watch failed:", error)
    })
    const ready = new Promise<void>((resolve) => watcher.once("ready", resolve))
    this.watchers.set(root, { watcher, ready })
    await ready
  }

  async close(): Promise<void> {
    if (this.notificationTimer) clearTimeout(this.notificationTimer)
    this.notificationTimer = null
    const watchers = [...this.watchers.values()].map(({ watcher }) => watcher)
    this.watchers.clear()
    await Promise.all(watchers.map((watcher) => watcher.close()))
  }
}
