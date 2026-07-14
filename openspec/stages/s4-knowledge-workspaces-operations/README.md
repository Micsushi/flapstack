# S4 — Knowledge, Workspaces, and Multi-Agent Operations

Stage 4 turns Flapstack's Stage 3 control primitives into a durable daily
operating environment.

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
10. [S4-F10 Cross-agent mobile companion](features/s4-f10-mobile-companion/README.md)

All ten features are promoted into authoritative OpenSpec changes containing
77 bounded tasks. Dependency waves and pickup rules live in
`docs/stage4-execution-plan.md`.

Entry gate: Stage 3 implementation is merged, but Stage 4 implementation must
not claim an integrated start until the remaining Stage 3 live/provider/package
evidence is closed or recorded as an explicit blocker.

Stage verification: `docs/stage4-full-feature-test-matrix.md` plus Node 22
`npm run check`, strict validation of every Stage 4 OpenSpec change, verified
`Flapstack Dev` live walkthroughs, and packaged macOS preview smoke.

Stage 4 is the final planned stage for now. There is no Stage 5 roadmap.

These files are navigation only. Task status lives only in linked OpenSpec
`tasks.md` files.
