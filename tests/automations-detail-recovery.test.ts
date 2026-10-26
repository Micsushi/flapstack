import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const readSource = (path: string) => readFileSync(path, "utf8")

describe("Automation detail recovery", () => {
  it("does not turn failed reference reads into empty selectors", () => {
    const source = readSource("src/renderer/features/automations/automations-detail-view.tsx")

    expect(source).toContain("referenceQueryError")
    expect(source).toContain("Loading projects, tasks, and chats…")
    expect(source).toContain("Automation references are unavailable.")
    expect(source).toContain("Retry references")
    expect(source).toContain("referenceQueriesLoading")
  })

  it("keeps a failed history read distinct from an empty execution history", () => {
    const source = readSource("src/renderer/features/automations/automations-detail-view.tsx")

    expect(source).toContain("historyQuery.isLoading && !historyQuery.data ?")
    expect(source).toContain("Execution history is unavailable.")
    expect(source).toContain("Retry history")
    expect(source).toContain("historyQuery.data?.pages")
  })
})
