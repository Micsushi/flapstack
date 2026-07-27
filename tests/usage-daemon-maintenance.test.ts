import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  currentDaemonPlatform,
  startInstalledUsageDaemon,
  stopLaunchAgent,
  stopLinuxSystemdUserService,
  stopInstalledUsageDaemon,
  type DaemonCommandRunner,
  uninstallLinuxSystemdUserServiceWithRunner,
  uninstallWindowsScheduledTask,
  windowsDaemonScriptPath,
} from "../src/main/lib/usage-daemon/platform"
import {
  consumeUsageDaemonStopRequest,
  usageDaemonStopRequestPath,
} from "../src/main/lib/usage-daemon/stop-request"

describe("installed usage daemon maintenance", () => {
  const commandError = (message: string, status: number) =>
    Object.assign(new Error(message), { status })

  it.runIf(currentDaemonPlatform() === "win32")(
    "disables the task before stopping it and enables it before restarting",
    async () => {
      const configDir = mkdtempSync(join(tmpdir(), "flapstack-daemon-stop-"))
      try {
        const run = vi.fn<DaemonCommandRunner>((command, args) => {
          if (command === "schtasks.exe") {
            if (args[0] === "/Change" || args[0] === "/Run") return ""
            throw new Error(`unexpected command: ${args.join(" ")}`)
          }
          expect(command.toLowerCase()).toMatch(/powershell\.exe$/)
          return consumeUsageDaemonStopRequest(configDir) ? "3" : "4"
        })

        await expect(stopInstalledUsageDaemon(configDir, run)).resolves.toBe(true)
        startInstalledUsageDaemon(configDir, run)

        const schedulerActions = run.mock.calls
          .filter(([command]) => command === "schtasks.exe")
          .map(([, args]) => args[0])
        expect(schedulerActions).toEqual(["/Change", "/Change", "/Run"])
        expect(
          run.mock.calls
            .filter(([command]) => command === "schtasks.exe")
            .map(([, args]) => args.at(-1)),
        ).toEqual(["/DISABLE", "/ENABLE", expect.any(String)])
        expect(run.mock.calls.some(([, args]) => args[0] === "/End")).toBe(false)
        expect(
          run.mock.calls.some(
            ([command, args]) => command === "schtasks.exe" && args[0] === "/Query",
          ),
        ).toBe(false)
        expect(existsSync(usageDaemonStopRequestPath(configDir))).toBe(false)
      } finally {
        rmSync(configDir, { recursive: true, force: true })
      }
    },
  )

  it.runIf(currentDaemonPlatform() === "win32")(
    "marks an inactive Windows task as paused so maintenance re-enables it",
    async () => {
      const run = vi.fn<DaemonCommandRunner>((command, args) => {
        if (command === "schtasks.exe") return ""
        expect(command.toLowerCase()).toMatch(/powershell\.exe$/)
        return "3"
      })

      await expect(
        stopInstalledUsageDaemon("C:\\Users\\sushi\\AppData\\Roaming\\Flapstack\\data", run),
      ).resolves.toBe(true)
      startInstalledUsageDaemon("C:\\Users\\sushi\\AppData\\Roaming\\Flapstack\\data", run)
      expect(
        run.mock.calls
          .filter(([command]) => command === "schtasks.exe")
          .map(([, args]) => [args[0], args.at(-1)]),
      ).toEqual([
        ["/Change", "/DISABLE"],
        ["/Change", "/ENABLE"],
        ["/Run", "Flapstack Usage Daemon"],
      ])
    },
  )

  it.runIf(currentDaemonPlatform() === "win32")(
    "rolls task enablement back when the explicit Windows start fails",
    () => {
      const run = vi.fn<DaemonCommandRunner>((command, args) => {
        expect(command).toBe("schtasks.exe")
        if (args[0] === "/Run") throw new Error("scheduler refused to run the task")
        return ""
      })

      expect(() =>
        startInstalledUsageDaemon("C:\\Users\\sushi\\AppData\\Roaming\\Flapstack\\data", run),
      ).toThrow(/scheduler refused to run/)
      expect(run.mock.calls.map(([, args]) => [args[0], args.at(-1)])).toEqual([
        ["/Change", "/ENABLE"],
        ["/Run", "Flapstack Usage Daemon"],
        ["/Change", "/DISABLE"],
      ])
    },
  )

  it.runIf(currentDaemonPlatform() === "darwin")(
    "stops and restarts the exact profile service without signaling a stored PID",
    async () => {
      let stopped = false
      const run = vi.fn<DaemonCommandRunner>((command, args) => {
        expect(command).toBe("launchctl")
        if (args[0] === "print") {
          if (stopped) throw commandError("service is unloaded", 113)
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

  it("propagates unknown launchctl query failures during stop", async () => {
    const run = vi.fn<DaemonCommandRunner>(() => {
      throw commandError("launchctl permission denied", 1)
    })
    await expect(
      stopLaunchAgent("gui/501/dev.flapstack.usage-daemon", "gui/501", "/tmp/test.plist", run),
    ).rejects.toThrow(/permission denied/)
  })

  it("treats only launchctl status 113 as an absent service", async () => {
    const run = vi.fn<DaemonCommandRunner>(() => {
      throw commandError("service missing", 113)
    })
    await expect(
      stopLaunchAgent("gui/501/dev.flapstack.usage-daemon", "gui/501", "/tmp/test.plist", run),
    ).resolves.toBe(false)
  })

  it.runIf(currentDaemonPlatform() === "win32")(
    "retains the Windows launcher when task stop cannot be verified",
    () => {
      const configDir = mkdtempSync(join(tmpdir(), "flapstack-daemon-uninstall-"))
      const launcher = windowsDaemonScriptPath(configDir)
      writeFileSync(launcher, "launcher")
      let queries = 0
      const run = vi.fn<DaemonCommandRunner>((command) => {
        if (command.toLowerCase().endsWith("powershell.exe")) {
          queries += 1
          return "4"
        }
        throw new Error("task end denied")
      })
      try {
        expect(() => uninstallWindowsScheduledTask(configDir, run)).toThrow(/task end denied/)
        expect(queries).toBe(2)
        expect(existsSync(launcher)).toBe(true)
      } finally {
        rmSync(configDir, { recursive: true, force: true })
      }
    },
  )

  it.runIf(currentDaemonPlatform() === "win32")(
    "retains the Windows launcher when task deletion cannot be verified",
    () => {
      const configDir = mkdtempSync(join(tmpdir(), "flapstack-daemon-uninstall-"))
      const launcher = windowsDaemonScriptPath(configDir)
      writeFileSync(launcher, "launcher")
      const run = vi.fn<DaemonCommandRunner>((command) => {
        if (command.toLowerCase().endsWith("powershell.exe")) return "3"
        throw new Error("task delete denied")
      })
      try {
        expect(() => uninstallWindowsScheduledTask(configDir, run)).toThrow(/task delete denied/)
        expect(existsSync(launcher)).toBe(true)
      } finally {
        rmSync(configDir, { recursive: true, force: true })
      }
    },
  )

  it.runIf(currentDaemonPlatform() === "win32")(
    "propagates Windows task-state query failures instead of treating them as stopped",
    async () => {
      const run = vi.fn<DaemonCommandRunner>(() => {
        throw new Error("scheduler RPC unavailable")
      })
      await expect(stopInstalledUsageDaemon("C:\\Temp\\Flapstack", run)).rejects.toThrow(
        /scheduler RPC unavailable/,
      )
    },
  )

  it("retains the systemd unit when inactivity cannot be verified", () => {
    const remove = vi.fn()
    const run = vi.fn<DaemonCommandRunner>((_command, args) => {
      if (args.includes("is-active")) throw commandError("DBus unavailable", 1)
      return ""
    })
    expect(() =>
      uninstallLinuxSystemdUserServiceWithRunner("/tmp/Flapstack/data", run, remove),
    ).toThrow(/DBus unavailable/)
    expect(remove).not.toHaveBeenCalled()
  })

  it("retains an inactive systemd unit when disabling it fails", () => {
    const remove = vi.fn()
    const run = vi.fn<DaemonCommandRunner>((_command, args) => {
      if (args.includes("disable")) throw commandError("already inactive", 1)
      if (args.includes("is-active")) throw commandError("inactive", 3)
      return ""
    })
    expect(() =>
      uninstallLinuxSystemdUserServiceWithRunner("/tmp/Flapstack/data", run, remove),
    ).toThrow(/already inactive/)
    expect(remove).not.toHaveBeenCalled()
  })

  it("removes a systemd unit after disable succeeds and inactivity is verified", () => {
    const remove = vi.fn()
    const run = vi.fn<DaemonCommandRunner>((_command, args) => {
      if (args.includes("is-active")) throw commandError("inactive", 3)
      return ""
    })
    uninstallLinuxSystemdUserServiceWithRunner("/tmp/Flapstack/data", run, remove)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(run.mock.calls.some(([, args]) => args.includes("daemon-reload"))).toBe(true)
  })

  it("propagates systemd query failures instead of treating them as inactive", async () => {
    const run = vi.fn<DaemonCommandRunner>(() => {
      throw commandError("DBus unavailable", 1)
    })
    await expect(stopLinuxSystemdUserService("flapstack.service", run)).rejects.toThrow(
      /DBus unavailable/,
    )
  })

  it("does not query systemd when the user unit is not installed", async () => {
    const run = vi.fn<DaemonCommandRunner>(() => {
      throw commandError("DBus unavailable", 1)
    })

    await expect(
      stopLinuxSystemdUserService(
        "flapstack.service",
        run,
        "/missing/flapstack.service",
        () => false,
      ),
    ).resolves.toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it("propagates systemd query failures for an installed user unit", async () => {
    const run = vi.fn<DaemonCommandRunner>(() => {
      throw commandError("DBus unavailable", 1)
    })

    await expect(
      stopLinuxSystemdUserService(
        "flapstack.service",
        run,
        "/installed/flapstack.service",
        () => true,
      ),
    ).rejects.toThrow(/DBus unavailable/)
    expect(run).toHaveBeenCalledOnce()
  })
})
