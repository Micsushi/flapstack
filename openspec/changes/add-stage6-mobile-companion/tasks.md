# S6-F4 — Cross-Agent Mobile Companion

### S6-F4-T1 — Reconcile preserved mobile work and refresh the threat model

- Evidence class: `T2-core`.
- [x] T2-core completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F4
- Outcome: Reviewed preserved code/contracts are mapped onto final Stage 4 identity, schema, Runtime, orchestration, approval, and audit authority.
- Scope: Tree-equivalence inventory; migration renumbering; dependency drift; threat model; action catalog; DTOs; private-interface rules; rate/size limits; redaction; discard list.
- Out of scope: Blind branch merge or listener launch.
- Acceptance: Every preserved file is adopt/rewrite/drop with rationale; no second provider/control service; raw shell/git/deploy/secrets remain excluded.
- Verification: Diff inventory review, contract schema tests, strict OpenSpec, security review.
- Blocked by: accepted Stage 4 exact SHA and preserved branch 65169c6
- Blocks: S6-F4-T2, S6-F4-T3, S6-F4-T4, S6-F4-T6
- Context: preserved add-mobile-control-companion change and mobile code/tests.

### S6-F4-T2 — Integrate the default-off HTTPS bridge lifecycle

- Evidence classes: `T2-core`, `T2-capability:real-lan-mobile-host`, `release-gate`.
- [x] T2-core completion: acceptance and verification passed
- [ ] Capability evidence: `T2-capability:real-lan-mobile-host` remains uncertified.
- [ ] Release evidence: `release-gate` remains uncertified for native-desktop-package-bridge.
- Parent: Project Flapstack / Stage S6 / Feature S6-F4
- Outcome: Desktop safely serves a companion endpoint only after explicit local opt-in.
- Scope: Protected settings; certificate/fingerprint; interface selection; HTTPS/WebSocket; origin/host checks; limits; enable/disable/rebind; network-change stop; startup/quit cleanup; diagnostics.
- Out of scope: Pairing and data APIs.
- Acceptance: No listener before opt-in; unsafe bind fails; disable/network change closes sessions; keys never log/export.
- Verification: Bridge bind/TLS/origin/rate/network/restart/quit tests plus live LAN and packaged smoke.
- Blocked by: S6-F4-T1
- Blocks: S6-F4-T3, S6-F4-T4, S6-F4-T8
- Context: preserved mobile-bridge, app shutdown, secure storage.

### S6-F4-T3 — Integrate pairing, device identity, sessions, and revocation

- Evidence class: `T2-core`.
- [x] T2-core completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F4
- Outcome: Each phone has a named replay-resistant identity that can be revoked immediately.
- Scope: Rebased schema; QR; token expiry/use; fingerprint; public-key registration; challenge/nonce; expiry/rotation; device list/rename/revoke; active disconnect; audit.
- Out of scope: PWA feature screens.
- Acceptance: Expired/reused/mismatched pairing fails; revoke terminates live sessions; restart preserves device state, not sessions.
- Verification: Migration, pairing expiry/replay/concurrency/revoke/restart tests and real QR/browser walkthrough.
- Blocked by: S6-F4-T1, S6-F4-T2
- Blocks: S6-F4-T4, S6-F4-T5, S6-F4-T6, S6-F4-T7, S6-F4-T8
- Context: preserved mobile-pairing, WebAuthn, audit.

### S6-F4-T4 — Integrate sequenced snapshots, events, scopes, and reconnect

- Evidence class: `T2-core`.
- [x] T2-core completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F4
- Outcome: Authorized devices receive bounded current state and recover safely from gaps.
- Scope: Scope grants; projections; sequence log; subscribe/resume; gap/resnapshot; freshness; paging; backpressure; redaction; permission/revoke invalidation; cleanup.
- Out of scope: Mutations and UI.
- Acceptance: Devices see only grants; slow clients stay bounded; changed authority applies immediately; completed work never replays.
- Verification: Scope/gap/reconnect/backpressure/paging/revoke/restart tests and live network interruption.
- Blocked by: S6-F4-T1, S6-F4-T2, S6-F4-T3, S6-F7-T5
- Blocks: S6-F4-T5, S6-F4-T6, S6-F4-T7, S6-F4-T8
- Context: product invalidation, F3/F11 activity, automation, approvals.

### S6-F4-T5 — Build the polished responsive companion PWA

