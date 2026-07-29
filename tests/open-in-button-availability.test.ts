import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve("src/renderer/components/open-in-button.tsx"), "utf8")
const routerSource = readFileSync(resolve("src/main/lib/trpc/routers/external.ts"), "utf8")
const preferencesSource = readFileSync(
  resolve("src/renderer/components/dialogs/settings-tabs/agents-preferences-tab.tsx"),
  "utf8",
)

describe("Open in menu availability", () => {
  it("loads available apps from the main process and filters every group", () => {
    expect(source).toContain("trpc.external.listAvailableApps.useQuery()")
    expect(source).toContain("filterAvailableApps(APP_OPTIONS")
    expect(source).toContain("filterAvailableApps(VSCODE_OPTIONS")
    expect(source).toContain("filterAvailableApps(JETBRAINS_OPTIONS")
    expect(routerSource).toContain("listAvailableApps: publicProcedure.query")
  })

  it("uses a folder icon and platform-native label for the folder action", () => {
    expect(source).toContain("<FolderOpen")
    expect(source).toContain("folderLabel")
  })

  it("filters the preferred-editor settings menu through the same availability result", () => {
    expect(preferencesSource).toContain("trpc.external.listAvailableApps.useQuery()")
    expect(preferencesSource).toContain("availableEditors")
    expect(preferencesSource).toContain("availableTerminals")
    expect(preferencesSource).toContain("availableVsCode")
    expect(preferencesSource).toContain("availableJetBrains")
  })
})
