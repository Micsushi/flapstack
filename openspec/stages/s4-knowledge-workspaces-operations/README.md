# S4 — Knowledge, Workspaces, and Multi-Agent Operations

Stage 4 turns Flapstack's Stage 3 control primitives into a durable daily
operating environment.

Release position: the Stage 4 feature-code pass is included in the macOS-only
`0.1.0` beta. Project Memory, Orchestration, Saved Workspaces, Automations, and
Planning & Task Board are optional Beta Features and default off. Exposed Stage
4 code remains beta-supported until its live, provider, package, and OS evidence
closes; inclusion is not a stable-support claim.

Delivery order:

1. [S4-F1 Unified skills and hooks manager](features/s4-f1-unified-skills-hooks/README.md)
2. [S4-F2 Project knowledge vaults](features/s4-f2-project-knowledge-vaults/README.md)
3. [S4-F3 Multi-agent operations](features/s4-f3-multi-agent-operations/README.md)
4. [S4-F4 Saved workspaces](features/s4-f4-saved-workspaces/README.md)
5. [S4-F5 Automation and scheduler](features/s4-f5-automation-scheduler/README.md)
6. [S4-F6 Local models](features/s4-f6-local-models/README.md)
7. [S4-F7 Advanced usage and limits](features/s4-f7-advanced-usage-limits/README.md)
8. [S4-F8 Import/export and private sync](features/s4-f8-import-export-private-sync/README.md)
9. [S4-F9 Plan and Kanban views](features/s4-f9-plan-kanban/README.md)
10. [S4-F11 Agent runtimes](features/s4-f11-agent-runtimes/README.md)
11. [S4-F12 Agent profiles and personalities](features/s4-f12-agent-profiles-personalities/README.md)

All eleven features are promoted into authoritative OpenSpec changes containing
87 bounded tasks. Dependency waves and pickup rules live in
`docs/stage4-execution-plan.md`.

Entry gate: Agent Runtime planning targets clean Stage 3 `stage3-final` at
`a674784`. Stage 4 must sync that baseline and must not claim an integrated
start until remaining Stage 3 live/provider/package evidence is closed or
recorded as an explicit blocker.

Stage verification: `docs/stage4-full-feature-test-matrix.md` plus Node 22
`npm run check`, strict validation of all eleven Stage 4 OpenSpec changes, verified
`Flapstack Dev` live walkthroughs, and packaged macOS preview smoke.

Stage 5 planning lives at
openspec/stages/s5-product-polish-personalization-reach/README.md and begins only
after full Stage 4 acceptance.

These files are navigation only. Task status lives only in linked OpenSpec
`tasks.md` files.
