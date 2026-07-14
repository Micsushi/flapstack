# S3-F10 - Secure Credentials

- Outcome: remaining renderer-owned provider secrets move through a write-only
  encrypted main-process service without duplicating the existing API-provider store.
- Change: `openspec/changes/complete-settings-reliability/`
- Specification: `openspec/changes/complete-settings-reliability/specs/settings-reliability/spec.md`
- Tasks: `openspec/changes/complete-settings-reliability/tasks.md`
- Task IDs: S3-F10-T1 through S3-F10-T4
- Estimate: 5-8 engineering days.
- Promotion gate: write-only renderer API, encrypted main-process persistence,
  acknowledged migration, no secret leakage, and packaged platform evidence.
- Non-goal: replace provider CLI credentials or the existing OpenRouter/NanoGPT
  secure API-key service.
