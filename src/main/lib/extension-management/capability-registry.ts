import type {
  ProviderExtensionKind,
  ProviderExtensionManifest,
  ProviderExtensionProvider,
} from "../provider-extensions/contract"

export const EXTENSION_CAPABILITY_SCHEMA_VERSION = 1 as const

export const extensionHarnesses = ["claude-code", "codex", "cursor-agent", "opencode"] as const
export const extensionKinds = ["skill", "command", "plugin", "custom-agent", "mcp", "hook"] as const
export const extensionScopes = ["user", "project", "plugin"] as const

export type ExtensionHarness = (typeof extensionHarnesses)[number]
export type ExtensionKind = (typeof extensionKinds)[number]
export type ExtensionScope = (typeof extensionScopes)[number]
export type ExtensionInventorySupport = "supported" | "compatibility" | "disabled" | "unsupported"
export type ExtensionMutation = "create" | "update" | "delete" | "enable" | "disable"
export type ExtensionRuntimeConsumption = "supported" | "not-consumed" | "unknown" | "disabled"
export type ExtensionSettingsSurface = "provider-extensions" | "mcp" | "none"

export type ExtensionHarnessBaseline = {
  harness: ExtensionHarness
  adapter: string
  version: string
  provenance: "bundled" | "fixture"
}

export type ExtensionCapability = {
  schemaVersion: typeof EXTENSION_CAPABILITY_SCHEMA_VERSION
  id: string
  harness: ExtensionHarness
  provider: ProviderExtensionProvider
  kind: ExtensionKind
  scope: ExtensionScope
  inventory: ExtensionInventorySupport
  mutations: ExtensionMutation[]
  runtimeConsumption: ExtensionRuntimeConsumption
  settingsSurface: ExtensionSettingsSurface
  nativePaths: string[]
  limitations: string[]
}

export type ExtensionBaselineGap = {
  id: string
  currentBehavior: string
  additiveNeed: string
  owner: "S4-F1-T2" | "S4-F1-T3" | "S4-F1-T4" | "S4-F1-T5" | "S4-F1-T6"
}

export const extensionHarnessBaselines: ExtensionHarnessBaseline[] = [
  {
    harness: "claude-code",
    adapter: "@anthropic-ai/claude-agent-sdk",
    version: "0.3.207 / Claude Code 2.1.207",
    provenance: "bundled",
  },
  {
    harness: "codex",
    adapter: "@agentclientprotocol/codex-acp",
    version: "1.1.2 / Codex CLI 0.144.1",
    provenance: "bundled",
  },
  {
    harness: "cursor-agent",
    adapter: "cursor-agent CLI",
    version: "2026.07.09-a3815c0",
    provenance: "fixture",
  },
  {
    harness: "opencode",
    adapter: "opencode-ai sidecar",
    version: "1.17.18",
    provenance: "bundled",
  },
]

const providerByHarness: Record<ExtensionHarness, ProviderExtensionProvider> = {
  "claude-code": "claude",
  codex: "codex",
  "cursor-agent": "cursor",
  opencode: "opencode",
}

type CapabilityOverride = Omit<
  ExtensionCapability,
  "schemaVersion" | "id" | "provider" | "limitations"
> & {
  limitations?: string[]
}

const promoted: CapabilityOverride[] = [
  ...nativeContent("claude-code", "skill", ["user", "project"]),
  ...nativeContent("claude-code", "command", ["user", "project"]),
  ...nativeContent("claude-code", "custom-agent", ["user", "project"]),
  legacyPluginComponent("skill"),
  legacyPluginComponent("command"),
  legacyPluginComponent("custom-agent"),
  capability(
    "claude-code",
    "plugin",
    "plugin",
    "supported",
    [],
    "unknown",
    ["~/.claude/plugins/marketplaces/*"],
    "provider-extensions",
    [
      "Installed plugins are inventory-only in Provider Extensions; the legacy plugin router owns enablement.",
    ],
  ),
  ...claudeMcp(),
  capability(
    "claude-code",
    "mcp",
    "plugin",
    "supported",
    ["enable", "disable"],
    "supported",
    ["~/.claude/plugins/marketplaces/*/.mcp.json"],
    "mcp",
    ["Plugin MCP enablement is an approval record; provider files remain read-only."],
  ),
  ...managedHooks("claude-code"),

  capability(
    "codex",
    "skill",
    "user",
    "supported",
    ["create", "update", "delete"],
    "supported",
    ["~/.agents/skills/*/SKILL.md", "~/.codex/skills/*/SKILL.md"],
    "provider-extensions",
    ["~/.codex/skills is compatibility inventory; ~/.agents/skills is the writable native root."],
  ),
  capability(
    "codex",
    "skill",
    "project",
    "supported",
    ["create", "update", "delete"],
    "supported",
    ["<project>/.agents/skills/*/SKILL.md", "<project>/.codex/skills/*/SKILL.md"],
    "provider-extensions",
    [
      "The legacy skills router also scans .codex/skills; the native writable root is .agents/skills.",
    ],
  ),
  ...legacyCodexCommands(),
  ...codexMcp(),
  ...managedHooks("codex"),

  capability(
    "cursor-agent",
    "command",
    "project",
    "supported",
    ["create", "update", "delete"],
    "supported",
    ["<project>/.cursor/commands/*.md"],
    "provider-extensions",
  ),
  ...readOnlyMcp("cursor-agent", ["user", "project"], "unknown"),

  ...opencodeInventory("skill", ["user", "project"]),
  ...opencodeInventory("command", ["user", "project"]),
  ...opencodeInventory("plugin", ["user", "project"]),
  ...opencodeInventory("custom-agent", ["user", "project"]),
  ...readOnlyMcp("opencode", ["user", "project"], "not-consumed"),
]

