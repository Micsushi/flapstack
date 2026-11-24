import { PassThrough } from "node:stream"
import { it, expect, vi } from "vitest"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { createClaudeCodeRuntimeAdapter } from "../src/main/lib/agent-runtime/claude-code"
import type { ClaudeRuntimeQueryInput } from "../src/main/lib/agent-runtime/claude-code/types"
import { baseDependencies, collect, runtimeContext } from "./claude-runtime-test-helpers"

it("reuses the same SDK conversation, rebinds permission ownership, and follows a native priority interrupt to its actual result", async () => {
  let runs = 0
  let session: string | null = null
  const permissionOwners: string[] = []
  let secondStarted!: () => void
  const waiting = new Promise<void>((resolve) => {
    secondStarted = resolve
  })
  const query = vi.fn((input: ClaudeRuntimeQueryInput) => {
    const output = new PassThrough({ objectMode: true })
    const result = (subtype: string, terminal_reason: string) =>
      output.write({
        type: "result",
        session_id: "native-session",
        subtype,
        terminal_reason,
        is_error: subtype !== "success",
        usage: {},
        result: "fixture",
      })
    void (async () => {
      for await (const raw of input.prompt as AsyncIterable<{
        uuid: string
        priority?: string
        message: { content: string }
      }>) {
        const lifecycle = (state: string) =>
          output.write({ type: "command_lifecycle", command_uuid: raw.uuid, state })
        lifecycle("queued")
        if (raw.priority === "now") {
          result("error_during_execution", "aborted_streaming")
          lifecycle("started")
          result("success", "completed")
        } else {
          lifecycle("started")
          await (input.options.canUseTool as () => Promise<unknown>)()
          if (++runs === 2) secondStarted()
          else result("success", "completed")
        }
      }
      output.end()
    })()
    return output as AsyncIterable<SDKMessage>
  })
  const adapter = createClaudeCodeRuntimeAdapter(
    baseDependencies({
      streamingInput: true,
      query,
      loadSession: async () => (session ? { sessionId: session } : null),
      persistSession: (_, id) => {
        session = id
      },
      buildQueryOptions: (ctx) => ({
        canUseTool: async () => {
          permissionOwners.push(ctx.runId)
        },
      }),
    }),
  )
  const launch = async (n: number) => {
    const ctx = runtimeContext()
    ctx.runId = "run-" + n
    const s = await adapter.startSession(ctx)
    const turn = await adapter.startTurn(ctx, s, "fixture")
    const collected = collect(adapter.streamActivity(ctx, s, turn))
    if (n === 2) {
      await waiting
      await adapter.steer(ctx, "new instruction")
    }
    const events = await collected
    expect(events.some((e) => e.kind === "lifecycle" && e.phase === "failed")).toBe(false)
    await adapter.complete(ctx)
    await expect(adapter.steer(ctx, "late")).rejects.toThrow()
    await adapter.cleanup(ctx)
  }
  await launch(1)
  await launch(2)
  expect(query).toHaveBeenCalledTimes(1)
  expect(permissionOwners).toEqual(["run-1", "run-2"])
  adapter.closeIdleSessions()
})

it("does not start the native process when the workspace gate fails", async () => {
  const query = vi.fn()
  const adapter = createClaudeCodeRuntimeAdapter(baseDependencies({ streamingInput: true, query }))
  const ctx = runtimeContext()
  ctx.waitForWorkspace = async () => {
    throw new Error("Checkout changed")
  }
  const session = await adapter.startSession(ctx)
  const turn = await adapter.startTurn(ctx, session, "fixture")
  await expect(collect(adapter.streamActivity(ctx, session, turn))).rejects.toThrow(
    "Checkout changed",
  )
  expect(query).not.toHaveBeenCalled()
  await adapter.cleanup(ctx)
})
