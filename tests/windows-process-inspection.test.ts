import { describe, expect, it } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import {
  classifyWindowsFlapstackProcesses,
  findOwnedWindowsProcessIds,
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