export const extensionCapabilityRegistry: ExtensionCapability[] = extensionHarnesses.flatMap(
  (harness) =>
    extensionKinds.flatMap((kind) =>
      extensionScopes.map((scope) => {
        const override = promoted.find(
          (entry) => entry.harness === harness && entry.kind === kind && entry.scope === scope,
        )
        const base =
          override ??
          capability(harness, kind, scope, "unsupported", [], "unknown", [], "none", [
            "No Stage 3 inventory, mutation, or runtime-consumption contract exists for this combination.",
          ])
        return {
          ...base,
          schemaVersion: EXTENSION_CAPABILITY_SCHEMA_VERSION,
          id: extensionCapabilityId(harness, kind, scope),
          provider: providerByHarness[harness],
          limitations: base.limitations ?? [],
        }
      }),
    ),
)

export const extensionBaselineGaps: ExtensionBaselineGap[] = [
  {
    id: "native-adapter-safety",
    currentBehavior:
      "Rooted native adapters expose lossless read, preview, apply, backup, and restore DTOs for supported mutable rows.",
    additiveNeed:
      "Retain T2 ownership of live Settings, runtime reload, package, and integrated acceptance evidence.",
    owner: "S4-F1-T2",
  },
  {
    id: "scoped-enablement",
    currentBehavior:
      "Persisted user, project, and task policy resolves into supported harness launch contracts without rewriting native files.",
    additiveNeed:
      "Retain T3 ownership of live provider behavior plus Dev-profile and packaged restart evidence.",
    owner: "S4-F1-T3",
  },
  {
    id: "cross-harness-copy",
    currentBehavior:
      "Cross-harness copy exposes exact, converted, or unsupported previews before any confirmed native write.",
    additiveNeed: "Retain T4 ownership of dependency-gated sharing acceptance.",
    owner: "S4-F1-T4",
  },
  {
    id: "manager-ui",
    currentBehavior:
      "The unified Settings manager consumes registry, adapter, policy, copy, and managed-hook DTOs while compatibility routers remain callable.",
    additiveNeed:
      "Retain T5 ownership of the live user/project/task walkthrough, screen-reader observation, restart, and package evidence.",
    owner: "S4-F1-T5",
  },
  {
    id: "hook-lifecycle",
    currentBehavior:
      "Managed Claude Code and Codex hook records validate, dry-run, audit, enable explicitly, and are injected into direct native harness launches.",
    additiveNeed:
      "Retain T6 ownership of live enable/disable and provider-observed runtime evidence without weakening the managed safety gate.",
    owner: "S4-F1-T6",
  },
]

export function extensionCapabilityId(
  harness: ExtensionHarness,
  kind: ExtensionKind,
  scope: ExtensionScope,
): string {
  return `${harness}:${kind}:${scope}`
}

export function getExtensionCapabilityForManifest(
  manifest: Pick<ProviderExtensionManifest, "provider" | "kind" | "source">,
): ExtensionCapability {
  const harness = extensionHarnesses.find(
    (candidate) => providerByHarness[candidate] === manifest.provider,
  )
  if (!harness) throw new Error(`Unknown extension provider: ${manifest.provider}`)
  const row = extensionCapabilityRegistry.find(
    (candidate) =>
      candidate.harness === harness &&
      candidate.kind === manifest.kind &&
      candidate.scope === manifest.source,
  )
  if (!row) {
    throw new Error(`Missing extension capability: ${harness}:${manifest.kind}:${manifest.source}`)
  }
  return row
}

function capability(
  harness: ExtensionHarness,
  kind: ExtensionKind,
  scope: ExtensionScope,
  inventory: ExtensionInventorySupport,
  mutations: ExtensionMutation[],
  runtimeConsumption: ExtensionRuntimeConsumption,
  nativePaths: string[],
  settingsSurface: ExtensionSettingsSurface,
  limitations: string[] = [],
): CapabilityOverride {
  return {
    harness,
    kind,
    scope,
    inventory,
    mutations,
    runtimeConsumption,
    settingsSurface,
    nativePaths,
    limitations,
  }
}

