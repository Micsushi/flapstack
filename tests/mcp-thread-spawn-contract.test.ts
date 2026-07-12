import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  prepareThreadSpawn,
  threadSpawnRequestSchema,
} from "../src/main/lib/mcp-control/thread-spawn-contract"

const rootCaller = {
  harness: "codex",
  chatId: "chat-root",
  runId: "run-root",
  initiatorChatId: "chat-root",
  ancestorChatIds: [],
} as const

describe("MCP thread-spawn contract", () => {
  it("supports Codex-to-Claude and Claude-to-Codex without renderer or adapter logic", () => {
    const codexToClaude = prepareThreadSpawn(
      {
        targetHarness: "claude-code",
        scope: { kind: "project", projectId: "project-1" },
        permission: { mode: "full-access" },
        worktree: { strategy: "existing", worktreeId: "worktree-1" },
        launch: { initialPrompt: "Review the change." },
      },
      rootCaller,
    )
    expect(codexToClaude).toMatchObject({
      ok: true,
      plan: {
        targetHarness: "claude-code",
        launch: { requested: true, initialPrompt: "Review the change." },
        lineage: {
          initiatorChatId: "chat-root",
          parentChatId: "chat-root",
          parentRunId: "run-root",
          ancestorChatIds: ["chat-root"],
        },
        approval: { required: true, operations: ["create-thread", "launch-run"] },
      },
    })

    expect(
      prepareThreadSpawn(
        {
          targetHarness: "codex",
          scope: { kind: "global" },
          permission: { mode: "read-only" },
          worktree: { strategy: "none" },
        },
        { ...rootCaller, harness: "claude-code" },
      ),
    ).toMatchObject({ ok: true, plan: { targetHarness: "codex", launch: { requested: false } } })
  })

  it("rejects untrusted lineage fields and malformed permission/worktree inputs", () => {
    expect(
      threadSpawnRequestSchema.safeParse({
        targetHarness: "claude-code",
        scope: { kind: "global" },
        permission: { mode: "custom" },
        worktree: { strategy: "existing" },
        lineage: { parentChatId: "attacker-controlled" },
      }).success,
    ).toBe(false)
  })

  it("rejects same-harness recursion and corrupted lineage loops", () => {
    expect(
      prepareThreadSpawn(
        {
          targetHarness: "codex",
          scope: { kind: "global" },
          permission: { mode: "read-only" },
          worktree: { strategy: "none" },
        },
        rootCaller,
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden-target" } })

    const fixture = JSON.parse(
      readFileSync(resolve("tests/fixtures/mcp-thread-spawn/forbidden-loop.json"), "utf8"),
    )
    expect(prepareThreadSpawn(fixture.request, fixture.caller)).toMatchObject({
      ok: false,
      error: { code: "forbidden-loop" },
    })
  })
})
