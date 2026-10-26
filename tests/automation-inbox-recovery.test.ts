import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync("src/renderer/features/automations/inbox-view.tsx", "utf8")

describe("automation inbox recovery", () => {
  it("keeps inbox failures distinct from empty data and retryable", () => {
    expect(source).toContain("inbox.data?.pages.flatMap((page) => page.items)")
    expect(source).not.toContain("placeholderData: (previous) => previous")
    expect(source).toContain("Unread count unavailable")
    expect(source).toContain("inbox.error && !inbox.data ? null")
    expect(source).toContain("Inbox refresh failed; showing the last available items.")
    expect(source).toContain("inbox.isFetchNextPageError")
    expect(source).toContain("? inbox.fetchNextPage()")
    expect(source).toContain(": inbox.refetch())")
    expect(source).toContain("disabled={inbox.isFetching}")
  })
})
