# S3-F1 TypeScript and Engineering Debt Board

### S3-F1-T1 - Capture the current debt inventory

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F1
- Outcome: One evidence-backed list classifies every TypeScript, native ABI,
  schema, lint, test, build, and CI issue relevant to Stage 3.
- Scope: Run supported gates on current main; reconcile stale claims; classify
  fix, proven non-blocking deferral, or already resolved.
- Out of scope: Code fixes.
- Acceptance: Every failure has reproduction evidence and destination; stale
  claims are removed.
- Verification: `npm run ts:check`; `npm run check`; inspect CI configuration.
- Blocked by: approved proposal
- Blocks: S3-F1-T2, S3-F1-T3, S3-F1-T4
- Relevant context: `package.json`, CI, native ABI scripts, MCP scaffolds.

### S3-F1-T2 - Clear all TypeScript debt

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F1
- Outcome: The entire repository type-checks with zero errors.
- Scope: Fix every error found by S3-F1-T1 with minimal typed changes and tests.
- Out of scope: Suppression-only fixes or unrelated refactors.
- Acceptance: No weakened compiler options or new ignores hide debt.
- Verification: `npm run ts:check` plus focused tests.
- Blocked by: S3-F1-T1
- Blocks: S3-F1-T5
- Relevant context: S3-F1-T1 inventory and `tsconfig.json`.

### S3-F1-T3 - Stabilize native and database tooling

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F1
- Outcome: Node tests and Electron builds load native modules without manual ABI
  toggling, and schema generation is reproducible.
- Scope: Fix inventory items involving native modules, migrations, resources,
  or ABI markers.
- Out of scope: New MCP audit schema.
- Acceptance: Real load probes pass; schema state is internally consistent.
- Verification: ABI/load probes, focused tests, and production build.
- Blocked by: S3-F1-T1
- Blocks: S3-F1-T5
- Relevant context: native ABI and Drizzle tooling.

### S3-F1-T4 - Reconcile the Stage 3 MCP scaffold

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F1
- Outcome: Current main has one documented MCP starting point without obsolete
  branch assumptions.
- Scope: Compare current modules, routers, tests, and reachable references;
  classify keep, adapt, rebuild, or drop.
- Out of scope: Transport or new tool implementation.
- Acceptance: One module direction is selected; no task depends on a missing
  branch or stale schema claim.
- Verification: repository search and focused existing MCP tests.
- Blocked by: S3-F1-T1
- Blocks: S3-F1-T5, S3-F2-T1
- Relevant context: `src/main/lib/mcp-control` and app-control router.

### S3-F1-T5 - Prove and enforce the Stage 3 entry gate

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F1
- Outcome: Local and CI gates prevent Stage 3 from regressing the baseline.
- Scope: Finish fixes, enforce strict checks, and record only proven deferrals.
- Out of scope: Stage 3 MCP implementation.
- Acceptance: All required gates pass; every deferral has owner, reason, and
  destination; S3-F2 is unblocked.
- Verification: `npm run check` on supported Node 22.
- Blocked by: S3-F1-T2, S3-F1-T3, S3-F1-T4
- Blocks: S3-F2-T1
- Relevant context: this proposal, design, and task evidence.
