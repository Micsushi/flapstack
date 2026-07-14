## Context

The renderer already has responsive/mobile layouts, but it runs inside Electron
and has no remote transport. Stage 3/4 services own run, approval, orchestration,
automation, diff, artifact, and question state that a companion can project.

## Goals / Non-Goals

- Goals: secure local pairing, monitoring, bounded steering/review/control,
  explicit approval, reconnect, revocation, audit, and honest notifications.
- Non-goals: phone IDE/terminal, arbitrary shell/git/deploy, arbitrary vendor
  sessions, hosted relay, public internet exposure, or mobile secret management.

## Decisions

- First delivery is a responsive PWA served by desktop Flapstack over an opt-in
  LAN HTTPS bridge. Bridge is disabled by default and binds only approved private
  interfaces. Remote use requires a user-owned VPN/tunnel.
- Flapstack creates a local certificate and shows fingerprint during pairing.
  QR contains endpoint, fingerprint, and short-lived single-use pairing token.
- Pairing issues a per-device public-key credential stored in platform browser
  storage. Desktop stores only device public identity/metadata; revocation is immediate.
- All requests use authenticated HTTPS/WebSocket with nonce/replay protection,
  rate limits, idle/absolute session expiry, and origin checks.
- Mobile consumes read-model snapshots plus monotonic event sequence. Gaps force
  resnapshot; offline UI is read-only and clearly stale.
- Safe mobile actions: answer clarification, send steer message, pause/resume/
  cancel owned run/orchestration/automation, and approve only capability-listed
  requests. No raw terminal or arbitrary command field.
- High-risk mobile approvals require device passkey/WebAuthn when available.
  Without it, desktop confirmation remains required.
- Notifications are best-effort while bridge/device conditions permit. No claim
  of reliable background push without a hosted relay.

## Risks / Trade-offs

- LAN bridges expand attack surface. Default-off, private-interface binding,
  certificate fingerprint, single-use pairing, device keys, revocation, rate
  limits, narrow DTOs, and audit are mandatory.
- Self-signed/local certificates can create platform friction. Pairing UI must
  show exact trust steps and fail closed on fingerprint mismatch.
- Mobile state can be stale. Sequence numbers, timestamps, resnapshot, action
  preconditions, and desktop authority prevent stale mutation.

## Migration Plan

Add device/bridge tables and settings with bridge disabled. No listener starts
until the user enables it. Disabling revokes sessions and closes listeners.

## Open Questions

- None blocking. LAN-only PWA and user-owned VPN/tunnel are fixed boundaries.
