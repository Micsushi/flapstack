# S3-F12 - Permission Mode Promotion

- Outcome: custom and project-only modes return only with durable hierarchy
  defaults, exact scoped semantics, and provider/product enforcement evidence.
- Change: `openspec/changes/complete-settings-reliability/`
- Dependency: `openspec/changes/sync-provider-permissions-globally/`
- Specification: `openspec/changes/complete-settings-reliability/specs/settings-reliability/spec.md`
- Tasks: `openspec/changes/complete-settings-reliability/tasks.md`
- Task IDs: S3-F12-T1 through S3-F12-T5
- Dependencies: GPP-T4, GPP-T6, GPP-T9, GPP-T10, and S3-F3-T5.
- Estimate: 6-10 engineering days after active permission closeout.
- Promotion gate: explicit custom capabilities and exact, provider-aware
  project-boundary enforcement; all-chat custom is unavailable until durable
  global/project/task defaults exist; best-effort mappings do not pass as exact.
