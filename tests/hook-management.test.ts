import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  FileHookStateStore,
  HookLifecycleService,
  MemoryHookStateStore,
  NodeManagedHookRuntimeExecutor,
  buildManagedClaudeHookOptions,
  buildManagedCodexHookConfig,
  parseHookCommand,
  resolveEnabledManagedHooks,
  validateHookDraft,
  type HookApprovalDecision,
  type HookAuditEvent,
  type HookDraft,
  type HookDryRunRunner,
} from "../src/main/lib/extension-management"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function draft(overrides: Partial<HookDraft> = {}): HookDraft {
  return {
    name: "format-on-save",
    harness: "claude-code",
    scope: "user",
    event: "PostToolUse",
    matcher: "Write|Edit",
    command: "node ./scripts/format-hook.mjs --check 'safe value'",
    timeoutMs: 2_000,
    ...overrides,
  }
}

function successfulRunner(): HookDryRunRunner {
  return {
    run: vi.fn(async () => ({
      success: true,
      exitCode: 0,
      signal: null,
      timedOut: false,
      outputLimitExceeded: false,
      durationMs: 12,
      stdout: { byteLength: 3, sha256: "a".repeat(64), truncated: false },
      stderr: { byteLength: 0, sha256: "b".repeat(64), truncated: false },
      error: null,
    })),
  }
}

describe("hook validation and command preview", () => {
  it("returns the exact reviewed command and a shell-free argv", () => {
    const input = draft()
    const validation = validateHookDraft(input)

    expect(validation).toMatchObject({ valid: true, issues: [] })
    expect(validation.preview).toEqual({
      exactCommand: input.command,
      executable: "node",
      args: ["./scripts/format-hook.mjs", "--check", "safe value"],
      shell: false,
      commandHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it.each([
    "node safe.js; rm -rf /",
    "node safe.js && curl example.test",
    "node $(malicious)",
    "node `malicious`",
    "TOKEN=value node safe.js",
    "node safe.js\nrm file",
  ])("rejects injection syntax before execution: %s", (command) => {
    expect(() => parseHookCommand(command)).toThrow()
    expect(validateHookDraft(draft({ command }))).toMatchObject({
      valid: false,
      preview: null,
      issues: [expect.objectContaining({ code: "command" })],
    })
  })

  it("accepts modern Codex lifecycle matchers and rejects unsupported events", () => {
    expect(
      validateHookDraft(
        draft({ harness: "codex", event: "PreToolUse", matcher: "shell", command: "notify ok" }),
      ),
    ).toMatchObject({ valid: true, issues: [] })
    expect(
      validateHookDraft(
        draft({ harness: "codex", event: "agent-turn-complete", command: "notify ok" }),
      ),
    ).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ path: "event" })],
    })
    expect(
      validateHookDraft(draft({ harness: "codex", event: "Stop", matcher: "[" })),
    ).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ path: "matcher" })],
    })
  })
})

