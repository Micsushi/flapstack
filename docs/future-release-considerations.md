# Former Future Work Promoted to Stage 6

This file is a compatibility router for links created before Stage 6 existed.
It is no longer an independent backlog. Every previously parked item was
promoted into **Stage 6: Product Polish, Personalization, and Reach** and is
implemented at the `T2-core` level. Remaining optional capability and
distribution evidence stays open only in the Stage 6 matrix.

## Promotion map

| Previous future item                                                                                                   | Stage 6 owner                                        |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Broad UI/UX cleanup, consistency, accessibility, and visual polish                                                     | S6-F1 — Product-wide UI/UX polish                    |
| Dynamic speech vocabulary and voice-input language polish                                                              | S6-F1 — Product-wide UI/UX polish                    |
| First-run tutorial, setup questionnaire, feature visibility, explanations, and alphabetical Settings groups            | S6-F2 — Guided onboarding and feature visibility     |
| Agent Profile chooser, reusable Markdown personalities, launch defaults, speed/effort, and descendant behavior         | S6-F3 — Agent Profiles and reusable personalities    |
| Phone pairing, monitoring, steering, approvals, PWA, and mobile notifications                                          | S6-F4 — Cross-agent mobile companion                 |
| Screenshot capture, visual attachments, annotation, and visual context provenance                                      | S6-F5 — Visual context and screenshot capture        |
| Chat splits, floating windows, terminal grids, saved layouts, multi-agent workspaces, and swarm controls               | S6-F6 — Multi-pane Chat and swarm workspaces         |
| Stage 4 F3/F11 ownership, structured-output, control, activity, and recovery follow-ups                                | S6-F7 — Runtime/orchestration composition            |
| OpenAI and Anthropic organization usage/cost APIs                                                                      | S6-F8 — Organization usage APIs                      |
| Startup, interaction, streaming, concurrency, memory, and long-run performance                                         | S6-F9 — Performance and scale                        |
| Public macOS/Linux distribution plus promotion of accepted Stage 5 Windows artifacts and new-feature evidence          | S6-F10 — Cross-platform public distribution          |
| Six seed notes, custom Markdown nodes/folders, Wikilinks/backlinks, graph/list views, and same-folder Obsidian opening | S6-F12 — Obsidian-compatible project knowledge graph |
| One integrated release candidate and public support statement                                                          | S6-F11 — Integrated Stage 6 release                  |

The former mobile branch is historical implementation input only. The accepted
S6-F4 core now lives in the current repository history; no future task depends
on rebasing that old branch.

## Post-stage owner additions

| Addition                                        | Local implementation status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Remaining authority                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Reusable chat tags and visible chips            | Implemented on local `main`: durable SQLite definitions and assignments, create/assign/remove menu, bounded sidebar chips, and tag-aware search                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Owner walkthrough and any later bulk-management expansion                              |
| Repository worktree and branch overview         | Implemented on local `main`: read-only project dialog, refresh/filter, all worktrees, dirty-state counts, local and remote branches, checked-out mapping, upstream counts, merge state, and unique-commit counts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Owner walkthrough; destructive cleanup actions remain intentionally out of scope       |
| Chat layout and floating-window discoverability | Implemented on local `main`: ordinary Chat items stay ungrouped and open full-screen; grouped Chats live only in their pane tab bars; wider pointer-positioned edge targets create persistent multi-pane groups without directional or toolbar buttons; the middle half of a top Chat/group item enters it after a short drag-hover delay while the outer quarters reorder ordinary Chats between top items; grouped Chats can be dragged back to empty main-bar space or positioned beside a top item; pane-tab center drops move and activate the Chat in that pane while outer quarters reorder; duplicate drag previews do not rerender Chat content; groups can be renamed; blank tab strips move or merge whole panes; rejected fifth splits show no preview; drag-out uses positive new-window feedback and creates a window after renderer readiness | Owner drag, group restore, rename, cross-window, grid, and separate-window walkthrough |

These additions are not missing Stage 6 core work and do not change historical
acceptance counts. They remain uncommitted until the owner finishes the local
walkthrough.

## Authoritative planning

- Stage router: `openspec/stages/s6-product-polish-personalization-reach/README.md`
- Execution order and dependency gates: `docs/stage6-execution-plan.md`
- Integrated acceptance matrix: `docs/stage6-full-feature-test-matrix.md`
- Feature task boards: the twelve Stage 6 changes under `openspec/changes/`

The OpenSpec task boards are the sole completion checklists. This router must
not acquire parallel checkboxes or redefine Stage 6 scope.
