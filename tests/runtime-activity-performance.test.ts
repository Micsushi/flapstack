import { performance } from "node:perf_hooks"
import { describe, expect, it } from "vitest"
import {
  filterRuntimeActivityRows,
  projectRuntimeActivityRows,
  serializeRuntimeActivity,
  virtualizeRuntimeActivity,
  DEFAULT_RUNTIME_ACTIVITY_FILTERS,
} from "../src/renderer/features/agents/runtime-activity"
import { activity } from "./runtime-activity-test-helpers"

describe("Runtime activity 10k performance", () => {
  it("projects, filters, exports, and virtualizes without dropping events", () => {
    const events = Array.from({ length: 10_000 }, (_, index) =>
      activity(
        index % 10 === 0 ? "reasoning-summary" : "agent-text",
        { text: `event ${index}` },
        {
          storageId: index + 1,
          sequence: index + 1,
          eventId: `event-${index + 1}`,
          providerItemId: `item-${index + 1}`,
        },
      ),
    )
    const start = performance.now()
    const rows = projectRuntimeActivityRows(events)
    const filtered = filterRuntimeActivityRows(rows, DEFAULT_RUNTIME_ACTIVITY_FILTERS)
    const middle = virtualizeRuntimeActivity(filtered, 480_000, 640, 96, 6)
    const exported = serializeRuntimeActivity(filtered, "json")
    const elapsedMs = performance.now() - start

    expect(rows).toHaveLength(10_000)
    expect(filtered).toHaveLength(10_000)
    expect(middle.rows.length).toBeLessThanOrEqual(20)
    expect(middle.start).toBeGreaterThan(4_900)
    expect(JSON.parse(exported)).toHaveLength(10_000)
    expect(elapsedMs).toBeLessThan(1_500)
  })
})
