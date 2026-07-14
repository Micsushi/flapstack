# S4-F10 — Cross-Agent Mobile Companion

### S4-F10-T1 — Define threat model, action catalog, and bridge contracts

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F10
- Outcome: Mobile scope, trust boundaries, DTOs, and allowed actions are explicit and testable.
- Scope: Threat model; private-interface rules; device/session/snapshot/event/action DTOs; risk levels; action preconditions; sequence protocol; rate/size limits; redaction; capability registry.
- Out of scope: Listener, pairing, PWA, and action execution.
- Acceptance: Raw shell/git/deploy/secrets/arbitrary vendor sessions are absent; every allowed action maps to an existing shared service and risk rule.
- Verification: `npm test -- mobile-control-contract` with schema, unsupported action, oversize, replay, and capability fixtures.
- Blocked by: Stage 3 release baseline
- Blocks: S4-F10-T2, S4-F10-T3, S4-F10-T4, S4-F10-T6
- Context: MCP registry/gate, orchestration control, automation control, agent input/questions, run cancellation.

### S4-F10-T2 — Implement default-off HTTPS bridge lifecycle

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F10
- Outcome: Desktop Flapstack safely serves an authenticated companion endpoint on approved LAN interfaces.
- Scope: Settings; certificate generation/storage/fingerprint; private-interface selection; HTTPS/WebSocket server; origin/host checks; rate/connection limits; enable/disable/rebind; network-change shutdown; startup/quit cleanup.
- Out of scope: Pairing credentials and application data APIs.
- Acceptance: No listener before opt-in; public/unapproved bind fails; disable/network change closes sessions; certificate keys stay protected and unlogged.
- Verification: `npm test -- mobile-bridge` with bind, interface change, TLS, origin, rate, restart, disable, and key-permission fixtures.
- Automated evidence: Node 22 `npm test -- mobile-bridge` passes 9/9; mobile-control-contract and app-shutdown fixtures pass; strict OpenSpec passes.
- Migration: None. The bridge uses the existing file-backed settings pattern and protected app data files.
- Manual verification remaining: live listener, real network transition, browser/device, UI, and packaged-app evidence stay intentionally open for S4-F10-T8.
- Blocked by: S4-F10-T1
- Blocks: S4-F10-T3, S4-F10-T4, S4-F10-T8
- Context: dev MCP HTTP lifecycle (separate surface), Electron startup/shutdown, secure settings storage.

### S4-F10-T3 — Add one-time pairing, device credentials, sessions, and revocation

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F10
- Outcome: Each phone has a named revocable identity and replay-resistant session.
- Scope: Device schema/migration; QR payload; short-lived single-use token; fingerprint confirmation; public-key registration; challenge/nonce auth; session expiry/rotation; device list/rename/revoke; connection termination; audit.
- Out of scope: PWA screens and application controls.
- Acceptance: Expired/reused/mismatched tokens fail; revoked device disconnects immediately; stolen session token cannot replay outside nonce/session rules.
- Verification: `npm test -- mobile-pairing` with expiry, reuse, fingerprint mismatch, replay, rotation, concurrent pairing, revoke, and restart fixtures.
- Automated evidence: Node 22 mobile-pairing passes 9/9; mobile-control contract, bridge, and shutdown regressions pass 23/23; Stage 3 migration-rebase passes 12/12. Full `npm run check` passes 170 files with 1323 tests passed and 3 skipped, including TypeScript, lint, formatting, and production build. Strict OpenSpec and idempotent Drizzle regeneration pass.
- Migration evidence: canonical `0031_mobile_pairing_identity` is regenerated from `0030_extension_enablement_policy` on Stage 4 baseline `9491976`. Fresh, exact final Stage 3 `0023`, canonical Stage 4 `0030`, and representative pre-sync Stage 4 `0023`/`0030` profiles upgrade with seeded data preserved. Stage 3 `0023` and Stage 4 `0024`–`0030` remain unchanged.
- Manual verification remaining: live listener, QR scan, browser/device, UI, real network, and packaged-app evidence stay intentionally open for S4-F10-T8.
- Blocked by: S4-F10-T1, S4-F10-T2
- Blocks: S4-F10-T4, S4-F10-T5, S4-F10-T6, S4-F10-T7, S4-F10-T8
- Context: secure credential patterns, QR generation choice, audit storage, session grants.

