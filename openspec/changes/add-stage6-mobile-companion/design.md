## Context

The preserved branch at 65169c6 contains reviewed bridge, pairing, event, and
contract foundations from former S4-F10. Stage 6 must integrate equivalent trees
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

## T1 preserved-tree reconciliation (2026-07-26)

This inventory records how the reviewed mobile tree was reconciled against the
current Stage 6 codebase. It is implementation evidence only; it does not advance
Tier 2 or owner-only Tier 3 task status.

| Disposition | Preserved material                                                                                                      | Current-tree treatment                                                                                                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adopt       | Mobile bridge network policy, service, transport, limits, and shared protocol types                                     | Retained as the bounded, opt-in LAN HTTPS/WebSocket boundary with disabled-by-default settings.                                                                                                 |
| Adopt       | Pairing identity, challenge/session rotation, device revocation, authority grants, event projection, and fixtures/tests | Retained with the current database and service contracts; device identities and grants remain durable.                                                                                          |
| Adopt       | Snapshot pagination, sequenced reconnect, invalidation, and connection backpressure                                     | Retained with durable event streams and projection membership per grant, which represents resources delivered to clients under that grant.                                                      |
| Rewrite     | Application startup, database-maintenance restart, shutdown, router controls, and renderer invalidation hooks           | Integrated with the current main-process lifecycle and routers instead of preserving stale entry-point edits.                                                                                   |
| Rewrite     | Mobile migrations and snapshots                                                                                         | Rebased as `0047_mobile_pairing_identity`, `0048_mobile_sequenced_events`, and `0050_mobile_projection_families` after the current Stage 6 schema chain.                                        |
| Rewrite     | Certificate/settings persistence and Windows private-key protection                                                     | Implemented against the current settings store and Windows ACL behavior.                                                                                                                        |
| Rewrite     | Pairing control plane                                                                                                   | Exposed as bounded JSON-only HTTPS routes for pair, challenge, authenticate, and rotate with redacted failures and recovery guidance.                                                           |
| Rewrite     | Runtime/session and projection semantics                                                                                | Active sessions are revoked on process/runtime restart while devices and grants persist; approvals, artifacts, diffs, and checks use bounded DTOs; moved/deleted resources emit removal events. |
| Drop        | Preserved task-checkbox and evidence-board edits                                                                        | Current OpenSpec and test matrices remain authoritative and move only after current-tree verification.                                                                                          |
| Drop        | Stale package versions, scripts, Windows rollback edits, and old migration numbers/snapshots                            | Replaced by the current dependency lock, lifecycle integration, and generated migration chain.                                                                                                  |
| Drop        | Older extension-last-migration and spawned-agent assertions                                                             | Superseded by current migration-chain and stronger Stage 6 coverage.                                                                                                                            |
| Drop        | Standalone mobile-control contract test duplication                                                                     | Folded into focused bridge, pairing, HTTP, and event suites.                                                                                                                                    |

The threat boundary remains unchanged: mobile control cannot execute arbitrary
shell, git, deployment, or secret-management operations. Optional provider,
device, notification, and release evidence remains capability/release work and
is not treated as missing T1 core code.
