# Change: Add the Stage 5 cross-agent mobile companion

## Why

Users need to monitor and steer Flapstack-launched work away from the desktop
without exposing a hosted control plane or turning a phone into an unrestricted IDE.

## What Changes

- Reconcile the preserved mobile branch into the accepted Stage 5 baseline.
- Add a default-off LAN HTTPS bridge and responsive PWA.
- Add one-time pairing, device identity, revocation, sequenced state, and reconnect.
- Add bounded steering, clarification, lifecycle control, approvals, and honest notifications.
- Add real iOS/Android-class browser, security, and package evidence.

## Impact

- Affected specs: new mobile-control capability.
- Affected code: preserved branch codex/future-mobile-companion, bridge,
  pairing, events, PWA, control services, approvals, notifications, migrations, and tests.