function nativeContent(
  harness: "claude-code",
  kind: "skill" | "command" | "custom-agent",
  scopes: Array<"user" | "project">,
): CapabilityOverride[] {
  const directory = kind === "custom-agent" ? "agents" : `${kind}s`
  const suffix = kind === "skill" ? "*/SKILL.md" : "*.md"
  return scopes.map((scope) =>
    capability(
      harness,
      kind,
      scope,
      "supported",
      ["create", "update", "delete"],
      "supported",
      [`${scope === "user" ? "~" : "<project>"}/.claude/${directory}/${suffix}`],
      "provider-extensions",
    ),
  )
}

function legacyPluginComponent(kind: "skill" | "command" | "custom-agent"): CapabilityOverride {
  const directory = kind === "custom-agent" ? "agents" : `${kind}s`
  return capability(
    "claude-code",
    kind,
    "plugin",
    "compatibility",
    [],
    "supported",
    [`~/.claude/plugins/marketplaces/*/${directory}`],
    "none",
    ["Enabled plugin components are exposed by legacy routers and remain provider-file read-only."],
  )
}

function claudeMcp(): CapabilityOverride[] {
  return (["user", "project"] as const).map((scope) =>
    capability(
      "claude-code",
      "mcp",
      scope,
      "supported",
      ["create", "update", "delete"],
      "supported",
      scope === "user"
        ? ["~/.claude.json", "~/.claude/.claude.json", "~/.claude/mcp.json"]
        : [
            "~/.claude.json#projects[<project>]",
            "~/.claude/.claude.json#projects[<project>]",
            "<project>/.mcp.json",
          ],
      "mcp",
      [
        "Third-party provider MCP only; product and development-control MCP identities are excluded.",
      ],
    ),
  )
}

function codexMcp(): CapabilityOverride[] {
  return [
    capability(
      "codex",
      "mcp",
      "user",
      "supported",
      ["create", "delete"],
      "supported",
      ["~/.codex/config.toml"],
      "mcp",
      [
        "Codex MCP Settings currently exposes add and remove for global scope; no update mutation exists.",
      ],
    ),
    capability(
      "codex",
      "mcp",
      "project",
      "supported",
      [],
      "supported",
      ["<project>/.codex/config.toml"],
      "mcp",
      [
        "Project MCP entries are discovered and consumed, but Codex MCP Settings rejects project mutation.",
      ],
    ),
  ]
}

function managedHooks(harness: "claude-code" | "codex"): CapabilityOverride[] {
  return (["user", "project"] as const).map((scope) =>
    capability(
      harness,
      "hook",
      scope,
      "supported",
      ["enable", "disable"],
      "supported",
      ["<Flapstack userData>/data/hook-management.json"],
      "none",
      [
        "Hooks use a managed import-default-off registry with validation, bounded dry-run, approval, audit, and launch-scoped native runtime injection without mutating provider files.",
      ],
    ),
  )
}

function legacyCodexCommands(): CapabilityOverride[] {
  return (["user", "project"] as const).map((scope) =>
    capability(
      "codex",
      "command",
      scope,
      "compatibility",
      ["create", "update", "delete"],
      "unknown",
      [`${scope === "user" ? "~" : "<project>"}/.codex/commands/*.md`],
      "none",
      [
        "The legacy commands router remains callable, but Provider Extensions does not promote Codex commands.",
      ],
    ),
  )
}

function readOnlyMcp(
  harness: "cursor-agent" | "opencode",
  scopes: Array<"user" | "project">,
  runtimeConsumption: "unknown" | "not-consumed",
): CapabilityOverride[] {
  return scopes.map((scope) =>
    capability(
      harness,
      "mcp",
      scope,
      "supported",
      [],
      runtimeConsumption,
      [
        harness === "cursor-agent"
          ? `${scope === "user" ? "~" : "<project>"}/.cursor/mcp.json`
          : scope === "user"
            ? "~/.config/opencode/opencode.json"
            : "<project>/opencode.json",
      ],
      "provider-extensions",
      ["Inventory-only; the visible MCP Settings service manages Claude Code and Codex."],
    ),
  )
}

function opencodeInventory(
  kind: Exclude<ProviderExtensionKind, "mcp">,
  scopes: Array<"user" | "project">,
): CapabilityOverride[] {
  const directory = kind === "custom-agent" ? "agents" : `${kind}s`
  const userRoot = "~/.config/opencode"
  const projectRoot = "<project>/.opencode"
  return scopes.map((scope) =>
    capability(
      "opencode",
      kind,
      scope,
      "supported",
      [],
      "not-consumed",
      [`${scope === "user" ? userRoot : projectRoot}/${directory}`],
      "provider-extensions",
      [
        "Managed OpenCode sidecars isolate native config, so discovered entries are not injected into runs.",
      ],
    ),
  )
}
