import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createBoundedLocalModelExecToolExecutor,
  LOCAL_MODEL_EXEC_TOOL_SCHEMAS,
  runBoundedCommand,
  type LocalModelCommandRequest,
  type LocalModelCommandResult,
  type LocalModelExecAuditRecord,
} from "../src/main/lib/harness/local-model-exec-tools"
import {
  runBoundedLocalModelToolLoop,
  type LocalModelProviderTurnRequest,
  type LocalModelReadToolExecutor,
} from "../src/main/lib/harness/local-model-read-tools"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("bounded local-model shell, git, and network tools", () => {
  it.each([
    ["shell_exec", { shell: "deny", git: "allow", network: "allow" }, false],
    ["shell_exec", { shell: "allow", git: "deny", network: "deny" }, true],
    ["git_exec", { shell: "deny", git: "deny", network: "allow" }, false],
    ["git_exec", { shell: "deny", git: "allow", network: "deny" }, true],
  ] as const)("independently gates %s", async (tool, policies, allowed) => {
    const runner = vi.fn(async () => commandResult({ stdout: "ok" }))
    const executor = createExecutor({
      shellPolicy: policies.shell,
      gitPolicy: policies.git,
      networkPolicy: policies.network,
      runCommand: runner,
    })
    const result = await execute(
      executor,
      tool,
      tool === "shell_exec" ? { command: "pwd", args: [] } : { command: "status", args: [] },
    )
    expect(result.ok).toBe(allowed)
    expect(runner).toHaveBeenCalledTimes(allowed ? 1 : 0)
  })

  it("binds argv execution to the reverified registered root and filters the environment", async () => {
    const root = fixtureRoot()
    let request: LocalModelCommandRequest | undefined
    const executor = createExecutor({
      rootPath: root,
      environment: {
        PATH: "/usr/bin:/bin",
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
      PATH: "/usr/bin:/bin",
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

  it("fails unknown commands, external paths, command-running find, and unknown tools closed", async () => {
    const runner = vi.fn(async () => commandResult({ stdout: "unexpected" }))
    const executor = createExecutor({ runCommand: runner })
    for (const input of [
      { command: "bash", args: ["-c", "whoami"] },
      { command: "head", args: ["/etc/passwd"] },
      { command: "find", args: [".", "-exec", "sh", "{}", ";"] },
    ]) {
      await expect(execute(executor, "shell_exec", input)).resolves.toMatchObject({
        ok: false,
        errorCode: "invalid-tool-arguments",
      })
    }
    await expect(execute(executor, "not_a_tool", {})).resolves.toMatchObject({
      ok: false,
      errorCode: "unknown-tool",
    })
    await expect(
      execute(executor, "git_exec", { command: "add", args: ["file.txt"] }),
    ).resolves.toMatchObject({ ok: false, errorCode: "invalid-tool-arguments" })
    await expect(
      execute(executor, "git_exec", { command: "diff", args: ["--output=/tmp/leak"] }),
    ).resolves.toMatchObject({ ok: false, errorCode: "invalid-tool-arguments" })
    expect(
      JSON.stringify(
        executor.redactInput?.({
          id: "secret-command",
          name: "shell_exec",
          arguments: { command: "private-secret-command", args: [] },
        }),
      ),
    ).not.toContain("private-secret-command")
    expect(runner).not.toHaveBeenCalled()
  })

  it("returns deterministic timeout and output-flood failures", async () => {
    const timeout = createExecutor({
      runCommand: async () => commandResult({ timedOut: true }),
    })
    await expect(
      execute(timeout, "shell_exec", { command: "pwd", args: [] }),
    ).resolves.toMatchObject({ ok: false, errorCode: "command-timeout" })

    const flood = createExecutor({
      runCommand: async () =>
        commandResult({ outputLimited: true, outputBytes: 2_000, stdout: "x".repeat(1_024) }),
    })
    await expect(execute(flood, "shell_exec", { command: "pwd", args: [] })).resolves.toMatchObject(
      { ok: false, errorCode: "output-limit" },
    )
  })

  it("kills the production argv runner at its wall-time and output bounds", async () => {
    const cwd = fixtureRoot()
    const timeout = await runBoundedCommand({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd,
      env: { PATH: process.env.PATH },
      signal: new AbortController().signal,
      timeoutMs: 100,
      maxOutputBytes: 1_024,
    })
    expect(timeout).toMatchObject({ timedOut: true, outputLimited: false })

    const flood = await runBoundedCommand({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(4096))"],
      cwd,
      env: { PATH: process.env.PATH },
      signal: new AbortController().signal,
      timeoutMs: 2_000,
      maxOutputBytes: 1_024,
    })
    expect(flood).toMatchObject({ timedOut: false, outputLimited: true })
  })

  it("requires approval before a bounded git mutation and emits content-free audit states", async () => {
    const root = fixtureRoot()
    writeFileSync(join(root, "file.txt"), "fixture\n")
    const audits: LocalModelExecAuditRecord[] = []
    const approvals = vi.fn(async () => "approved" as const)
    let staged = true
    let command: LocalModelCommandRequest | undefined
    const executor = createExecutor({
      rootPath: root,
      gitPolicy: "ask",
      requestApproval: approvals,
      audit: (record) => audits.push(record),
      runCommand: async (request) => {
        command = request
        staged = false
        return commandResult()
      },
    })

    const result = await execute(executor, "git_exec", {
      command: "restore",
      args: ["--staged", "file.txt"],
    })
    expect(result).toMatchObject({ ok: true, tool: "git_exec" })
    expect(staged).toBe(false)
    expect(command).toMatchObject({
      command: "git",
      cwd: realpathSync(root),
      args: expect.arrayContaining(["restore", "--staged", "file.txt"]),
    })
    expect(approvals).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "git_exec", operation: "restore", argumentCount: 2 }),
    )
    expect(audits.map(({ status }) => status)).toEqual([
      "approval-required",
      "allowed",
      "dispatch-started",
      "completed",
    ])
    const serialized = JSON.stringify(audits)
    expect(serialized).not.toContain("file.txt")
    expect(serialized).not.toContain("fixture")
  })

  it("denies, asks, and allows network independently without real network access", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("ok", { status: 200 }),
    ) as unknown as typeof fetch
    const deniedExecutor = createExecutor({ networkPolicy: "deny", fetchImpl })
    await expect(
      execute(deniedExecutor, "network_fetch", { url: "https://example.test/data" }),
    ).resolves.toMatchObject({ ok: false, errorCode: "permission-denied" })
    expect(fetchImpl).not.toHaveBeenCalled()

    await expect(
      execute(deniedExecutor, "network_fetch", {
        url: "https://example.test/data?access_token=secret",
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "invalid-tool-arguments" })

    const askExecutor = createExecutor({
      networkPolicy: "ask",
      fetchImpl,
      requestApproval: async () => "denied",
    })
    await expect(
      execute(askExecutor, "network_fetch", { url: "https://example.test/data" }),
    ).resolves.toMatchObject({ ok: false, errorCode: "approval-denied" })
    expect(fetchImpl).not.toHaveBeenCalled()

    const allowedExecutor = createExecutor({ networkPolicy: "allow", fetchImpl })
    await expect(
      execute(allowedExecutor, "network_fetch", { url: "https://example.test/data" }),
    ).resolves.toMatchObject({ ok: true, content: "ok" })
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "example.test" }),
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    )
  })

  it("keeps argument and environment secrets out of tool evidence and provider context", async () => {
    const secret = "super-secret-value"
    const requests: LocalModelProviderTurnRequest[] = []
    let turn = 0
    const executor = createExecutor({
      environment: { PATH: "/usr/bin", API_TOKEN: secret },
      shellCommands: ["rg"],
      runCommand: async () => commandResult({ stdout: `token=${secret}` }),
    })
    const provider = {
      async *streamTurn(request: LocalModelProviderTurnRequest) {
        requests.push(request)
        turn += 1
        if (turn === 1) {
          yield {
            kind: "tool-call" as const,
            call: {
              id: "secret-call",
              name: "shell_exec",
              arguments: { command: "rg", args: [secret] },
            },
          }
          yield { kind: "done" as const }
          return
        }
        yield { kind: "done" as const }
      },
    }
    const events = []
    for await (const event of runBoundedLocalModelToolLoop({
      runId: "run-secret",
      messages: [{ role: "user", content: "bounded" }],
      toolsEnabled: true,
      tools: LOCAL_MODEL_EXEC_TOOL_SCHEMAS,
      provider,
      executor,
      signal: new AbortController().signal,
    })) {
      events.push(event)
    }
    expect(JSON.stringify(events)).not.toContain(secret)
    expect(JSON.stringify(requests[1]?.messages)).not.toContain(secret)
    expect(JSON.stringify(requests[1]?.messages)).toContain("[REDACTED]")
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
