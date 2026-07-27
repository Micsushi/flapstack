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
    status: "experimental",
    gate: "Native app, provider, restart, and packaged acceptance",
    summary:
      "Implemented local MCP registry, caller-scoped risk gates, approvals, spawning, and durable audit.",
    dependencies: ["Stage 1 exit"],
  },
  {
    id: "automation",
    stage: "Stage 4",
    title: "Automation and scheduler",
    status: "experimental",
    gate: "Native app trigger, restart, cancellation, and packaged acceptance",
    summary:
      "Implemented local scheduler, triggers, approval gates, retries, budgets, history, and management UI.",
    dependencies: ["Stage 1", "Stage 3 gate/audit"],
  },
  {
    id: "model-providers",
    stage: "Stage 4",
    title: "Local models and OpenRouter",
    status: "experimental",
    gate: "Supported local-provider live, recovery, and packaged acceptance",
    summary:
      "OpenRouter, NanoGPT, and local-model execution are implemented with capability and permission gates.",
    dependencies: ["Stage 1 harness contract"],
  },
  {
    id: "skill-manager",
    stage: "Stage 4",
    title: "Full skill manager",
    status: "experimental",
    gate: "Native app, hook lifecycle, restart, and packaged acceptance",
    summary:
      "Implemented unified skill, command, extension, policy, and managed-hook inventory and lifecycle.",
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
    stage: "Stage 4",
    title: "Per-project vaults",
    status: "experimental",
    gate: "Native editor/search, conflict, restart, and packaged acceptance",
    summary:
      "Implemented typed project vaults, safe context selection, search, conflict handling, and backup recovery.",
    dependencies: ["Stage 1 projects/tasks/attachments"],
  },
  {
    id: "spawned-agents",
    stage: "Stages 3–4",
    title: "Spawned-agent graph",
    status: "experimental",
    gate: "Provider, pause/resume, restart, and packaged orchestration acceptance",
    summary:
      "Implemented caller-scoped spawning, durable lineage, budgets, cancellation, fleets, and workflows.",
    dependencies: ["Stage 1", "Stage 3", "Automation or app-owned loop"],
  },
  {
    id: "import-export",
    stage: "Stage 4",
    title: "Import/export and private sync",
    status: "experimental",
    gate: "Clean-profile UI, private-remote, recovery, and packaged acceptance",
    summary:
      "Implemented secret-safe bundles, transactional import preview/recovery, and explicit private Git sync.",
    dependencies: ["Stage 1", "Project vaults for vault sync"],
  },
  {
    id: "hooks-management",
    stage: "Stage 4",
    title: "Hooks management",
    status: "experimental",
    gate: "Native validation, dry-run, enablement, runtime, and packaged acceptance",
    summary:
      "Implemented hook inventory, safe import, validation, bounded dry-run, explicit enablement, and audit.",
    dependencies: ["Stage 1"],
  },
]
