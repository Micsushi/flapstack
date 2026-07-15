# Change: Add terminal-grid and swarm workspaces

## Why

Power users need a dense supervision view for many existing agents and
terminals, but Flapstack must not create hidden agents, a second scheduler, or
another task/chat identity model.

## What Changes

- Add saved terminal/chat/agent grid layouts over existing workspaces.
- Add fleet, lineage, activity, and task-path projections beside panes.
- Add bounded selection and group controls through existing authority.
- Add scale, responsive, multi-window, accessibility, and recovery behavior.

## Impact

- Affected specs: new terminal-swarm-workspaces capability.
- Affected code: saved workspaces, pane adapters, terminals, orchestration fleet,
  lineage, window ownership, group controls, layout persistence, and tests.
