import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { RuntimeActivityTimeline } from "../../src/renderer/features/agents/runtime-activity/runtime-activity-timeline"
import { activity } from "../runtime-activity-test-helpers"

const storageKey = "owned-runtime-timeline-count"
const readCount = () => Number(localStorage.getItem(storageKey) ?? 10_000)
let lastExport = ""
let frameTimes: number[] = []

function Fixture() {
  const [count, setCount] = useState(readCount)
  useEffect(() => {
    const refresh = () => setCount(readCount())
    addEventListener("storage", refresh)
    addEventListener("fixture-update", refresh)
    return () => {
      removeEventListener("storage", refresh)
      removeEventListener("fixture-update", refresh)
    }
  }, [])
  const events = Array.from({ length: count }, (_, index) =>
    activity(
      "agent-text",
      { text: index % 997 === 0 ? "PRIVATE_FIXTURE_SENTINEL" : `Visible event ${index + 1}` },
      {
        sequence: index + 1,
        storageId: index + 1,
        eventId: `scale-${index + 1}`,
        runId: `runtime-${index % 3}`,
        runtime: (["codex", "claude-code", "flapstack-native"] as const)[index % 3],
        harness: (["codex", "claude-code", "local"] as const)[index % 3],
        providerItemId: `item-${index + 1}`,
        privacyClass: index % 997 === 0 ? "private" : "public",
      },
    ),
  )
  return (
    <RuntimeActivityTimeline
      events={events}
      status="live"
      viewportHeight={640}
      onExport={(_format, content) => {
        lastExport = content
      }}
    />
  )
}

const settle = () =>
  new Promise<void>((resolve) => {
    frameTimes = [performance.now()]
    requestAnimationFrame(() => {
      frameTimes.push(performance.now())
      requestAnimationFrame(() => {
        frameTimes.push(performance.now())
        setTimeout(resolve, 60)
      })
    })
  })
Object.assign(window, {
  runtimeTimelineFixture: {
    async update() {
      localStorage.setItem(storageKey, String(readCount() + 1))
      dispatchEvent(new Event("fixture-update"))
      await settle()
    },
    async scroll(fraction: number) {
      const feed = document.querySelector<HTMLElement>('[role="feed"]')!
      feed.scrollTop = (feed.scrollHeight - feed.clientHeight) * fraction
      await settle()
      return this.snapshot()
    },
    snapshot() {
      const rows = [...document.querySelectorAll<HTMLElement>("[data-runtime-activity-key]")]
      return {
        count: readCount(),
        keys: rows.map((row) => row.dataset.runtimeActivityKey),
        positions: rows.map((row) => Number(row.getAttribute("aria-posinset"))),
        totals: rows.map((row) => Number(row.getAttribute("aria-setsize"))),
        privateVisible: document.body.innerText.includes("PRIVATE_FIXTURE_SENTINEL"),
        privateInFeedDom: document
          .querySelector('[role="feed"]')!
          .outerHTML.includes("PRIVATE_FIXTURE_SENTINEL"),
        frameDelaysMs: frameTimes.slice(1).map((time, index) => time - frameTimes[index]),
      }
    },
    export() {
      const button = [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "Export JSON",
      )
      if (!button) throw new Error("Production JSON export control not found")
      button.click()
      return lastExport
    },
  },
})
createRoot(document.getElementById("root")!).render(<Fixture />)
