export const CODEX_TRANSPORT_DECISION = {
  selectedAdapter: "codex-acp/app-server",
  adapterPackage: "@agentclientprotocol/codex-acp",
  pinnedAdapterVersion: "1.1.2",
  backendCommand: "codex app-server",
  decision: "retain-acp",
  rationale:
    "The pinned ACP adapter already starts Codex App Server and translates its thread and turn protocol. A direct adapter would duplicate that translation without adding a verified capability.",
  capabilities: {
    threadStart: true,
    threadResume: true,
    turnStart: true,
    cancellation: true,
    permissions: true,
    tools: true,
    skills: true,
    mcp: true,
    modelSelection: true,
    contextInjection: true,
    telemetry: true,
    recovery: true,
  },
  rollback:
    "Keep the ACP boundary. If a future direct App Server adapter fails its fixture gate, switch provider construction back to @mcpc-tech/acp-ai-provider with the pinned codex-acp command.",
} as const
