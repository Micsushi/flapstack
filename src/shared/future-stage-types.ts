export const futureStageIds = [
  "stage2-voice",
  "stage3-mcp-control",
  "automation",
  "model-providers",
  "skill-manager",
  "usage-limits",
  "project-vaults",
  "spawned-agents",
  "import-export",
  "hooks-management",
] as const

export type FutureStageId = (typeof futureStageIds)[number]

export type ScaffoldStatus = "planned" | "scaffolded" | "blocked" | "experimental" | "ready"

export type FutureStageCapability = {
  id: FutureStageId
  stage: string
  title: string
  status: ScaffoldStatus
  gate: string
  summary: string
  dependencies: string[]
}

export const futureStageCapabilities: FutureStageCapability[] = [
  {
    id: "stage2-voice",
    stage: "Stage 2",
    title: "Voice input and read-aloud",
    status: "experimental",
    gate: "Clean-install and platform manual acceptance",
    summary: "Working dictation, local TTS, settings, and harness-authored read-aloud output.",
    dependencies: ["Stage 1 exit"],
  },
  {
    id: "stage3-mcp-control",
    stage: "Stage 3",
    title: "MCP app control surface",
    status: "scaffolded",
    gate: "Operations catalog and risk tiers",
    summary: "Local MCP tool registry, risk tiers, gate decisions, and audit-log contract.",
    dependencies: ["Stage 1 exit"],
  },
  {
    id: "automation",
    stage: "Later",
    title: "Automation and scheduler",
    status: "scaffolded",
    gate: "Scheduler runtime, trigger catalog, retry and budget policy",
    summary: "Local-first automation schemas and disabled scheduler contract.",
    dependencies: ["Stage 1", "Stage 3 gate/audit"],
  },
  {
    id: "model-providers",
    stage: "Later",
    title: "Local models and OpenRouter",
    status: "scaffolded",
    gate: "Local-model runtime; OpenRouter and NanoGPT are active through OpenCode",
    summary: "OpenRouter and NanoGPT are implemented; local-model execution remains future work.",
    dependencies: ["Stage 1 harness contract"],
  },
  {
    id: "skill-manager",
    stage: "Later",
    title: "Full skill manager",
    status: "planned",
    gate: "Canonical skill representation and adapter matrix",
    summary: "Unified skill inventory will build on existing skills/commands routers.",
    dependencies: ["Stage 1"],
  },
  {
    id: "usage-limits",
    stage: "Stage 2",
    title: "Usage and limits tracking",
    status: "experimental",
    gate: "Provider live matrix and daemon acceptance",
    summary: "Run usage, provider polling, rollups, alerts, and daemon controls are implemented.",
    dependencies: ["Stage 1 run records"],
  },
  {
    id: "project-vaults",
    stage: "Later",
    title: "Per-project vaults",
    status: "scaffolded",
    gate: "Vault location, typed sections, and secrets policy",
    summary: "Typed vault section registry and scaffold plan contract.",
    dependencies: ["Stage 1 projects/tasks/attachments"],
  },
  {
    id: "spawned-agents",
    stage: "Later",
    title: "Spawned-agent graph",
    status: "scaffolded",
    gate: "Spawn permission, budget model, lineage schema, kill policy",
    summary: "Lineage and budget policy contract with spawning disabled by default.",
    dependencies: ["Stage 1", "Stage 3", "Automation or app-owned loop"],
  },
  {
    id: "import-export",
    stage: "Later",
    title: "Import/export and private sync",
    status: "scaffolded",
    gate: "Bundle format, secrets handling, sync conflict policy",
    summary: "Export scope and dry-run import contract.",
    dependencies: ["Stage 1", "Project vaults for vault sync"],
  },
  {
    id: "hooks-management",
    stage: "Later",
    title: "Hooks management",
    status: "scaffolded",
    gate: "Hook systems, edit scope, validation and dry-run policy",
    summary: "Hook inventory/template contract with execution disabled.",
    dependencies: ["Stage 1"],
  },
]
