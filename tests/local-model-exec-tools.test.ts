import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fileSymlinksSupported } from "./helpers/symlink-capability"
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

  it("rejects every rg and find symlink-follow flag form", async () => {
    const runner = vi.fn(async () => commandResult({ stdout: "unexpected" }))
    const executor = createExecutor({ runCommand: runner })

    for (const input of [
      { command: "rg", args: ["-L", "secret", "."] },
      { command: "rg", args: ["--follow", "secret", "."] },
      { command: "rg", args: ["--follow=true", "secret", "."] },
      { command: "find", args: ["-L", "."] },
      { command: "find", args: ["-H", "."] },
    ]) {
      await expect(execute(executor, "shell_exec", input)).resolves.toMatchObject({
        ok: false,
        errorCode: "invalid-tool-arguments",
      })
    }
    expect(runner).not.toHaveBeenCalled()
  })

  it("passes only validated project paths after an option terminator", async () => {
    const root = fixtureRoot()
    mkdirSync(join(root, "nested"))
    writeFileSync(join(root, "nested", "safe.txt"), "safe\n")
    const requests: LocalModelCommandRequest[] = []
    const executor = createExecutor({
      rootPath: root,
      runCommand: async (request) => {
        requests.push(request)
        return commandResult({ stdout: "safe" })
      },
    })

    await expect(
      execute(executor, "shell_exec", { command: "head", args: ["nested/safe.txt"] }),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      execute(executor, "shell_exec", { command: "rg", args: ["safe", "nested"] }),
    ).resolves.toMatchObject({ ok: true })

    expect(requests.map(({ command, args }) => [command, args])).toEqual([
      ["head", ["--", "nested/safe.txt"]],
      ["rg", ["--", "safe", "nested"]],
    ])
  })

  it.skipIf(!fileSymlinksSupported)(
    "revalidates a shell path identity at the production spawn seam",
    async () => {
      const root = fixtureRoot()
      const outside = fixtureRoot()
      const target = join(root, "target.txt")
      writeFileSync(target, "safe\n")
      writeFileSync(join(outside, "secret.txt"), "outside\n")
      const runner = vi.fn(async (request: LocalModelCommandRequest) => {
        rmSync(target)
        symlinkSync(join(outside, "secret.txt"), target)
        request.validateBeforeSpawn?.()
        return commandResult({ stdout: "unexpected" })
      })
      const executor = createExecutor({ rootPath: root, runCommand: runner })

      await expect(
        execute(executor, "shell_exec", { command: "head", args: ["target.txt"] }),
      ).resolves.toMatchObject({ ok: false, errorCode: "tool-failed" })
      expect(runner).toHaveBeenCalledOnce()
    },
  )

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

    const stderr = await runBoundedCommand({
      command: process.execPath,
      args: ["-e", "process.stderr.write('stderr-once')"],
      cwd,
      env: { PATH: process.env.PATH },
      signal: new AbortController().signal,
      timeoutMs: 2_000,
      maxOutputBytes: 1_024,
    })
    expect(stderr).toMatchObject({
      stdout: "stderr-once",
      stderr: "",
      outputBytes: Buffer.byteLength("stderr-once"),
      outputLimited: false,
    })
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

    const allowedExecutor = createExecutor({
      networkPolicy: "allow",
      fetchImpl,
      resolveHost: async () => ["93.184.216.34"],
    })
    await expect(
      execute(allowedExecutor, "network_fetch", { url: "https://example.test/data" }),
    ).resolves.toMatchObject({ ok: true, content: "ok" })
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "example.test" }),
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    )
  })

  it.each([
    ["http://127.0.0.1:11434/api/tags", ["127.0.0.1"]],
    ["http://169.254.169.254/latest/meta-data", ["169.254.169.254"]],
    ["http://service.internal/data", ["10.0.0.8"]],
    ["http://service.internal/data", ["fc00::8"]],
    ["http://service.internal/data", ["93.184.216.34", "192.168.1.5"]],
  ])("blocks private network target %s before dispatch", async (url, addresses) => {
    const fetchImpl = vi.fn(async () => new Response("unexpected")) as unknown as typeof fetch
    const executor = createExecutor({
      networkPolicy: "allow",
      fetchImpl,
      resolveHost: async () => addresses,
    })

    await expect(execute(executor, "network_fetch", { url })).resolves.toMatchObject({
      ok: false,
      errorCode: "tool-failed",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("blocks localhost names without DNS resolution", async () => {
    const fetchImpl = vi.fn(async () => new Response("unexpected")) as unknown as typeof fetch
    const resolveHost = vi.fn(async () => ["93.184.216.34"])
    const executor = createExecutor({ networkPolicy: "allow", fetchImpl, resolveHost })

    await expect(
      execute(executor, "network_fetch", { url: "http://api.localhost/data" }),
    ).resolves.toMatchObject({ ok: false, errorCode: "tool-failed" })
    expect(resolveHost).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("normalizes bracketed IPv6 targets before checking resolved addresses", async () => {
    const fetchImpl = vi.fn(async () => new Response("unexpected")) as unknown as typeof fetch
    const resolveHost = vi.fn(async () => ["::1"])
    const executor = createExecutor({ networkPolicy: "allow", fetchImpl, resolveHost })

    await expect(
      execute(executor, "network_fetch", { url: "http://[::1]/data" }),
    ).resolves.toMatchObject({ ok: false, errorCode: "tool-failed" })
    expect(resolveHost).toHaveBeenCalledWith("::1")
    expect(fetchImpl).not.toHaveBeenCalled()
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
              arguments: { command: "rg", args: [secret, "."] },
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
