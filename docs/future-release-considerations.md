# Future Work Promoted to Stage 5

This file is a compatibility router for links created before Stage 5 existed.
It is no longer an independent backlog. Every previously parked item is now
planned under **Stage 5 — Product Polish, Personalization, and Reach**.

Stage 5 remains planned, not active. It starts only after every Stage 4
acceptance row is closed with the required automated, live, package, device,
credential, accessibility, performance, and documentation evidence.

## Promotion map

| Previous future item                                                                                                   | Stage 5 owner                                        |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Broad UI/UX cleanup, consistency, accessibility, and visual polish                                                     | S5-F1 — Product-wide UI/UX polish                    |
| Dynamic speech vocabulary and voice-input language polish                                                              | S5-F1 — Product-wide UI/UX polish                    |
| First-run tutorial, setup questionnaire, feature visibility, explanations, and alphabetical Settings groups            | S5-F2 — Guided onboarding and feature visibility     |
| Agent Profile chooser, reusable Markdown personalities, launch defaults, speed/effort, and descendant behavior         | S5-F3 — Agent Profiles and reusable personalities    |
| Phone pairing, monitoring, steering, approvals, PWA, and mobile notifications                                          | S5-F4 — Cross-agent mobile companion                 |
| Screenshot capture, visual attachments, annotation, and visual context provenance                                      | S5-F5 — Visual context and screenshot capture        |
| Chat splits, floating windows, terminal grids, saved layouts, multi-agent workspaces, and swarm controls               | S5-F6 — Multi-pane Chat and swarm workspaces         |
| Stage 4 F3/F11 ownership, structured-output, control, activity, and recovery follow-ups                                | S5-F7 — Runtime/orchestration composition            |
| OpenAI and Anthropic organization usage/cost APIs                                                                      | S5-F8 — Organization usage APIs                      |
| Startup, interaction, streaming, concurrency, memory, and long-run performance                                         | S5-F9 — Performance and scale                        |
| Public signed/notarized macOS distribution plus native Windows and Linux acceptance                                    | S5-F10 — Cross-platform public distribution          |
| Six seed notes, custom Markdown nodes/folders, Wikilinks/backlinks, graph/list views, and same-folder Obsidian opening | S5-F12 — Obsidian-compatible project knowledge graph |
| One integrated release candidate and public support statement                                                          | S5-F11 — Integrated Stage 5 release                  |

The preserved mobile implementation remains on
`codex/future-mobile-companion` at `65169c6`; S5-F4 must rebase and audit that
work instead of treating it as accepted evidence.

## Authoritative planning

- Stage router: `openspec/stages/s5-product-polish-personalization-reach/README.md`
- Execution order and dependency gates: `docs/stage5-execution-plan.md`
- Integrated acceptance matrix: `docs/stage5-full-feature-test-matrix.md`
- Feature task boards: the twelve Stage 5 changes under `openspec/changes/`

The OpenSpec task boards are the sole completion checklists. This router must
not acquire parallel checkboxes or redefine Stage 5 scope.
