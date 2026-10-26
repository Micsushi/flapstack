import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  "src/renderer/components/dialogs/settings-tabs/agents-permissions-tab.tsx",
  "utf8",
)

describe("agents permissions settings recovery", () => {
  it("keeps query failures visible and mutations gated", () => {
    expect(source).toContain("PermissionQueryStatus")
    expect(source).toContain(
      "Could not load {label}. Existing values are read-only until it succeeds.",
    )
    expect(source).toContain("placeholderData: (previous) => previous")
    expect(source).toContain("preferencesUnavailable")
    expect(source).toContain("chatListUnavailable")
    expect(source).toContain("chatsError && !chatData ? null")
    expect(source).toContain("disabled={preferencesUnavailable || setChangeBehavior.isPending}")
    expect(source).toContain("disabled={chatListUnavailable || setChatMode.isPending}")
    expect(source).toContain("onRetry={() => void refetchPreferences()}")
    expect(source).toContain("onRetry={() => void refetchChats()}")
  })
})
