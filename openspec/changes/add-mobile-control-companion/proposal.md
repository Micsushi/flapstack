# Change: Add a cross-agent mobile control companion

## Why

Users need to monitor and steer Flapstack-launched work away from the desktop
without turning a phone into an unrestricted IDE or exposing a hosted control plane.

## What Changes

- Add an opt-in LAN HTTPS bridge and responsive PWA served by desktop Flapstack.
- Add QR one-time pairing, device identity, revocation, session expiry, and audit.
- Add normalized project/task/chat/run/orchestration/automation snapshots and events.
- Add clarification, steering, diff/test/artifact review, pause/cancel, and
  explicitly approved bounded actions.
- Add reconnect/offline truth and best-effort local notifications.
- Keep remote access user-owned through VPN/tunnel; no Flapstack relay.

## Impact

- Affected specs: new `mobile-control` capability.
- Affected code: Electron bridge lifecycle, TLS/device storage, event projection,
  shared control services, PWA renderer, approvals/audit, notifications, and tests.
