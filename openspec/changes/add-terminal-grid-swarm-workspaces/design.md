## Context

BridgeMind/BridgeSpace are interaction references only. Stage 4 already owns
agents, chats, runs, worktrees, workspaces, orchestration, and cancellation.

## Goals / Non-Goals

- Goals: dense visibility, fast navigation, bounded group control, saved layouts,
  honest status, keyboard access, and large-fleet performance.
- Non-goals: hidden swarm creation, unlimited concurrency, second scheduler,
  raw terminal multiplexing protocol, or nested chats.

## Decisions

- A grid pane binds existing durable chat, terminal, run, agent, diff, file, or fleet identity.
- Default layouts remain simple; swarm grid is an advanced explicit workspace mode.
- One chat remains controlled by one window. Mirrors are read-only unless ownership moves.
- Grid group actions call F3/F11 shared controls with exact selection, preview,
  approval, budgets, and partial results.
- Fleet/lineage projections never duplicate provider activity or private reasoning.
- Layout uses bounded virtualization and saved workspace crash-safe persistence.

## Migration Plan

Add a workspace layout mode and versioned grid metadata. Existing workspaces
open unchanged. Invalid panes degrade independently.
