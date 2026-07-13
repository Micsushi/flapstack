import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  filterProviderExtensions,
  isProviderExtensionWritable,
} from "../src/renderer/features/settings/provider-extension-view"
import type { ProviderExtensionManifest } from "../src/main/lib/provider-extensions"

describe("provider-scoped extension Settings", () => {
  it("filters duplicate names by exact provider without merging identities", () => {
    const inventory = [item("claude", "same", "next-run"), item("codex", "same", "next-run")]
    expect(
      filterProviderExtensions(inventory, {
        provider: "codex",
        kind: "skill",
        query: "same",
      }).map((entry) => entry.id),
    ).toEqual(["codex:skill:codex-source"])
  })

  it("hides writes when runtime consumption is read-only or unknown", () => {
    expect(isProviderExtensionWritable(item("claude", "writable", "next-run"))).toBe(true)
    expect(isProviderExtensionWritable(item("opencode", "isolated", "read-only"))).toBe(false)
    expect(isProviderExtensionWritable(item("cursor", "unknown", "unknown"))).toBe(false)
  })

  it("exposes keyboard and screen-reader labels for filters, refresh, and delete", () => {
    const source = readFileSync(
      "src/renderer/components/dialogs/settings-tabs/agents-provider-extensions-tab.tsx",
      "utf8",
    )
    expect(source).toContain('aria-label="Provider filter"')
    expect(source).toContain('aria-label="Extension kind"')
    expect(source).toContain('aria-label="Refresh provider extensions"')
    expect(source).toContain('aria-label="Delete extension"')
  })
})

function item(
  provider: ProviderExtensionManifest["provider"],
  name: string,
  runtime: ProviderExtensionManifest["capabilities"]["runtime"],
): ProviderExtensionManifest {
  const sourceId = `${provider}-source`
  return {
    schemaVersion: 1,
    id: `${provider}:skill:${sourceId}`,
    provider,
    kind: "skill",
    sourceId,
    source: "user",
    name,
    description: `${provider} ${name}`,
    path: `/tmp/${provider}/${name}`,
    capabilities: {
      discovery: "supported",
      create: true,
      update: true,
      delete: true,
      runtime,
    },
    limitations: [],
  }
}