### S4-F10-T4 — Build sequenced snapshots, events, and reconnect

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F10
- Outcome: Authorized devices receive bounded current state and recover safely from gaps.
- Scope: Scope grants; snapshot projection; monotonic event log/sequence; WebSocket subscribe; resume cursor; gap detection; resnapshot; timestamps/freshness; pagination; backpressure; redaction; authorization changes.
- Out of scope: Mutations and client UI.
- Acceptance: Devices see only granted scopes; gaps force resnapshot; slow clients cannot exhaust memory; revoked/changed grants apply immediately.
- Verification: `npm test -- mobile-events` with scope, gap, reconnect, backpressure, pagination, redaction, revoke, and restart cases.
- Blocked by: S4-F10-T1, S4-F10-T2, S4-F10-T3
- Blocks: S4-F10-T5, S4-F10-T6, S4-F10-T7, S4-F10-T8
- Context: product invalidation events, run/orchestration/automation queries, diffs/artifacts/tests, question lifecycle.

### S4-F10-T5 — Build the responsive companion PWA

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F10
- Outcome: A paired phone can navigate scoped projects, tasks, chats, runs, alerts, and review artifacts.
- Scope: PWA shell/manifest/service worker; pairing flow; project/task/run inbox; run timeline; orchestration/automation status; diff/test/artifact views; clarification cards; connection/freshness/offline UI; accessibility/touch.
- Out of scope: Terminal/editor, arbitrary file browsing, and mutation execution.
- Acceptance: Offline state is read-only and timestamped; no hidden desktop-only control appears; large diffs/artifacts are bounded/paginated; reconnect resnapshots.
- Verification: `npm test -- mobile-pwa` plus responsive/accessibility tests and real iOS/Android browser walkthrough where available.
- Blocked by: S4-F10-T3, S4-F10-T4
- Blocks: S4-F10-T6, S4-F10-T7, S4-F10-T8
- Context: existing mobile layouts, chat/diff/artifact/test components, PWA touch styles.

### S4-F10-T6 — Add bounded steering and lifecycle controls

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F10
- Outcome: Mobile can answer, steer, pause/resume/cancel, and control owned automation/orchestration through shared services.
- Scope: Action dispatcher; version/stale preconditions; answer clarification; send steer message; pause/resume/cancel run/orchestration/automation; idempotency; scope/permission checks; audit; result events.
- Out of scope: Raw commands, deploy/merge/push, creating arbitrary tasks/runs, and vendor sessions outside Flapstack.
- Acceptance: Every action calls the same production service as desktop; stale/duplicate/out-of-scope actions fail safely; cancellation reaches owned processes.
- Verification: `npm test -- mobile-actions` with each action, stale version, duplicate, revoke race, permission, scope, partial cancel, and audit cases.
- Blocked by: S4-F5-T6, S4-F10-T1, S4-F10-T3, S4-F10-T4, S4-F10-T5 and S4-F3-T5
- Blocks: S4-F10-T7, S4-F10-T8
- Context: agent input lifecycle, run launch/cancel, orchestration control, automation control, audit.

### S4-F10-T7 — Add mobile approvals and best-effort notifications

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F10
- Outcome: Paired devices decide eligible approvals with exact risk and receive honest attention signals.
- Scope: Approval eligibility registry; exact caller/target/input/risk/expiry cards; WebAuthn/passkey step-up; desktop fallback; approve/deny/timeout; notification permission; connected/local web notifications; unread inbox; limitation copy.
- Out of scope: Hosted push relay and mobile approval of ineligible high-risk actions.
- Acceptance: High-risk approval without step-up stays desktop-only; timeout/revoke closes cards; notification failures do not imply delivery; decisions audit exactly once.
- Verification: `npm test -- mobile-approvals` with risk matrix, WebAuthn available/unavailable, timeout, revoke, duplicate, notification denial/failure, and audit cases.
- Blocked by: S4-F10-T3, S4-F10-T4, S4-F10-T5, S4-F10-T6
- Blocks: S4-F10-T8
- Context: Stage 3 approval coordinator/UI, device auth, inbox/notification patterns.

### S4-F10-T8 — Close mobile companion acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F10
- Outcome: Pairing, monitoring, steering, review, approval, revoke, and reconnect pass real-device evidence.
- Scope: Full gate; matrix S4-MC01–S4-MC03; private/public network; QR/token/fingerprint; iOS/Android browsers; offline/reconnect; control/approval; revoke; docs; package preview.
- Out of scope: Hosted relay, guaranteed background push, native clients, and arbitrary vendor sessions.
- Acceptance: At least one iOS and one Android-class browser are observed or left explicitly open; unsafe/network/revoked states fail closed; desktop and mobile state/audit agree.
- Verification: Node 22 `npm run check`, strict OpenSpec, `npm run dev:verify`, real-device matrix, security review, and packaged preview.
- Blocked by: S4-F10-T2, S4-F10-T3, S4-F10-T4, S4-F10-T5, S4-F10-T6, S4-F10-T7
- Blocks: Stage S4 integrated exit
- Context: `docs/stage4-full-feature-test-matrix.md` and Stage 4 execution plan.
