# S6 — Product Polish, Personalization, and Reach

Status: core implementation and Tier 2 acceptance complete. All 60 `T2-core`
matrix rows are accepted. Ten optional capability rows and sixteen release
rows remain open and are not claims of missing core code.

Stage 6 builds on the Stage 5 Windows `T2-core` implementation baseline to
create an approachable, refined, cross-device, cross-platform product ready for
wider distribution.

Delivery order:

1. [S6-F1 Product-wide UI/UX polish](features/s6-f1-product-ui-ux-polish/README.md)
2. [S6-F2 Guided onboarding and feature visibility](features/s6-f2-guided-onboarding-visibility/README.md)
3. [S6-F3 Agent Profiles and reusable personalities](features/s6-f3-agent-profiles-personalities/README.md)
4. [S6-F4 Cross-agent mobile companion](features/s6-f4-mobile-companion/README.md)
5. [S6-F5 Visual context and screenshot capture](features/s6-f5-visual-context/README.md)
6. [S6-F6 Multi-pane Chat and swarm workspaces](features/s6-f6-terminal-grid-swarm/README.md)
7. [S6-F7 Runtime/orchestration composition](features/s6-f7-runtime-orchestration-composition/README.md)
8. [S6-F8 Organization usage APIs](features/s6-f8-organization-usage/README.md)
9. [S6-F9 Performance and scale](features/s6-f9-performance-scale/README.md)
10. [S6-F10 Cross-platform public distribution](features/s6-f10-platform-distribution/README.md)
11. [S6-F12 Obsidian-compatible project knowledge graph](features/s6-f12-obsidian-knowledge-graph/README.md)
12. [S6-F11 Integrated Stage 6 release](features/s6-f11-integrated-release/README.md)

Entry gate: all 50 Stage 5 implementation-gating task checkboxes and all 40
Stage 5 `T2-core` matrix rows are accepted on one exact source state. That
baseline includes accepted Stage 4 behavior. Open provider/device capability
and distributable-release rows do not block Stage 6 entry; downstream Stage 6
features must preserve them as explicit dependencies when they consume those
capabilities or artifacts.

Dependency spine:

- F1 establishes shared interaction, accessibility, responsive, and visual
  primitives consumed by F2, F3, F4, F5, and F6.
- F2 and F3 must preserve Stage 4 safety and authority while simplifying first
  use and agent selection.
- F4, F5, and F6 reuse existing chats, runs, workspaces, approvals, audit, and
  orchestration services; none creates a second control plane.
- F7 closes known F3/F11 seams before F4/F6 and integrated mixed-agent proof.
- F8 feeds organization-aware usage into existing Stage 4 usage surfaces.
- F9 defines and enforces performance budgets before public distribution.
- F10 promotes macOS/Linux distribution and extends accepted Stage 5 Windows
  evidence across new Stage 6 features and production release credentials.
- F12 extends the accepted S4-F2 vault and consumes F1 interaction primitives,
  F9 budgets, and F10 native package evidence.
- F11 begins only after F1 through F10 and F12 feature exits.

Stage verification is split by evidence class in
`docs/stage6-full-feature-test-matrix.md`. Node 22 checks, strict OpenSpec,
deterministic/live core workflows, performance, and independent core review
closed Tier 2. Signed/notarized macOS, native promoted packages, real optional
devices/providers, assistive technology, Obsidian interop, and long observation
remain capability or release certification.

These files are navigation only. Task status lives only in linked OpenSpec
tasks.md files.
