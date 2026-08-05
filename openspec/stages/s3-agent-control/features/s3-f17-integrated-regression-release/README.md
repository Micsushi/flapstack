# S3-F17 — Integrated Regression and Release

Status: complete at Tier 2. Stage 3 closed at 48/48 integrated rows.

- Change: `openspec/changes/archive/2026-07-14-validate-stage3-release/`
- Design: `openspec/changes/archive/2026-07-14-validate-stage3-release/design.md`
- Specification:
  `openspec/specs/integrated-stage3-release/spec.md`
- Tasks: `openspec/changes/archive/2026-07-14-validate-stage3-release/tasks.md`
- Task IDs:
  - S3-F17-T1 — Freeze the release manifest and unified evidence ledger
  - S3-F17-T2 — Pass automated, migration, MCP, daemon, and package gates
  - S3-F17-T3 — Pass isolated live-dev and packaged regression matrices
  - S3-F17-T4 — Run up to three independent review and repair rounds
  - S3-F17-T5 — Reconcile, archive, clean up, and hand off Stage 3
- Migrated authority: former Stage 2 task `7.2` and all integrated/manual
  regression and release ownership.
- Dependencies: S3-F6 MCP closeout; S3-F9 Voice; S3-F10 credentials; S3-F12
  permissions; S3-F13 Settings; S3-F14 Usage; S3-F15 providers; S3-F16 reasoning.
- Boundary: the user owns squash-merge to `main`.
