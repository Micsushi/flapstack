import { expect, it } from "vitest"
import { createCodexRuntimeAdapterFactory } from "../src/main/lib/agent-runtime/codex"
import { mapCodexNotification } from "../src/main/lib/agent-runtime/codex/events"
import {
  collectActivity,
  FakeCodexProtocolClient,
  runtimeContext,
} from "./codex-runtime-test-helpers"

it.each([true, false])(
  "records only the actual requested and provider-announced public settings (Show reasoning %s)",
  async (enabled) => {
    const client = new FakeCodexProtocolClient()
    const seen = collectActivity()
    const adapter = createCodexRuntimeAdapterFactory({
      resolveThreadParams: () => ({ cwd: "/owned" }),
      getBinaryVersion: async () => "0.166.0-alpha.6",
      resolveCommand: () => "/owned/codex",
      createClient: () => client,
      appendActivity: seen.append,
    })()
    const context = runtimeContext()
    context.launch.controls.reasoningDisplay = enabled
    const session = await adapter.startSession(context)
    const turn = await adapter.startTurn(context, session, "PROMPT-MUST-NOT-ENTER-SETTINGS")
    const body = client.requests.find((row) => row.method === "turn/start")!.params!
    const { model, effort, summary } = body
    expect(summary).toBe(enabled ? "detailed" : "none")
    const native = {
      model,
      effort,
      summary: "none",
      collaborationMode: { settings: { developerInstructions: "PRIVATE-INSTRUCTIONS" } },
    }
    client.queue.emit({
      method: "thread/settings/updated",
      params: { threadId: "thread-1", threadSettings: native },
    })
    client.queue.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } },
    })
    for await (const _event of adapter.streamActivity(context, session, turn)) {
      /* drain */
    }
    expect(
      seen
        .flat()
        .filter((e) => e.kind === "opaque-metadata")
        .map((e) => e.payload),
    ).toEqual([
      { eventType: "turn/start.settings-sent", metadata: { model, effort, summary } },
      { eventType: "thread/settings/updated", metadata: { model, effort, summary: "none" } },
    ])
    await adapter.cleanup(context)
  },
)

it("retains only the item type of an unsolicited raw response", () => {
  const [e] = mapCodexNotification({
    method: "rawResponseItem/completed",
    params: {
      item: { type: "reasoning", content: [{ text: "private" }], encrypted_content: "secret" },
    },
  })
  expect(e?.payload).toEqual({
    eventType: "rawResponseItem/completed",
    metadata: { itemType: "reasoning" },
  })
})
