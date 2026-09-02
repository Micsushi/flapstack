import { describe, expect, it } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import {
  classifyNativeFlapstackProcesses,
  findStage6IsolatedNativeProcessIds,
  findStage6SupervisorOwnedNativeProcesses,
  killNativeProcess,
  parseDarwinProcessList,
  processDescendsFromNative,
  queryNativeProcesses,
} from "../scripts/lib/native-processes.mjs"

const root = "/Users/test/Documents/GitHub/flapstack"
const electronRoot = `${root}/node_modules/electron/dist`
const electron = `${electronRoot}/Electron.app/Contents/MacOS/Electron`
const helper = `${electronRoot}/Electron.app/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper`
const started = "Wed Aug 26 12:00:00 2026"
const startedChild = "Wed Aug 26 12:00:01 2026"

describe("native Flapstack process ownership", () => {
  it("parses macOS ps output without losing commands that contain spaces", () => {
    const processes = parseDarwinProcessList(
      [
        ` 101 1 ${started}     ${electron} ${root} --flapstack-stage6-run=s6-1-token-0123456789ab`,
        ` 102 101 ${startedChild}     ${helper} --type=renderer --user-data-dir=/Users/test/Library/Application Support/Flapstack Dev`,
      ].join("\n"),
    )

    expect(processes).toHaveLength(2)
    expect(processes[1]).toMatchObject({ ProcessId: 102, ParentProcessId: 101 })
    expect(processes[1].CommandLine).toContain("Electron Helper")
    expect(processDescendsFromNative(processes, 102, 101)).toBe(true)
  })

  it("queries the bounded macOS ps columns", () => {
    let args: string[] = []
    let environment: NodeJS.ProcessEnv = {}
    const processes = queryNativeProcesses({
      platform: "darwin",
      spawn: (_command: string, nextArgs: string[], options: { env: NodeJS.ProcessEnv }) => {
        args = nextArgs
        environment = options.env
        return {
          status: 0,
          stdout: ` 101 1 ${started}     ${electron} ${root}`,
          stderr: "",
        }
      },
    })

    expect(args).toEqual(["-axo", "pid=,ppid=,lstart=,command="])
    expect(environment.LC_ALL).toBe("C")
    expect(processes[0].ProcessId).toBe(101)
  })

  it("classifies the exact macOS dev renderer without adopting another profile", () => {
    const profile = "/Users/test/Library/Application Support/Flapstack Dev stage6-perf-1"
    const processes = [
      processEntry(101, 1, started, `${electron} ${root}`),
      processEntry(
        102,
        101,
        startedChild,
        `${helper} --type=renderer --user-data-dir=${profile} --app-path=${root}`,
      ),
      processEntry(
        202,
        201,
        startedChild,
        `${helper} --type=renderer --user-data-dir=/Users/test/Library/Application Support/Other --app-path=${root}`,
      ),
    ]

    expect(
      classifyNativeFlapstackProcesses(processes, { root, profilePath: profile }),
    ).toMatchObject({ mainPid: 101, rendererPid: 102 })
  })

  it("retains quoted Windows app-path classification", () => {
    const windowsRoot = "C:\\Users\\test\\flapstack"
    const profile = "C:\\Users\\test\\AppData\\Roaming\\Flapstack Dev stage6-perf-1"
    const executable = `${windowsRoot}\\node_modules\\electron\\dist\\electron.exe`
    const processes = [
      {
        ProcessId: 101,
        ParentProcessId: 1,
        ExecutablePath: executable,
        CommandLine: `\"${executable}\" \"${windowsRoot}\"`,
      },
      {
        ProcessId: 102,
        ParentProcessId: 101,
        ExecutablePath: executable,
        CommandLine: `electron.exe --type=renderer --user-data-dir=\"${profile}\" --app-path=\"${windowsRoot}\"`,
      },
    ]

    expect(
      classifyNativeFlapstackProcesses(processes, { root: windowsRoot, profilePath: profile }),
    ).toMatchObject({ mainPid: 101, rendererPid: 102 })
  })

  it("finds only the isolated macOS Electron tree", () => {
    const profile = "/Users/test/Library/Application Support/Flapstack Dev stage6-perf-1"
    const runToken = "s6-1-token-0123456789ab"
    const launchedAtEpoch = Date.parse(started)
    const processes = [
      processEntry(101, 1, started, `${electron} ${root} --flapstack-stage6-run=${runToken}`),
      processEntry(
        102,
        101,
        startedChild,
        `${helper} --type=gpu-process --user-data-dir=${profile}`,
      ),
      processEntry(
        103,
        101,
        startedChild,
        `${helper} --type=renderer --user-data-dir=${profile} --app-path=${root}`,
      ),
      processEntry(201, 1, started, `${electron} ${root}`),
      processEntry(
        202,
        201,
        startedChild,
        `${helper} --type=renderer --user-data-dir=/Users/test/Library/Application Support/Flapstack Dev --app-path=${root}`,
      ),
    ]

    expect(
      findStage6IsolatedNativeProcessIds(processes, {
        root,
        profilePath: profile,
        instance: "stage6-perf-1",
        runToken,
        launchedAtEpoch,
        launcherPid: 101,
        launcherExited: false,
        descriptorPid: 101,
        descriptorCreationDate: started,
      }),
    ).toEqual([101, 102, 103])
  })

  it("lets the supervisor recover only its token-bound startup and Electron descendants", () => {
    const runToken = "s6-1-token-0123456789ab"
    const startupScript = `${root}/scripts/stage6-electron-startup.mjs`
    const launchedAtEpoch = Date.parse(started)
    const processes = [
      processEntry(
        100,
        1,
        started,
        `/opt/homebrew/bin/node ${startupScript} budget action 0 1 ${root} ${runToken}`,
      ),
      processEntry(
        101,
        100,
        startedChild,
        `${electron} ${root} --flapstack-stage6-run=${runToken}`,
      ),
      processEntry(102, 101, startedChild, `${helper} --type=renderer`),
      processEntry(201, 1, started, `${electron} ${root} --flapstack-stage6-run=unrelated`),
    ]

    const owned = findStage6SupervisorOwnedNativeProcesses(processes, {
      startupPid: 100,
      startupScript,
      runToken,
      electronRoot,
      launchedAtEpoch,
    })
    expect(owned.startup?.ProcessId).toBe(100)
    expect(owned.electron.map((entry: { ProcessId: number }) => entry.ProcessId)).toEqual([
      101, 102,
    ])
  })

  it("uses bounded native signals and treats an exited pid as already clean", () => {
    const calls: Array<[number, string]> = []
    expect(
      killNativeProcess(42, {
        platform: "darwin",
        force: true,
        kill: (pid: number, signal: string) => calls.push([pid, signal]),
      }),
    ).toBe("42:0:")
    expect(calls).toEqual([[42, "SIGKILL"]])

    const missing = Object.assign(new Error("missing"), { code: "ESRCH" })
    expect(
      killNativeProcess(43, {
        platform: "darwin",
        kill: () => {
          throw missing
        },
      }),
    ).toBe("43:0:not-found")
  })
})

function processEntry(pid: number, parentPid: number, creationDate: string, commandLine: string) {
  return {
    ProcessId: pid,
    ParentProcessId: parentPid,
    CreationDate: creationDate,
    ExecutablePath: "",
    CommandLine: commandLine,
  }
}
