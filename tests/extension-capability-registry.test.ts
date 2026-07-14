import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  EXTENSION_CAPABILITY_SCHEMA_VERSION,
  extensionBaselineGaps,
  extensionCapabilityId,
  extensionCapabilityRegistry,
  extensionHarnessBaselines,
  extensionHarnesses,
  extensionKinds,
  extensionScopes,
  getExtensionCapabilityForManifest,
} from "../src/main/lib/extension-management"
import { discoverProviderExtensions } from "../src/main/lib/provider-extensions"
import { hooksManagementRouter } from "../src/main/lib/trpc/routers/hooks-management"
import { providerExtensionsRouter } from "../src/main/lib/trpc/routers/provider-extensions"

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("Stage 3 extension capability baseline", () => {
  it("is exhaustive across every harness, kind, and scope", () => {
    expect(extensionCapabilityRegistry).toHaveLength(
      extensionHarnesses.length * extensionKinds.length * extensionScopes.length,
    )
    expect(new Set(extensionCapabilityRegistry.map((row) => row.id)).size).toBe(
      extensionCapabilityRegistry.length,
    )

    for (const harness of extensionHarnesses) {
      for (const kind of extensionKinds) {
        for (const scope of extensionScopes) {
          expect(extensionCapabilityRegistry).toContainEqual(
            expect.objectContaining({
              id: extensionCapabilityId(harness, kind, scope),
              harness,
              kind,
              scope,
            }),
          )
        }
      }
    }
  })

  it("matches the pinned shipped-harness fixture", () => {
    const fixture = JSON.parse(
      readFileSync("tests/fixtures/extension-management/stage3-capability-baseline.json", "utf8"),
    )
    const harnesses = extensionHarnessBaselines.map((row) =>
      [row.harness, row.adapter, row.version, row.provenance].join("|"),
    )
    const capabilities = extensionCapabilityRegistry
      .filter((row) => row.inventory !== "unsupported")
      .map((row) =>
        [
          row.id,
          row.inventory,
          row.mutations.join(","),
          row.runtimeConsumption,
          row.settingsSurface,
          row.nativePaths.join(","),
        ].join("|"),
      )

    expect({
      schemaVersion: EXTENSION_CAPABILITY_SCHEMA_VERSION,
      harnesses,
      capabilities,
    }).toEqual(fixture)
  })

  it("maps every discovered provider DTO to a non-unsupported registry row", async () => {
    const home = temporaryRoot()
    const cwd = join(home, "project")
    write(join(home, ".claude", "skills", "claude-skill", "SKILL.md"), skill("claude-skill"))
    write(join(home, ".claude", "commands", "claude-command.md"), "Claude command")
    write(join(home, ".claude", "agents", "claude-agent.md"), skill("claude-agent"))
    write(join(home, ".agents", "skills", "codex-skill", "SKILL.md"), skill("codex-skill"))
    write(join(cwd, ".cursor", "commands", "cursor-command.md"), "Cursor command")
    write(join(cwd, ".opencode", "skills", "open-skill", "SKILL.md"), skill("open-skill"))
    write(join(home, ".claude.json"), JSON.stringify({ mcpServers: { claudeMcp: {} } }))
    write(join(home, ".codex", "config.toml"), "[mcp_servers.codex_mcp]\ncommand = 'x'\n")
    write(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { cursorMcp: {} } }))
    write(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ mcp: { openMcp: {} } }),
    )

    const inventory = await discoverProviderExtensions({ cwd, homeDir: home })
    const expectedNames = new Set([
      "claude-skill",
      "claude-command",
      "claude-agent",
      "codex-skill",
      "cursor-command",
      "claudeMcp",
      "codex_mcp",
      "cursorMcp",
      "openMcp",
      "open-skill",
    ])
    const fixtures = inventory.filter((item) => expectedNames.has(item.name))

    expect(fixtures.map((item) => item.name).sort()).toEqual([...expectedNames].sort())
    for (const item of fixtures) {
      expect(getExtensionCapabilityForManifest(item).inventory).not.toBe("unsupported")
    }
  })

  it("promotes managed hooks while keeping native runtime consumption honest", async () => {
    const state = await hooksManagementRouter
      .createCaller({ getWindow: () => null })
      .getCapabilities()

    expect(state.enabled).toBe(true)
    expect(state.importDefault).toBe("disabled")
    expect(state.approval).toBe("tier-3-for-dry-run-and-enable")
    for (const harness of state.harnesses) {
      for (const scope of ["user", "project"] as const) {
        expect(
          extensionCapabilityRegistry.find(
            (row) => row.id === extensionCapabilityId(harness, "hook", scope),
          ),
        ).toMatchObject({
          inventory: "supported",
          mutations: ["enable", "disable"],
          runtimeConsumption: "not-consumed",
        })
      }
    }
  })

  it("exposes the registry and exact additive gaps through the production router", async () => {
    const result = await providerExtensionsRouter
      .createCaller({ getWindow: () => null })
      .getCapabilities()

    expect(result.schemaVersion).toBe(EXTENSION_CAPABILITY_SCHEMA_VERSION)
    expect(result.capabilities).toEqual(extensionCapabilityRegistry)
    expect(result.additiveGaps).toEqual(extensionBaselineGaps)
    expect(result.additiveGaps.map((gap) => gap.id)).toEqual([
      "native-adapter-safety",
      "scoped-enablement",
      "cross-harness-copy",
      "manager-ui",
      "hook-lifecycle",
    ])
  })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "flapstack-extension-capabilities-"))
  temporaryRoots.push(root)
  return root
}

function write(file: string, content: string): void {
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, content)
}

function skill(name: string): string {
  return `---\nname: ${name}\ndescription: ${name}\n---\n\n${name}\n`
}
