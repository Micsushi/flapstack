import { describe, expect, it } from "vitest"
import { resolveExternalAppLaunch } from "../src/main/lib/external/app-launch"
import { shouldRecoverMissingCommandWithShellEnv } from "../src/main/lib/git/shell-env"
import { buildSafeEnv } from "../src/main/lib/terminal/env"
import { buildSystemdUserUnit } from "../src/main/lib/usage-daemon/platform"
import {
  buildLinuxEspeakArgs,
  parseLinuxEspeakVoices,
  resolveLinuxTtsCommand,
} from "../src/main/lib/speech/tts-native"
import { buildLoginShellInvocation } from "../src/main/lib/claude/shell-invocation"
import { shouldUseShellForClaudeSetup } from "../src/main/lib/claude-token"
import { parseSsListeningPorts } from "../src/main/lib/terminal/port-scanner"

describe("Linux runtime parity", () => {
  it("keeps the Linux desktop and user-service context in terminal sessions", () => {
    const desktopEnv = {
      WAYLAND_DISPLAY: "wayland-0",
      XAUTHORITY: "/run/user/1000/xauth",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      PULSE_SERVER: "unix:/run/user/1000/pulse/native",
      PIPEWIRE_REMOTE: "pipewire-0",
      FLAPSTACK_PRIVATE_TOKEN: "secret",
    }

    expect(buildSafeEnv(desktopEnv, { platform: "linux" })).toEqual({
      WAYLAND_DISPLAY: desktopEnv.WAYLAND_DISPLAY,
      XAUTHORITY: desktopEnv.XAUTHORITY,
      DBUS_SESSION_BUS_ADDRESS: desktopEnv.DBUS_SESSION_BUS_ADDRESS,
      PULSE_SERVER: desktopEnv.PULSE_SERVER,
      PIPEWIRE_REMOTE: desktopEnv.PIPEWIRE_REMOTE,
    })
  })

  it("recovers a missing Linux command from the login-shell environment", () => {
    const missing = Object.assign(new Error("spawn tool ENOENT"), { code: "ENOENT" })
    const denied = Object.assign(new Error("spawn tool EACCES"), { code: "EACCES" })

    expect(shouldRecoverMissingCommandWithShellEnv("linux", missing)).toBe(true)
    expect(shouldRecoverMissingCommandWithShellEnv("darwin", missing)).toBe(true)
    expect(shouldRecoverMissingCommandWithShellEnv("win32", missing)).toBe(false)
    expect(shouldRecoverMissingCommandWithShellEnv("linux", denied)).toBe(false)
  })

  it("escapes systemd line breaks instead of creating injected directives", () => {
    const unit = buildSystemdUserUnit({
      nodePath: "/opt/Flapstack/flapstack",
      daemonEntryPath: "/opt/Flapstack/resources/app.asar/out/main/usage-daemon.js",
      dbPath: '/tmp/data.db\nEnvironment="FLAPSTACK_INJECTED=1"',
      configDir: "/tmp/config",
      cadenceSeconds: 60,
    })

    expect(unit).not.toContain('\nEnvironment="FLAPSTACK_INJECTED=1"\n')
    expect(unit).toContain('\\nEnvironment=\\"FLAPSTACK_INJECTED=1\\"')
  })

  it("launches Linux terminals and supported IDEs directly", () => {
    expect(resolveExternalAppLaunch("linux", "terminal", "/work/repo")).toEqual({
      kind: "spawn",
      command: "x-terminal-emulator",
      args: ["--working-directory=/work/repo"],
    })
    expect(resolveExternalAppLaunch("linux", "intellij", "/work/repo")).toEqual({
      kind: "spawn",
      command: "idea",
      args: ["/work/repo"],
    })
  })

  it("uses an installed eSpeak binary for Linux native voice fallback", () => {
    expect(resolveLinuxTtsCommand((path) => path === "/usr/bin/espeak-ng")).toBe(
      "/usr/bin/espeak-ng",
    )
    expect(buildLinuxEspeakArgs("en-us", 210, "/tmp/speech.wav")).toEqual([
      "--stdin",
      "-v",
      "en-us",
      "-s",
      "210",
      "-w",
      "/tmp/speech.wav",
    ])
    expect(parseLinuxEspeakVoices(" 5  en-us  M  english-us  en-us\n")).toEqual([
      { id: "english-us", label: "english-us (en-us)", language: "en-us" },
    ])
  })

  it("passes Linux shell paths as executables instead of command text", () => {
    const shell = "/bin/bash; unwanted-command"
    const invocation = buildLoginShellInvocation(shell)

    expect(invocation.file).toBe(shell)
    expect(invocation.args).toHaveLength(2)
    expect(invocation.args[0]).toBe("-ilc")
    expect(invocation.args[1]).toContain("_CLAUDE_ENV_DELIMITER_")
    expect(shouldUseShellForClaudeSetup("linux")).toBe(false)
    expect(shouldUseShellForClaudeSetup("darwin")).toBe(false)
    expect(shouldUseShellForClaudeSetup("win32")).toBe(true)
  })

  it("parses Linux ss listeners only for owned terminal processes", () => {
    const output = [
      'LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=1234,fd=20))',
      'LISTEN 0 128 [::]:4000 [::]:* users:(("python",pid=5678,fd=7))',
      'LISTEN 0 128 0.0.0.0:5000 0.0.0.0:* users:(("other",pid=9999,fd=3))',
    ].join("\n")

    expect(parseSsListeningPorts(output, [1234, 5678])).toEqual([
      { port: 3000, pid: 1234, address: "127.0.0.1", processName: "node" },
      { port: 4000, pid: 5678, address: "::", processName: "python" },
    ])
  })
})