- Evidence classes: `T2-core`, `T2-capability:ios-android-browser`.
- [x] T2-core completion: acceptance and verification passed
- [ ] Capability evidence: `T2-capability:ios-android-browser` remains uncertified.
- Parent: Project Flapstack / Stage S6 / Feature S6-F4
- Outcome: Paired phones navigate scoped work, attention items, runs, diffs, tests, artifacts, and status clearly.
- Scope: PWA shell/manifest/service worker; pairing; inbox; project/task/chat/run/fleet views; diff/test/artifact review; freshness/offline UI; touch; install; accessibility.
- Out of scope: Terminal/editor/arbitrary file browser.
- Acceptance: Offline is read-only; large payloads are bounded; no desktop-only unsafe control leaks; reconnect resnapshots.
- Verification: Component/PWA tests, responsive visual/axe, iOS Safari and Android-class Chromium walkthrough.
- Blocked by: S6-F1-T3, S6-F4-T3, S6-F4-T4
- Blocks: S6-F4-T6, S6-F4-T7, S6-F4-T8
- Context: Stage 6 UI primitives, preserved PWA concepts, mobile layouts.

### S6-F4-T6 — Add bounded steering and lifecycle actions

- Evidence class: `T2-core`.
- [x] T2-core completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F4
- Outcome: Mobile answers, steers, pauses/resumes/cancels, and controls owned work through shared services.
- Scope: Dispatcher; version preconditions; clarification; steer; run/orchestration/automation lifecycle; idempotency; scope/permission; partial results; audit; result events.
- Out of scope: Raw commands, deploy/merge/push, arbitrary new work, vendor sessions outside Flapstack.
- Acceptance: Same service as desktop; stale/duplicate/out-of-scope fails; cancellation reaches owned descendants and reports partial failure.
- Verification: Action matrix, stale/duplicate/revoke/permission/partial/audit tests and live mixed-runtime control.
- Blocked by: S6-F4-T1, S6-F4-T3, S6-F4-T4, S6-F4-T5, S6-F7-T4
- Blocks: S6-F4-T7, S6-F4-T8
- Context: question lifecycle, cascade control, automation control.

### S6-F4-T7 — Add mobile approvals and honest notifications

- Evidence classes: `T2-core`, `T2-capability:real-mobile-device`.
- [x] T2-core completion: acceptance and verification passed
- [ ] Capability evidence: `T2-capability:real-mobile-device` remains uncertified.
- Parent: Project Flapstack / Stage S6 / Feature S6-F4
- Outcome: Eligible approval cards show exact risk and attention signals never imply guaranteed delivery.
- Scope: Eligibility registry; context/risk/expiry; WebAuthn step-up; desktop fallback; decide/timeout; notification permission; connected web notifications; unread inbox; limitation copy.
- Out of scope: Hosted push relay and ineligible Tier-3 approval without strong auth.
- Acceptance: High risk without strong auth remains desktop-only; timeout/revoke closes cards; decision audits once; delivery failure is visible.
- Verification: Risk/WebAuthn/timeout/revoke/duplicate/notification/audit tests and real-device walkthrough.
- Blocked by: S6-F4-T3, S6-F4-T4, S6-F4-T5, S6-F4-T6
- Blocks: S6-F4-T8
- Context: approval coordinator, notification/inbox patterns.

### S6-F4-T8 — Close real-device mobile acceptance

- Evidence classes: `T2-core`, `T2-capability:real-mobile-device`, `release-gate`.
- [x] T2-core completion: acceptance and verification passed
- [ ] Capability evidence: `T2-capability:real-mobile-device` remains uncertified.
- [ ] Release evidence: `release-gate` remains uncertified for native-desktop-package-mobile-flow.
- Parent: Project Flapstack / Stage S6 / Feature S6-F4
- Outcome: Pairing, monitoring, steering, approval, revoke, offline, and reconnect pass real-device evidence.
- Scope: Matrix S6-MC; private/public network; iOS/Android-class browsers; QR/fingerprint; lifecycle; diff/artifact; offline/reconnect; revoke; security review; docs/package.
- Out of scope: Hosted relay, guaranteed background push, native clients, arbitrary vendor sessions.
- Acceptance: Unsafe/network/revoked states fail closed; desktop/mobile state and audit agree; unavailable device rows remain explicit blockers.
- Verification: Node 22 npm run check, strict OpenSpec, verified Dev, real-device matrix, network/security review, packaged desktop preview.
- Blocked by: S6-F4-T2, S6-F4-T3, S6-F4-T4, S6-F4-T5, S6-F4-T6, S6-F4-T7, S6-F7-T7
- Blocks: S6-F11-T3, S6-F11-T4, S6-F11-T5
- Context: docs/stage6-full-feature-test-matrix.md.
