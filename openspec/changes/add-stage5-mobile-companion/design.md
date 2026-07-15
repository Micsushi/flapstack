## Context

The preserved branch at 65169c6 contains reviewed bridge, pairing, event, and
contract foundations from former S4-F10. Stage 5 must integrate equivalent trees
onto the accepted Stage 4 schema rather than blindly merge stale history.

## Goals / Non-Goals

- Goals: secure local pairing, monitoring, bounded steering/review/control,
  explicit approval, reconnect, revocation, audit, and truthful notifications.
- Non-goals: phone IDE/terminal, arbitrary shell/git/deploy, arbitrary vendor
  sessions, hosted relay, public internet exposure, or mobile secret management.

## Decisions

- First delivery is a responsive PWA served by desktop Flapstack over an opt-in
  LAN HTTPS bridge. Remote use requires a user-owned VPN/tunnel.
- Bridge binds only approved private interfaces and stops on unsafe network change.
- Pairing uses certificate fingerprint, single-use token, and per-device public-key identity.
- Requests use authenticated HTTPS/WebSocket with replay protection, expiry,
  origin checks, rate limits, and immediate revocation.
- Mobile consumes bounded snapshots and monotonic events; gaps force resnapshot.
- Safe actions are typed and call the same production services as desktop.
- High-risk approval requires passkey/WebAuthn when available; otherwise desktop decides.
- Notifications are best effort; no hosted push reliability claim.

## Migration Plan

Port only reviewed equivalent changes from the preserved branch. Rebase migration
numbers onto the final Stage 4 chain. Bridge remains disabled after upgrade.
