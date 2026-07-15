import { describe, expect, it, vi } from "vitest"
import {
  currentDaemonPlatform,
  startInstalledUsageDaemon,
  stopInstalledUsageDaemon,
  type DaemonCommandRunner,
} from "../src/main/lib/usage-daemon/platform"

describe("installed usage daemon maintenance", () => {
  it.runIf(currentDaemonPlatform() === "darwin")(
    "stops and restarts the exact profile service without signaling a stored PID",
    async () => {
      let stopped = false
      const run = vi.fn<DaemonCommandRunner>((command, args) => {
        expect(command).toBe("launchctl")
        if (args[0] === "print") {
          if (stopped) throw new Error("service is unloaded")
          return "state = running\npid = 4242\n"
        }
        if (args[0] === "bootout") {
          stopped = true
          return ""
        }
        if (args[0] === "bootstrap") return ""
        throw new Error(`unexpected command: ${args.join(" ")}`)
      })
      const configDir = "/tmp/Flapstack Dev Review/data"

      await expect(stopInstalledUsageDaemon(configDir, run)).resolves.toBe(true)
      startInstalledUsageDaemon(configDir, run)

      const commands = run.mock.calls.map(([, args]) => args.join(" "))
      expect(commands.some((command) => command.includes("4242"))).toBe(false)
      expect(commands.filter((command) => command.startsWith("bootout "))).toHaveLength(1)
      expect(commands.filter((command) => command.startsWith("bootstrap "))).toHaveLength(1)
      expect(commands.join("\n")).toContain("dev.flapstack.usage-daemon.flapstack-dev-review")
    },
  )
})
