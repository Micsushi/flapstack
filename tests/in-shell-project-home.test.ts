import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const appSource = readFileSync(resolve("src/renderer/App.tsx"), "utf8")
const agentsContentSource = readFileSync(
  resolve("src/renderer/features/agents/ui/agents-content.tsx"),
  "utf8",
)
const selectRepoSource = readFileSync(
  resolve("src/renderer/features/onboarding/select-repo-page.tsx"),
  "utf8",
)

describe("in-shell project home", () => {
  it("keeps the agents shell mounted when no project is selected", () => {
    expect(appSource).not.toContain("return <SelectRepoPage />")
    expect(appSource).toContain("return <AgentsLayout />")
  })

  it("renders the repository picker as an embedded empty state", () => {
    expect(agentsContentSource).toContain("<SelectRepoPage embedded />")
    expect(selectRepoSource).toContain("embedded?: boolean")
    expect(selectRepoSource).toContain('embedded ? "h-full w-full" : "h-screen w-screen"')
  })
})
