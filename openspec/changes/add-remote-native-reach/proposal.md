# Change: Add remote execution and a native mobile companion

## Why

Flapstack's secure PWA can monitor and steer local work, but full remote files,
Git, terminals, browser state, provider accounts, and native device behavior
require a versioned execution-host boundary and a real iOS/Android client.

## What Changes

- Add a headless execution-host service with capability/version negotiation.
- Add SSH workspaces, reconnect, Git/files/PTY routing, and port forwarding.
- Treat WSL distributions as execution-host targets with isolated provider homes.
- Add an Expo native mobile app within the Flapstack repository.
- Extend mobile from bounded PWA monitoring to terminal, files/editing, diff,
  source control, provider accounts/usage, browser view, and task workflows.
- Add mobile/desktop protocol compatibility, offline, release, and recovery gates.
- Add native voice, notifications, accessibility, diagnostics, and a
  development-only desktop mobile emulator.
- Add an optional end-to-end encrypted relay with regional placement, direct
  fallback, revocation, and operational recovery.
- Add recipe-driven ephemeral VM runtimes with bounded provisioning, resume,
  emulator coverage, cost/TTL visibility, and verified cleanup.

## Impact

- Affected specs: new `remote-native-reach` capability; mobile-control is modified.
- Affected code: runtime host contracts, daemon/service, SSH/WSL, files/Git/PTY,
  ports, relay broker/cells, ephemeral VM provisioning, mobile
  bridge/pairing/projections, new `mobile/`
  workspace, speech, notifications, provider accounts, browser, packaging,
  release docs, and tests.
