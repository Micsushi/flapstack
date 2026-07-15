import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { RuntimeActivityTimeline } from "../src/renderer/features/agents/runtime-activity"
import { activity } from "./runtime-activity-test-helpers"

describe("Runtime activity accessibility and failure states", () => {
  it("provides labels, feed position, keyboard focus, expansion, and live-region semantics", () => {
    const html = renderToStaticMarkup(
      <RuntimeActivityTimeline
        events={[
          activity("reasoning-summary", { text: "Visible summary" }, { eventId: "reasoning" }),
          activity("agent-text", { text: "Answer" }, { storageId: 2, eventId: "answer" }),
        ]}
        status="live"
        diagnosticsHref="#diagnostics"
      />,
    )
    expect(html).toContain('role="search"')
    expect(html).toContain('aria-label="Search Runtime activity"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('aria-atomic="true"')
    expect(html).toContain('aria-posinset="1"')
    expect(html).toContain('aria-setsize="2"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain("Runtime diagnostics")
  })

  it("renders loading, empty, stale, error, corruption, and private states honestly", () => {
    expect(renderToStaticMarkup(<RuntimeActivityTimeline status="loading" />)).toContain(
      "Loading Runtime activity",
    )
    expect(renderToStaticMarkup(<RuntimeActivityTimeline status="ready" />)).toContain(
      "No Runtime activity matches",
    )
    expect(
      renderToStaticMarkup(
        <RuntimeActivityTimeline
          status="stale"
          events={[activity("status", { message: "old" })]}
        />,
      ),
    ).toContain("Activity is stale")
    expect(
      renderToStaticMarkup(
        <RuntimeActivityTimeline status="error" error="Database unavailable" onRetry={() => {}} />,
      ),
    ).toContain('role="alert"')

    const privateEvent = activity(
      "private-metadata",
      { eventType: "encrypted", metadata: { secret: "NEVER_RENDER" } },
      { privacyClass: "encrypted", displayClass: "private", eventId: "private" },
    )
    const corruptEvent = activity(
      "private-metadata",
      { eventType: "corrupt-row", metadata: null },
      {
        storageId: 2,
        eventId: "corrupt",
        privacyClass: "private",
        displayClass: "private",
        redactionState: "corrupt",
      },
    )
    const html = renderToStaticMarkup(
      <RuntimeActivityTimeline events={[privateEvent, corruptEvent]} status="ready" />,
    )
    expect(html).toContain("Private reasoning unavailable")
    expect(html).toContain("Corrupt activity unavailable")
    expect(html).toContain("Provider-private content is not stored or displayed")
    expect(html).not.toContain("NEVER_RENDER")
  })
})
