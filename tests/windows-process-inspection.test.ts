import { describe, expect, it } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import {
  classifyWindowsFlapstackProcesses,
  drainWindowsOwnedProcessIds,
  findIsolatedWindowsProcessIds,
  findOwnedWindowsProcessIds,
  findStage6IsolatedWindowsProcessIds,
  parseWindowsProcessJson,
  queryWindowsProcesses,
  windowsTaskkillArgs,
} from "../scripts/lib/windows-processes.mjs"

const root = "C:\\Users\\sushi\\Documents\\Github\\flapstack"

describe("Windows Flapstack process ownership", () => {
  it("finds exact-checkout dev processes and descendants only", () => {
    const processes = [
      {
        ProcessId: 10,
        ParentProcessId: 1,
        ExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
        CommandLine: `node "${root}\\node_modules\\electron-vite\\bin\\electron-vite.js" dev`,
      },
      {
        ProcessId: 11,
        ParentProcessId: 10,
        ExecutablePath: `${root}\\node_modules\\electron\\dist\\electron.exe`,
        CommandLine: `"${root}\\node_modules\\electron\\dist\\electron.exe" .`,
      },
      {
        ProcessId: 12,
        ParentProcessId: 11,
        ExecutablePath: `${root}\\node_modules\\electron\\dist\\electron.exe`,
        CommandLine: "electron.exe --type=renderer",
      },
      {
        ProcessId: 20,
        ParentProcessId: 1,
        ExecutablePath: "D:\\other\\node_modules\\electron\\dist\\electron.exe",
        CommandLine: "D:\\other\\node_modules\\electron\\dist\\electron.exe .",
      },
    ]

    expect(findOwnedWindowsProcessIds(processes, { root, selfPid: 999 })).toEqual([12, 11, 10])
  })

  it("does not adopt an unrelated process through a recycled parent id", () => {
    const processes = [
      {
        ProcessId: 10,
        ParentProcessId: 1,
        ExecutablePath: `${root}\\node_modules\\electron\\dist\\electron.exe`,
        CommandLine: `"${root}\\node_modules\\electron\\dist\\electron.exe" .`,
      },
      {
        ProcessId: 11,
        ParentProcessId: 10,
        ExecutablePath: "C:\\Windows\\System32\\notepad.exe",
        CommandLine: "notepad.exe C:\\unrelated\\notes.txt",
      },
    ]

    expect(findOwnedWindowsProcessIds(processes, { root, selfPid: 999 })).toEqual([10])
  })

  it("kills exact verified pids without recursively adopting a task tree", () => {
    expect(windowsTaskkillArgs(42)).toEqual(["/PID", "42"])
    expect(windowsTaskkillArgs(42, true)).toEqual(["/PID", "42", "/F"])
    expect(windowsTaskkillArgs(42, true, true)).toEqual(["/PID", "42", "/T", "/F"])
  })

  it("finds every surviving isolated process by ancestry or unique profile", () => {
    const profilePath = "C:\\Users\\sushi\\AppData\\Roaming\\Flapstack Dev stage6-perf-123-unique"
    const processes = [
      {
        ProcessId: 10,
        ParentProcessId: 1,
        CommandLine: `node "${root}\\node_modules\\electron-vite\\bin\\electron-vite.js" dev`,
      },
      {
        ProcessId: 11,
        ParentProcessId: 10,
        CommandLine: `"${root}\\node_modules\\electron\\dist\\electron.exe" .`,
      },
      {
        ProcessId: 12,
        ParentProcessId: 11,
        CommandLine: "electron.exe --type=gpu-process",
      },
      {
        ProcessId: 13,
        ParentProcessId: 999,
        CommandLine: `electron.exe --type=renderer --user-data-dir="${profilePath}"`,
      },
      {
        ProcessId: 20,
        ParentProcessId: 1,
        CommandLine: "electron.exe --type=renderer --user-data-dir=unrelated",
      },
    ]

    expect(
      findIsolatedWindowsProcessIds(processes, {
        ancestorPids: [10],
        commandFragments: [profilePath],
      }),
    ).toEqual([10, 11, 12, 13])
  })

  it("targets the live Stage 6 app tree without an exited, reused launcher pid", () => {
    const profilePath = "C:\\Users\\sushi\\AppData\\Roaming\\Flapstack Dev stage6-perf-123-unique"
    const launchedAtEpoch = Date.parse("2026-07-31T17:00:00.000Z")
    const processes = [
      {
        ProcessId: 10,
        ParentProcessId: 1,
        CreationDate: "2026-07-31T17:00:03.000Z",
        ExecutablePath: "C:\\Windows\\System32\\notepad.exe",
        CommandLine: "notepad.exe C:\\unrelated\\notes.txt",
      },
      {
        ProcessId: 11,
        ParentProcessId: 10,
        CreationDate: "2026-07-31T17:00:01.000Z",
        ExecutablePath: `${root}\\node_modules\\electron\\dist\\electron.exe`,
        CommandLine: `"${root}\\node_modules\\electron\\dist\\electron.exe" "${root}"`,
      },
      {
        ProcessId: 12,
        ParentProcessId: 11,
        CreationDate: "2026-07-31T17:00:02.000Z",
        ExecutablePath: `${root}\\node_modules\\electron\\dist\\electron.exe`,
        CommandLine: `electron.exe --type=renderer --user-data-dir="${profilePath}" --app-path="${root}"`,
      },
      {
        ProcessId: 20,
        ParentProcessId: 1,
        CreationDate: "2026-07-31T17:00:02.000Z",
        ExecutablePath: `${root}\\node_modules\\electron\\dist\\electron.exe`,
        CommandLine: `electron.exe --type=renderer --user-data-dir="unrelated" --app-path="${root}"`,
      },
    ]

    expect(
      findStage6IsolatedWindowsProcessIds(processes, {
        root,
        profilePath,
        instance: "stage6-perf-123-unique",
        launchedAtEpoch,
        launcherPid: 10,
        launcherExited: true,
        descriptorPid: 11,
        descriptorCreationDate: "2026-07-31T17:00:01.000Z",
      }),
    ).toEqual([11, 12])
  })

  it("rejects an exact-checkout Electron process that reused the descriptor pid", () => {
    const profilePath = "C:\\Users\\sushi\\AppData\\Roaming\\Flapstack Dev stage6-perf-123-unique"
    const launchedAtEpoch = Date.parse("2026-07-31T17:00:00.000Z")
    const electronExecutable = `${root}\\node_modules\\electron\\dist\\electron.exe`
    const processes = [
      {
        ProcessId: 11,
        ParentProcessId: 1,
        CreationDate: "2026-07-31T17:00:04.000Z",
        ExecutablePath: electronExecutable,
        CommandLine: `"${electronExecutable}" "${root}"`,
      },
      {
        ProcessId: 13,
        ParentProcessId: 1,
        CreationDate: "2026-07-31T17:00:01.000Z",
        ExecutablePath: electronExecutable,
        CommandLine: `"${electronExecutable}" "${root}"`,
      },
      {
        ProcessId: 12,
        ParentProcessId: 13,
        CreationDate: "2026-07-31T17:00:02.000Z",
        ExecutablePath: electronExecutable,
        CommandLine: `electron.exe --type=renderer --user-data-dir="${profilePath}" --app-path="${root}"`,
      },
    ]

    expect(
      findStage6IsolatedWindowsProcessIds(processes, {
        root,
        profilePath,
        instance: "stage6-perf-123-unique",
        launchedAtEpoch,
        launcherPid: 10,
        launcherExited: true,
        descriptorPid: 11,
        descriptorCreationDate: "2026-07-31T17:00:01.000Z",
      }),
    ).toEqual([13, 12])
  })

  it("stops the process root before children and confirms a stable empty tree", async () => {
    let rootAlive = true
    let childAlive = true
    let replacementAlive = false
    let now = 0
    const killed: number[] = []
    const snapshots: number[][] = []

    const result = await drainWindowsOwnedProcessIds({
      findOwned: () => {
        const owned = [
          ...(rootAlive ? [11] : []),
          ...(childAlive ? [12] : []),
          ...(replacementAlive ? [13] : []),
        ]
        snapshots.push(owned)
        return owned
      },
      kill: (pid: number) => {
        killed.push(pid)
        if (pid === 11) rootAlive = false
        if (pid === 12) {
          childAlive = false
          if (rootAlive) replacementAlive = true
        }
        if (pid === 13) replacementAlive = false
        return `${pid}:0:`
      },
      wait: async () => {
        now += 100
      },
      now: () => now,
      timeoutMs: 1_000,
    })

    expect(killed).toEqual([11, 12])
    expect(snapshots.slice(-2)).toEqual([[], []])
    expect(result).toMatchObject({ stable: true, remaining: [] })
  })

  it("rechecks ownership after killing the root before acting on a child pid", async () => {
    let rootAlive = true
    let childOwned = true
    let childPidReused = false
    let now = 0
    const killed: number[] = []

    const result = await drainWindowsOwnedProcessIds({
      findOwned: () => [...(rootAlive ? [11] : []), ...(childOwned ? [12] : [])],
      kill: (pid: number) => {
        killed.push(pid)
        if (pid === 11) {
          rootAlive = false
          childOwned = false
          childPidReused = true
        }
        return `${pid}:0:`
      },
      wait: async () => {
        now += 100
      },
      now: () => now,
      timeoutMs: 1_000,
    })

    expect(childPidReused).toBe(true)
    expect(killed).toEqual([11])
    expect(result).toMatchObject({ stable: true, remaining: [] })
  })

  it("accepts the second empty observation exactly at the deadline", async () => {
    let owned = true
    let now = 0

    const result = await drainWindowsOwnedProcessIds({
      findOwned: () => (owned ? [11] : []),
      kill: (pid: number) => {
        expect(pid).toBe(11)
        owned = false
        return `${pid}:0:`
      },
      wait: async () => {
        now += now === 0 ? 900 : 100
      },
      now: () => now,
      timeoutMs: 1_000,
    })

    expect(now).toBe(1_000)
    expect(result).toMatchObject({ stable: true, remaining: [] })
  })

  it("classifies the exact dev main, renderer, and packaged app", () => {
    const processes = [
      {
        ProcessId: 10,
        ParentProcessId: 1,
        ExecutablePath: `${root}\\node_modules\\electron\\dist\\electron.exe`,
        CommandLine: `"${root}\\node_modules\\electron\\dist\\electron.exe" .`,
      },
      {
        ProcessId: 11,
        ParentProcessId: 10,
        ExecutablePath: `${root}\\node_modules\\electron\\dist\\electron.exe`,
        CommandLine: `electron.exe --type=renderer --user-data-dir="C:\\Users\\sushi\\AppData\\Roaming\\Flapstack Dev" --app-path="${root}"`,
      },
      {
        ProcessId: 30,
        ParentProcessId: 1,
        ExecutablePath: `${root}\\release-preview\\win-unpacked\\Flapstack Preview.exe`,
        CommandLine: `"${root}\\release-preview\\win-unpacked\\Flapstack Preview.exe"`,
      },
    ]

    expect(
      classifyWindowsFlapstackProcesses(processes, {
        root,
        profilePath: "C:\\Users\\sushi\\AppData\\Roaming\\Flapstack Dev",
      }),
    ).toMatchObject({ mainPid: 10, rendererPid: 11, packagedPids: [30] })
  })

  it("accepts PowerShell single-object and array JSON output", () => {
    expect(parseWindowsProcessJson('{"ProcessId":1}')).toEqual([{ ProcessId: 1 }])
    expect(parseWindowsProcessJson('[{"ProcessId":1},{"ProcessId":2}]')).toHaveLength(2)
    expect(parseWindowsProcessJson("")).toEqual([])
    expect(parseWindowsProcessJson('\uFEFF{"ProcessId":3}')).toEqual([{ ProcessId: 3 }])
  })

  it("forces BOM-free UTF-8 output before decoding non-ASCII process paths", () => {
    let command = ""
    const processes = queryWindowsProcesses({
      spawn: (_shell: string, args: string[]) => {
        command = args.at(-1) ?? ""
        return {
          status: 0,
          stdout:
            '\uFEFF{"ProcessId":4,"ExecutablePath":"C:\\\\Users\\\\sushi\\\\Github\\\\café\\\\app.exe"}',
          stderr: "",
        }
      },
    })

    expect(command).toContain("UTF8Encoding")
    expect(processes[0].ExecutablePath).toContain("café")
  })
})
