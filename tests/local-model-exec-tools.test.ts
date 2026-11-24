import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fileSymlinksSupported } from "./helpers/symlink-capability"
import {
  createBoundedLocalModelExecToolExecutor,
  type LocalModelCommandRequest,
  type LocalModelCommandResult,
} from "../src/main/lib/harness/local-model-exec-tools"
import { type LocalModelReadToolExecutor } from "../src/main/lib/harness/local-model-read-tools"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("bounded local-model shell, git, and network tools", () => {
  it("binds argv execution to the reverified registered root and filters the environment", async () => {
    const root = fixtureRoot()
    let request: LocalModelCommandRequest | undefined
    const executor = createExecutor({
      rootPath: root,
      environment: {
        Path: "C:\\Windows\\System32",
        SystemRoot: "C:\\Windows",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        HOME: "/safe/home",
        API_TOKEN: "secret-value",
        RANDOM_VALUE: "drop-me",
      },
      verifyRoot: (value) => {
        expect(value).toBe(root)
        return realpathSync(value)
      },
      runCommand: async (input) => {
        request = input
        return commandResult({ stdout: "secret-value token=other-secret" })
      },
    })

    const result = await execute(executor, "shell_exec", { command: "pwd", args: [] })
    expect(request).toMatchObject({ command: "pwd", args: [], cwd: realpathSync(root) })
    expect(request?.env).toMatchObject({
      Path: "C:\\Windows\\System32",
      SystemRoot: "C:\\Windows",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      HOME: "/safe/home",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_EXTERNAL_DIFF: "",
      GIT_PAGER: "cat",
    })
    expect(request?.env).not.toHaveProperty("API_TOKEN")
    expect(request?.env).not.toHaveProperty("RANDOM_VALUE")
    expect(result.content).not.toContain("secret-value")
    expect(result.content).not.toContain("other-secret")
    expect(result.content).toContain("[REDACTED]")
  })

  it("rejects file and directory symlink readers before command dispatch", async () => {
    const root = fixtureRoot()
    const outside = fixtureRoot()
    writeFileSync(join(outside, "secret.txt"), "outside secret\n")
    mkdirSync(join(outside, "tree"))
    writeFileSync(join(outside, "tree", "secret.txt"), "outside tree secret\n")
    if (fileSymlinksSupported) {
      symlinkSync(join(outside, "secret.txt"), join(root, "file-link"))
    }
    symlinkSync(
      join(outside, "tree"),
      join(root, "directory-link"),
      process.platform === "win32" ? "junction" : "dir",
    )
    const runner = vi.fn(async () => commandResult({ stdout: "unexpected" }))
    const executor = createExecutor({ rootPath: root, runCommand: runner })

    const inputs = [
      { command: "ls", args: ["directory-link"] },
      { command: "rg", args: ["secret", "directory-link"] },
      { command: "find", args: ["directory-link"] },
    ]
    if (fileSymlinksSupported) {
      inputs.push(
        { command: "head", args: ["file-link"] },
        { command: "tail", args: ["file-link"] },
        { command: "wc", args: ["file-link"] },
      )
    }
    for (const input of inputs) {
      await expect(execute(executor, "shell_exec", input)).resolves.toMatchObject({ ok: false })
    }
    expect(runner).not.toHaveBeenCalled()
  })
})

function createExecutor(
  overrides: Partial<Parameters<typeof createBoundedLocalModelExecToolExecutor>[0]> = {},
): LocalModelReadToolExecutor {
  const rootPath = overrides.rootPath ?? fixtureRoot()
  return createBoundedLocalModelExecToolExecutor({
    rootPath,
    runId: "run-1",
    chatId: "chat-1",
    shellPolicy: "allow",
    gitPolicy: "allow",
    networkPolicy: "deny",
    verifyRoot: (value) => realpathSync(value),
    ...overrides,
  })
}

function execute(executor: LocalModelReadToolExecutor, name: string, args: unknown) {
  return executor.execute({ id: "call-1", name, arguments: args }, new AbortController().signal)
}

function fixtureRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-local-exec-"))
  directories.push(directory)
  return directory
}

function commandResult(overrides: Partial<LocalModelCommandResult> = {}): LocalModelCommandResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    outputLimited: false,
    outputBytes: Buffer.byteLength(overrides.stdout ?? overrides.stderr ?? ""),
    ...overrides,
  }
}