describe("hook lifecycle", () => {
  it("imports disabled and cannot enable before validation and dry-run", async () => {
    const service = new HookLifecycleService(new MemoryHookStateStore(), successfulRunner(), {
      request: async () => "approved",
    })
    const imported = await service.import(draft())

    expect(imported).toMatchObject({ state: "discovered", enabled: false, imported: true })
    await expect(service.setEnabled(imported.id, true)).rejects.toThrow(/validation/i)

    const validated = await service.validate(imported.id)
    expect(validated.state).toBe("validated")
    await expect(service.setEnabled(imported.id, true)).rejects.toThrow(/dry-run/i)
  })

  it("runs through validation, mocked dry-run, approval, enable, and disable", async () => {
    const runner = successfulRunner()
    const approval = vi.fn(async (): Promise<HookApprovalDecision> => "approved")
    const service = new HookLifecycleService(new MemoryHookStateStore(), runner, {
      request: approval,
    })
    const imported = await service.import(draft())
    await service.validate(imported.id)
    const tested = await service.dryRun(imported.id)

    expect(tested).toMatchObject({ state: "dry-run-passed", enabled: false })
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        preview: expect.objectContaining({ shell: false, exactCommand: draft().command }),
        timeoutMs: 2_000,
        maxOutputBytes: 65_536,
      }),
    )

    const enabled = await service.setEnabled(imported.id, true)
    expect(enabled).toMatchObject({
      approval: "approved",
      record: { state: "enabled", enabled: true },
    })
    expect(approval).toHaveBeenCalledTimes(2)
    expect(approval.mock.calls.map(([request]) => request.action)).toEqual(["dry-run", "enable"])

    const disabled = await service.setEnabled(imported.id, false)
    expect(disabled).toMatchObject({
      approval: "not-required",
      record: { state: "disabled", enabled: false },
    })
  })

  it("requires explicit disable before validating or dry-running an enabled hook", async () => {
    const runner = successfulRunner()
    const approval = vi.fn(async (): Promise<HookApprovalDecision> => "approved")
    const onStateChange = vi.fn()
    const service = new HookLifecycleService(
      new MemoryHookStateStore(),
      runner,
      { request: approval },
      undefined,
      undefined,
      onStateChange,
    )
    const imported = await service.import(draft())
    await service.validate(imported.id)
    await service.dryRun(imported.id)
    await service.setEnabled(imported.id, true)
    const before = service.list()[0]
    const changesBefore = onStateChange.mock.calls.length
    const runsBefore = vi.mocked(runner.run).mock.calls.length
    const approvalsBefore = approval.mock.calls.length

    await expect(service.validate(imported.id)).rejects.toThrow(/disable.*before validation/i)
    await expect(service.dryRun(imported.id)).rejects.toThrow(/disable.*before dry-run/i)
    expect(service.list()[0]).toEqual(before)
    expect(onStateChange).toHaveBeenCalledTimes(changesBefore)
    expect(runner.run).toHaveBeenCalledTimes(runsBefore)
    expect(approval).toHaveBeenCalledTimes(approvalsBefore)
  })

  it("fails closed on timeout and never asks for enable approval", async () => {
    const runner: HookDryRunRunner = {
      run: vi.fn(async () => ({
        success: false,
        exitCode: null,
        signal: "SIGKILL",
        timedOut: true,
        outputLimitExceeded: false,
        durationMs: 10_000,
        stdout: { byteLength: 0, sha256: "a".repeat(64), truncated: false },
        stderr: { byteLength: 0, sha256: "b".repeat(64), truncated: false },
        error: null,
      })),
    }
    const approval = vi.fn(async (): Promise<HookApprovalDecision> => "approved")
    const service = new HookLifecycleService(new MemoryHookStateStore(), runner, {
      request: approval,
    })
    const imported = await service.import(draft())
    await service.validate(imported.id)

    expect(await service.dryRun(imported.id)).toMatchObject({
      state: "validated",
      dryRun: { success: false, timedOut: true },
    })
    await expect(service.setEnabled(imported.id, true)).rejects.toThrow(/dry-run/i)
    expect(approval).toHaveBeenCalledTimes(1)
    expect(approval).toHaveBeenCalledWith(expect.objectContaining({ action: "dry-run" }))
  })

  it("leaves the hook disabled when approval is denied", async () => {
    const approval = vi
      .fn<() => Promise<HookApprovalDecision>>()
      .mockResolvedValueOnce("approved")
      .mockResolvedValueOnce("denied")
    const service = new HookLifecycleService(new MemoryHookStateStore(), successfulRunner(), {
      request: approval,
    })
    const imported = await service.import(draft())
    await service.validate(imported.id)
    await service.dryRun(imported.id)

    expect(await service.setEnabled(imported.id, true)).toMatchObject({
      approval: "denied",
      record: { state: "dry-run-passed", enabled: false },
    })
  })

  it("executes nothing when dry-run approval is denied", async () => {
    const runner = successfulRunner()
    const service = new HookLifecycleService(new MemoryHookStateStore(), runner, {
      request: async () => "denied",
    })
    const imported = await service.import(draft())

    await expect(service.dryRun(imported.id)).rejects.toThrow(/denied/i)
    expect(service.list()[0]).toMatchObject({ state: "validated", enabled: false, dryRun: null })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it("publishes a state change when denied dry-run persists current validation", async () => {
    const onStateChange = vi.fn()
    const service = new HookLifecycleService(
      new MemoryHookStateStore(),
      successfulRunner(),
      { request: async () => "denied" },
      undefined,
      undefined,
      onStateChange,
    )
    const imported = await service.import(draft())
    expect(onStateChange).toHaveBeenCalledTimes(1)

    await expect(service.dryRun(imported.id)).rejects.toThrow(/denied/i)
    expect(service.list()[0]).toMatchObject({ state: "validated", enabled: false })
    expect(onStateChange).toHaveBeenCalledTimes(2)
  })

  it("does not publish a state change when denied enable leaves the record unchanged", async () => {
    const onStateChange = vi.fn()
    const approval = vi
      .fn<() => Promise<HookApprovalDecision>>()
      .mockResolvedValueOnce("approved")
      .mockResolvedValueOnce("denied")
    const service = new HookLifecycleService(
      new MemoryHookStateStore(),
      successfulRunner(),
      { request: approval },
      undefined,
      undefined,
      onStateChange,
    )
    const imported = await service.import(draft())
    await service.validate(imported.id)
    await service.dryRun(imported.id)
    const changesBeforeEnable = onStateChange.mock.calls.length

    expect(await service.setEnabled(imported.id, true)).toMatchObject({ approval: "denied" })
    expect(onStateChange).toHaveBeenCalledTimes(changesBeforeEnable)
  })

  it("revalidates a project root immediately before dry-run", async () => {
    const runner = successfulRunner()
    const resolveProjectCwd = vi.fn(() => "/canonical/project")
    const service = new HookLifecycleService(
      new MemoryHookStateStore(),
      runner,
      { request: async () => "approved" },
      undefined,
      resolveProjectCwd,
    )
    const imported = await service.import(draft({ scope: "project", cwd: "/alias/project" }))
    await service.validate(imported.id)
    await service.dryRun(imported.id)

    expect(resolveProjectCwd).toHaveBeenNthCalledWith(1, "/alias/project")
    expect(resolveProjectCwd).toHaveBeenNthCalledWith(2, "/canonical/project")
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/canonical/project" }))
  })

  it("rejects a stale project root before enable approval without persisting", async () => {
    let stale = false
    const resolveProjectCwd = vi.fn((cwd: string) => {
      if (stale) throw new Error("Registered root identity cannot be verified")
      return cwd
    })
    const approval = vi.fn(async (): Promise<HookApprovalDecision> => "approved")
    const onStateChange = vi.fn()
    const service = new HookLifecycleService(
      new MemoryHookStateStore(),
      successfulRunner(),
      { request: approval },
      undefined,
      resolveProjectCwd,
      onStateChange,
    )
    const imported = await service.import(draft({ scope: "project", cwd: "/registered/project" }))
    await service.validate(imported.id)
    await service.dryRun(imported.id)
    const before = service.list()[0]
    const changesBefore = onStateChange.mock.calls.length
    const approvalsBefore = approval.mock.calls.length
    stale = true

    await expect(service.setEnabled(imported.id, true)).rejects.toThrow(/root identity/i)
    expect(service.list()[0]).toEqual(before)
    expect(onStateChange).toHaveBeenCalledTimes(changesBefore)
    expect(approval).toHaveBeenCalledTimes(approvalsBefore)
  })

  it("rejects a stale project root before validation without persisting", async () => {
    let stale = false
    const store = new MemoryHookStateStore()
    const service = new HookLifecycleService(
      store,
      successfulRunner(),
      undefined,
      undefined,
      (cwd) => {
        if (stale) throw new Error("Registered root identity cannot be verified")
        return cwd
      },
    )
    const imported = await service.import(draft({ scope: "project", cwd: "/registered/project" }))
    stale = true

    await expect(service.validate(imported.id)).rejects.toThrow(/root identity/i)
    expect(service.list()).toEqual([imported])
  })

  it("rejects a project root that becomes stale during enable approval", async () => {
    let stale = false
    const resolveProjectCwd = vi.fn((cwd: string) => {
      if (stale) throw new Error("Registered root identity cannot be verified")
      return cwd
    })
    const approval = vi.fn(async (input: { action: "dry-run" | "enable" }) => {
      if (input.action === "enable") stale = true
      return "approved" as HookApprovalDecision
    })
    const onStateChange = vi.fn()
    const service = new HookLifecycleService(
      new MemoryHookStateStore(),
      successfulRunner(),
      { request: approval },
      undefined,
      resolveProjectCwd,
      onStateChange,
    )
    const imported = await service.import(draft({ scope: "project", cwd: "/registered/project" }))
    await service.validate(imported.id)
    await service.dryRun(imported.id)
    const before = service.list()[0]
    const changesBefore = onStateChange.mock.calls.length

    await expect(service.setEnabled(imported.id, true)).rejects.toThrow(/root identity/i)
    expect(service.list()[0]).toEqual(before)
    expect(onStateChange).toHaveBeenCalledTimes(changesBefore)
    expect(approval).toHaveBeenLastCalledWith(expect.objectContaining({ action: "enable" }))
  })

  it("keeps commands and output secrets out of audit events", async () => {
    const secret = "sk-proj-never-log-this"
    const events: HookAuditEvent[] = []
    const service = new HookLifecycleService(
      new MemoryHookStateStore(),
      successfulRunner(),
      { request: async () => "approved" },
      { append: (event) => events.push(event) },
    )
    const imported = await service.import(draft({ command: `node hook.js '${secret}'` }))
    await service.validate(imported.id)
    await service.dryRun(imported.id)
    await service.setEnabled(imported.id, true)

    const audit = JSON.stringify(events)
    expect(audit).not.toContain(secret)
    expect(audit).not.toContain("node hook.js")
    expect(audit).toContain(imported.revision)
    expect(events.map((event) => event.status)).toEqual([
      "completed",
      "completed",
      "approval-required",
      "allowed",
      "dispatch-started",
      "completed",
      "approval-required",
      "allowed",
      "completed",
    ])
  })

  it("persists imported hooks default-off in a private atomic file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-hooks-"))
    directories.push(directory)
    const file = join(directory, "hook-management.json")
    const store = new FileHookStateStore(file)
    const service = new HookLifecycleService(store, successfulRunner())

    const imported = await service.import(draft())
    expect(new FileHookStateStore(file).read()).toEqual([imported])
    expect(readFileSync(file, "utf8")).toContain('"enabled": false')
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it("rejects tampered enabled state without validation and dry-run evidence", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-hooks-tamper-"))
    directories.push(directory)
    const file = join(directory, "hook-management.json")
    const store = new FileHookStateStore(file)
    const service = new HookLifecycleService(store, successfulRunner())
    await service.import(draft())
    const data = JSON.parse(readFileSync(file, "utf8")) as {
      hooks: Array<{ enabled: boolean }>
    }
    data.hooks[0]!.enabled = true
    writeFileSync(file, JSON.stringify(data))

    expect(() => new FileHookStateStore(file).read()).toThrow(/fail-closed/i)
  })

  it.skipIf(process.platform === "win32")("rejects a symlinked state file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-hooks-symlink-"))
    directories.push(directory)
    const target = join(directory, "target.json")
    await new HookLifecycleService(new FileHookStateStore(target), successfulRunner()).import(
      draft(),
    )
    const linked = join(directory, "linked.json")
    symlinkSync(target, linked)

    expect(() => new FileHookStateStore(linked).read()).toThrow(/fail-closed/i)
  })

  it("resolves only current, enabled, runtime-ready hooks and fails closed on stale roots", async () => {
    const store = new MemoryHookStateStore()
    const resolveProjectCwd = vi.fn((cwd: string) => cwd.replace("/alias", "/canonical"))
    const service = new HookLifecycleService(
      store,
      successfulRunner(),
      { request: async () => "approved" },
      undefined,
      resolveProjectCwd,
    )
    const user = await service.import(draft({ name: "user" }))
    const project = await service.import(
      draft({ name: "project", scope: "project", cwd: "/alias/project" }),
    )
    for (const record of [user, project]) {
      await service.validate(record.id)
      await service.dryRun(record.id)
      await service.setEnabled(record.id, true)
    }

    expect(
      resolveEnabledManagedHooks({
        store,
        harness: "claude-code",
        cwd: "/canonical/project",
        resolveProjectCwd,
      }).map((record) => record.definition.name),
    ).toEqual(["user", "project"])
    expect(() =>
      resolveEnabledManagedHooks({
        store,
        harness: "claude-code",
        cwd: "/stale/project",
        resolveProjectCwd: () => {
          throw new Error("Registered root identity cannot be verified")
        },
      }),
    ).toThrow(/root identity/i)
  })

  it("builds provider-native hook launch options", async () => {
    const codexStore = new MemoryHookStateStore()
    const service = new HookLifecycleService(codexStore, successfulRunner(), {
      request: async () => "approved",
    })
    const imported = await service.import(
      draft({ harness: "codex", event: "PreToolUse", matcher: "shell" }),
    )
    await service.validate(imported.id)
    await service.dryRun(imported.id)
    const enabled = (await service.setEnabled(imported.id, true)).record
    expect(buildManagedCodexHookConfig([enabled])).toMatchObject({
      features: { hooks: true },
      hooks: { PreToolUse: [{ matcher: "shell", hooks: [{ type: "command" }] }] },
    })

    const execute = vi.fn(async () => ({ continue: true }))
    const claude = { ...enabled, definition: { ...enabled.definition, harness: "claude-code" } }
    const options = buildManagedClaudeHookOptions([claude], execute)
    const signal = new AbortController().signal
    await options.PreToolUse![0]!.hooks[0]!({ tool_name: "Write" }, undefined, { signal })
    expect(execute).toHaveBeenCalledWith(claude, { tool_name: "Write" }, signal)
  })

  it("executes managed hooks shell-free with bounded JSON output", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-hook-runtime-"))
    directories.push(directory)
    const script = join(directory, "hook.mjs")
    writeFileSync(
      script,
      'process.stdin.resume(); process.stdin.on("end", () => console.log(JSON.stringify({ cwd: process.cwd() })))',
    )
    const store = new MemoryHookStateStore()
    const service = new HookLifecycleService(store, successfulRunner(), {
      request: async () => "approved",
    })
    const imported = await service.import(draft({ command: `node ${script}` }))
    await service.validate(imported.id)
    await service.dryRun(imported.id)
    const enabled = (await service.setEnabled(imported.id, true)).record

    await expect(
      new NodeManagedHookRuntimeExecutor().execute(
        enabled,
        { hook_event_name: "PostToolUse" },
        new AbortController().signal,
        directory,
      ),
    ).resolves.toEqual({ cwd: realpathSync(directory) })
  })

  it.runIf(process.platform === "win32")(
    "kills the full managed-hook process tree on cancellation",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "flapstack-hook-tree-"))
      directories.push(directory)
      const script = join(directory, "spawn-child.mjs")
      const pidFile = join(directory, "child.pid")
      writeFileSync(
        script,
        `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
setInterval(() => {}, 1000);`,
      )
      const store = new MemoryHookStateStore()
      const service = new HookLifecycleService(store, successfulRunner(), {
        request: async () => "approved",
      })
      const imported = await service.import(draft({ command: `node ${script}` }))
      await service.validate(imported.id)
      await service.dryRun(imported.id)
      const enabled = (await service.setEnabled(imported.id, true)).record
      const abort = new AbortController()
      const execution = new NodeManagedHookRuntimeExecutor().execute(
        enabled,
        {},
        abort.signal,
        directory,
      )
      await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true))
      const childPid = Number(readFileSync(pidFile, "utf8"))
      abort.abort()

      await expect(execution).rejects.toThrow(/cancelled/i)
      await vi.waitFor(() => expect(() => process.kill(childPid, 0)).toThrow(), {
        timeout: 5_000,
        interval: 50,
      })
    },
  )
})
