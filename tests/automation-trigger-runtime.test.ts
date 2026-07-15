import Database from "better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AutomationTriggerRuntime } from "../src/main/lib/automation/trigger-runtime"

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("automation trigger runtime", () => {
  it("loads active file triggers and projects durable terminal runs", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-automation-trigger-runtime-"))
    const databasePath = join(directory, "app.db")
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
    const database = new Database(databasePath)
    database.exec(`
      CREATE TABLE automations (
        id text PRIMARY KEY, enabled integer NOT NULL, state text NOT NULL,
        approval_state text NOT NULL
      );
      CREATE TABLE automation_triggers (
        id text PRIMARY KEY, automation_id text NOT NULL, type text NOT NULL,
        enabled integer NOT NULL, root_path text, include_globs text,
        exclude_globs text, debounce_ms integer
      );
      CREATE TABLE agent_runs (
        id text PRIMARY KEY, status text NOT NULL, completed_at integer
      );
      INSERT INTO automations VALUES ('automation-1', 1, 'active', 'approved');
      INSERT INTO automation_triggers VALUES (
        'file-1', 'automation-1', 'file-change', 1, '/tmp/project',
        '["**/*.ts"]', '["dist/**"]', 250
      );
      INSERT INTO agent_runs VALUES ('run-1', 'success', 1000);
    `)
    database.close()

    const replaceTriggers = vi.fn().mockResolvedValue(undefined)
    const stop = vi.fn().mockResolvedValue(undefined)
    const handleRunTerminal = vi.fn()
    const runtime = new AutomationTriggerRuntime({
      databasePath,
      fileTriggers: { replaceTriggers, stop },
      terminalTriggers: { handleRunTerminal },
    })

    await runtime.runOnce()
    const laterDatabase = new Database(databasePath)
    laterDatabase.prepare("INSERT INTO agent_runs VALUES ('run-0', 'failure', 1000)").run()
    laterDatabase.close()
    await runtime.runOnce()
    await runtime.stop()

    expect(replaceTriggers).toHaveBeenCalledTimes(1)
    expect(replaceTriggers).toHaveBeenCalledWith([
      {
        triggerId: "file-1",
        automationId: "automation-1",
        rootPath: "/tmp/project",
        includeGlobs: ["**/*.ts"],
        excludeGlobs: ["dist/**"],
        debounceMs: 250,
      },
    ])
    expect(handleRunTerminal).toHaveBeenCalledTimes(2)
    expect(handleRunTerminal.mock.calls).toEqual([[{ runId: "run-1" }], [{ runId: "run-0" }]])
    expect(stop).toHaveBeenCalledTimes(1)
  })
})
