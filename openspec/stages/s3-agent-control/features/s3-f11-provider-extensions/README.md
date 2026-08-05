# S3-F11 - Provider-Scoped Extensions

Status: complete at Tier 2. Stage 4 owns later unified extension management.

- Outcome: skills, commands, plugins, custom agents, and third-party MCP configs
  keep provider-scoped identity and expose only supported operations.
- Change: `openspec/changes/archive/2026-07-14-complete-settings-reliability/`
- Specification: `openspec/specs/settings-reliability/spec.md`
- Tasks: `openspec/changes/archive/2026-07-14-complete-settings-reliability/tasks.md`
- Task IDs: S3-F11-T1 through S3-F11-T5
- Estimate: 7-12 engineering days.
- Promotion gate: provider-scoped identity, honest discovery/mutation
  capability, duplicate safety, runtime consumption, and package evidence.
- Boundary: third-party provider MCP entries never merge with product app-control
  stdio MCP or development test-control HTTP MCP.
