## Context

Stage 4 adds many valid surfaces. Stage 6 must reduce cognitive load without
removing capability truth or rebuilding product services.

## Goals / Non-Goals

- Goals: coherent hierarchy, progressive density, consistent controls, accessible
  operation, honest status, responsive layouts, and measurable usability.
- Non-goals: a decorative redesign, a new task/chat model, hidden safety state,
  or pixel-copying another product.

## Decisions

- Root ui-design.md remains durable visual authority; this change implements its
  Stage 6 decisions and updates it when durable decisions change.
- Core objects remain Project, Task, Chat, Run, and Workspace.
- Launch-critical controls stay near the composer; secondary state stays in
  details/overflow surfaces.
- One component/state pattern represents loading, empty, stale, failure,
  disabled, unavailable, and recovery states.
- Dense power-user layouts remain available, but defaults favor clear hierarchy.
- Accessibility and keyboard operation are acceptance requirements, not cleanup.
- Dynamic speech vocabulary reuses project/task/chat context through the existing
  voice boundary; it never sends unselected private context to a cloud engine.
- Visual regression covers stable fixtures; live provider content is normalized
  before screenshots.

## Risks / Trade-offs

- Broad UI work can cause churn. Work from an audited surface inventory and
  reusable primitives before feature screens.
- Simplification can hide truth. Preserve searchable routes and explicit status.

## Migration Plan

Migrate renderer surfaces incrementally behind compatible component APIs.
Persisted user layout and visibility choices survive; removed legacy preferences
map deterministically or show one repair prompt.
