# S9: Remote and Native Reach

### S9-F1-T1: Add execution-host identity and capability contracts

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F1
- Outcome: Every workspace operation resolves one authenticated local/remote/WSL host with a versioned capability snapshot.
- Scope: Host IDs; targets; capabilities; protocol/minimum versions; local-host migration; DTOs; mixed-version verdicts.
- Start points: New host identity/capability and wire packages, runtime/process/file/Git/PTY interfaces, service lifecycle, credential storage, host settings, and migrations.
- Acceptance: Existing local work migrates unchanged; unsupported operations are absent; incompatible peers block precisely; host identity cannot be spoofed by display name.
- Verification: Migration, capability, additive/breaking versions, stale snapshot, identity collision, and local parity tests.
- Blocked by: S7-F7-T1, S8-F6-T1
- Blocks: S9-F1-T2, S9-F1-T3, S9-F2-T1, S9-F4-T1, S9-F6-T1, S9-F7-T1

### S9-F1-T2: Add authenticated headless host service

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F1
- Outcome: A supported machine runs a supervised Flapstack host service and accepts pinned, scoped desktop/mobile connections.
- Scope: Service install/start/stop; identity keys; pairing/pinning; RPC framing; reconnect; logs/diagnostics; upgrade/restart.
- Start points: New host identity/capability and wire packages, runtime/process/file/Git/PTY interfaces, service lifecycle, credential storage, host settings, and migrations.
- Acceptance: No public unauthenticated listener; service restart preserves identity and durable resources; revocation closes sessions; malformed clients stay bounded.
- Verification: Auth/replay, framing/backpressure, service restart/upgrade, revoke, crash, port conflict, Linux package and local-client smokes.
- Blocked by: S9-F1-T1, S8-F3-T2
- Blocks: S9-F1-T3, S9-F2-T1, S9-F3-T1

### S9-F1-T3: Route files, Git, worktrees, PTYs, and processes by host

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F1
- Outcome: Core workspace operations execute at the owning host and report exact location, ownership, and failure state.
- Scope: Host-aware interfaces; local adapter; remote adapter; path normalization; process evidence; terminal attach; file/Git streaming; cancellation.
- Start points: New host identity/capability and wire packages, runtime/process/file/Git/PTY interfaces, service lifecycle, credential storage, host settings, and migrations.
- Acceptance: No local fallback for remote paths; dropped connections do not imply exit; retries are idempotent; local behavior remains compatible.
- Verification: Contract parity, path/symlink, disconnect/reconnect, process ownership/PID reuse, stream gaps, cancellation, and local regression tests.
- Blocked by: S9-F1-T1, S9-F1-T2, S7-F5-T2
- Blocks: S9-F1-T4, S9-F2-T2, S9-F3-T3, S9-F4-T1, S9-F7-T2

### S9-F1-T4: Add reconnect, recovery, and host inventory UX

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F1
- Outcome: Users see host health/capabilities, reconnect safely, and recover owned resources without false live/exited state.
- Scope: Host settings; diagnostics; live/exited/unverifiable/unreachable projection; retry/backoff; stale resources; mixed-version repair.
- Start points: New host identity/capability and wire packages, runtime/process/file/Git/PTY interfaces, service lifecycle, credential storage, host settings, and migrations.
- Acceptance: Recovery never adopts unrelated resources; user can remove/re-pair a host; stale capability state is visible; offline local work remains usable.
- Verification: UI/accessibility, network loss, host restart, stale identity, mixed version, resource reconciliation, and multi-host tests.
- Blocked by: S9-F1-T3
- Blocks: S9-F2-T2, S9-F3-T2, S9-F6-T3, S9-F8-T1

### S9-F2-T1: Add protected SSH connection profiles

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F2
- Outcome: Users define, test, label, and revoke SSH hosts using OS-protected secrets or user-owned agents.
- Scope: Host key pinning; SSH agent/key references; proxy/jump host; timeouts; known-host changes; redacted diagnostics.
- Start points: New SSH transport/profile services, existing Git/file/worktree/terminal authorities, OS credential storage, port inventory, and remote integration harnesses.
- Acceptance: Private keys are never imported into renderer/SQLite plaintext; host-key change blocks; test does not mutate remote work; removal revokes active sessions.
- Verification: Key/agent, host-key mismatch, proxy, timeout, secret exposure, revoke, and disposable SSH server tests.
- Blocked by: S9-F1-T1, S9-F1-T2
- Blocks: S9-F2-T2, S9-F7-T2

### S9-F2-T2: Add SSH workspaces and resilient remote terminals

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F2
- Outcome: Users open remote repositories, create worktrees, edit/review files, run Git, and reattach verified PTYs through SSH.
- Scope: Remote root discovery; setup script; files/Git/worktrees; PTY daemon; reconnect; terminal journal; provider launch; cleanup.
- Start points: New SSH transport/profile services, existing Git/file/worktree/terminal authorities, OS credential storage, port inventory, and remote integration harnesses.
- Acceptance: Execution stays remote; ownership and cwd are exact; reconnect preserves verified sessions; failed setup is recoverable; cleanup targets only owned state.
- Verification: Disposable host end-to-end, path/permission, network flap, daemon restart, Git/worktree, file conflict, PTY flood, and provider smoke when available.
- Blocked by: S9-F1-T3, S9-F1-T4, S9-F2-T1
- Blocks: S9-F2-T3, S9-F3-T3, S9-F8-T1

### S9-F2-T3: Add explicit port forwarding and service discovery

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F2
- Outcome: Users discover remote listening services and create visible, scoped, revocable forwards.
- Scope: Port inventory; local/remote forwards; collision handling; durable rules; reconnect; URLs; audit and cleanup.
- Start points: New SSH transport/profile services, existing Git/file/worktree/terminal authorities, OS credential storage, port inventory, and remote integration harnesses.
- Acceptance: No automatic public exposure; collision never kills another process; revoked forwards stay closed; forwarding reports exact endpoints.
- Verification: Port scan bounds, collision, reconnect, revoke, stale process, IPv4/IPv6, multiple hosts, and disposable service tests.
- Blocked by: S9-F2-T2
- Blocks: S9-F3-T4, S9-F8-T1

### S9-F3-T1: Add the in-repo Expo mobile workspace

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F3
- Outcome: Flapstack builds and tests one Expo/React Native app from the main repository with documented iOS/Android development paths.
- Scope: Workspace/package config; Expo Router shell; themes/assets; lint/type/test/build scripts; dependency/license/native-module audit; mock server.
- Start points: New `mobile/` Expo workspace; existing `src/main/lib/mobile-*` bridge/pairing/events/actions; desktop files, Git, browser, speech, usage, approval, and notification services.
- Acceptance: No separate mobile repository; Orca-derived files retain MIT notices where required; desktop lockfile/build stays stable; mock app starts without secrets.
- Verification: Mobile install/type/lint/tests, Expo config/prebuild, license/dependency audit, desktop `npm run check`, simulator/emulator smoke when available.
- Blocked by: S9-F1-T2
- Blocks: S9-F3-T2, S9-F3-T7

### S9-F3-T2: Reuse Flapstack pairing and secure native transport

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F3
- Outcome: Native devices pair, authenticate, reconnect, rotate, and revoke through existing device/grant authority and secure storage.
- Scope: QR/camera; certificate/host pin; device keys; secure store; replay/session rotation; grant projection; protocol gate; offline cache purge.
- Start points: New `mobile/` Expo workspace; existing `src/main/lib/mobile-*` bridge/pairing/events/actions; desktop files, Git, browser, speech, usage, approval, and notification services.
- Acceptance: Existing PWA remains compatible; revoked devices lose live and cached access; fingerprint/version mismatch fails closed; secrets never enter logs/backups.
- Verification: Pair/replay/expiry/revoke/rotate, secure-store backup policy, mixed version, offline purge, mock and real LAN device tests.
- Blocked by: S9-F1-T4, S9-F3-T1
- Blocks: S9-F3-T3, S9-F3-T4, S9-F3-T5, S9-F3-T6, S9-F3-T7, S9-F5-T1, S9-F6-T1

### S9-F3-T3: Add native host, workspace, Chat, and terminal slices

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F3
- Outcome: Mobile lists hosts/workspaces/Chats, shows truthful attention/run state, steers work, receives notifications, and attaches to durable terminals.
- Scope: Home/host/workspace routes; Chat transcript/input; attention; notifications; terminal WebView; shortcut/settings; reconnect/backpressure.
- Start points: New `mobile/` Expo workspace; existing `src/main/lib/mobile-*` bridge/pairing/events/actions; desktop files, Git, browser, speech, usage, approval, and notification services.
- Acceptance: Grant filtering is exact; offline is timestamped read-only; terminal input reaches only selected verified PTY; notifications never imply guaranteed delivery.
- Verification: Component/accessibility, event gap, offline, host loss, terminal snapshot/stream/input, notification, background/foreground, real devices.
- Blocked by: S9-F1-T3, S9-F2-T2, S9-F3-T2
- Blocks: S9-F3-T4, S9-F3-T5, S9-F3-T6, S9-F3-T7, S9-F6-T3, S9-F8-T1

### S9-F3-T4: Add native files, editing, diff, Git, browser, and task slices

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F3
- Outcome: Mobile performs small granted code follow-ups with conflict-safe editing, review comments, source control, browser view, and provider tasks.
- Scope: File tree/preview/editor; diff comments; stage/unstage/commit; PR/MR; browser stream/touch; task intake; uploads.
- Start points: New `mobile/` Expo workspace; existing `src/main/lib/mobile-*` bridge/pairing/events/actions; desktop files, Git, browser, speech, usage, approval, and notification services.
- Acceptance: Compare-and-save and diff identity are enforced; Git target/staged set is previewed; push/merge/deploy remain separately permissioned; browser input uses current frames.
- Verification: Conflict, large files, diff drift, Git index races, browser geometry, task/worktree exact-once, uploads, accessibility, and device tests.
- Blocked by: S7-F3-T2, S7-F3-T3, S7-F4-T2, S8-F1-T4, S8-F1-T6, S8-F2-T2, S9-F2-T3, S9-F3-T2, S9-F3-T3
- Blocks: S9-F5-T2, S9-F8-T1, S10-F2-T2

### S9-F3-T5: Add native provider accounts, usage, approvals, and settings

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F3
- Outcome: Mobile selects provider accounts for a host/runtime, reads correct usage, and completes only eligible step-up approvals.
- Scope: Account roster/switch; usage windows; runtime target; approval cards/passkey; device settings; diagnostics; no secret export.
- Start points: New `mobile/` Expo workspace; existing `src/main/lib/mobile-*` bridge/pairing/events/actions; desktop files, Git, browser, speech, usage, approval, and notification services.
- Acceptance: Selection changes new launches only; usage matches target; tokens never reach mobile; high-risk approval without step-up stays desktop-only.
- Verification: Multi-account/runtime, stale usage, switch races, revoke, step-up/passkey, offline, no-secret DTO, and real-device tests.
- Blocked by: S7-F1-T4, S8-F4-T4, S9-F3-T2, S9-F3-T3
- Blocks: S9-F5-T2, S9-F8-T1

### S9-F3-T6: Add native voice, notifications, accessibility, and diagnostics

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F3
- Outcome: Native users dictate into the selected Chat, receive actionable notifications, complete core flows accessibly, and produce a redacted connection report.
- Scope: Mobile audio capture/streaming; desktop speech handoff; origin-safe drafts; notification categories/deep links; screen-reader/dynamic-type; connection log; reachability/protocol analysis; redacted export.
- Start points: New `mobile/` Expo workspace; existing `src/main/lib/mobile-*` bridge/pairing/events/actions; desktop files, Git, browser, speech, usage, approval, and notification services.
- Acceptance: Dictation never auto-sends or changes Chat origin; notification actions revalidate device grants; denied microphone/notification access degrades visibly; diagnostic exports contain no tokens, prompts, file contents, or private paths.
- Verification: Audio lifecycle/budgets, navigation during dictation, permission deny/revoke, notification delivery/deep links, VoiceOver/TalkBack, dynamic type, redaction fixtures, offline/host-loss, and real-device tests.
- Blocked by: S9-F3-T2, S9-F3-T3
- Blocks: S9-F5-T2, S9-F8-T1

### S9-F3-T7: Add a desktop mobile-emulator workspace

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F3
- Outcome: Developers open, float, resize, and reconnect a local mobile-client emulator against the same protocol without weakening real-device gates.
- Scope: Emulator pane; mock/real local host selection; device dimensions/orientation; input forwarding; protocol diagnostics; floating-window lifecycle; development-only boundaries.
- Start points: New `mobile/` Expo workspace; existing `src/main/lib/mobile-*` bridge/pairing/events/actions; desktop files, Git, browser, speech, usage, approval, and notification services.
- Acceptance: Emulator state cannot be mistaken for real-device evidence; production packages exclude development secrets and mock authority; pane/window restore and reconnect are deterministic.
- Verification: Pane/window lifecycle, resize/orientation, protocol skew, host restart, input routing, package exclusion, accessibility, and emulator smoke.
- Blocked by: S9-F3-T1, S9-F3-T2, S9-F3-T3
- Blocks: S9-F5-T2, S9-F8-T1

### S9-F4-T1: Add WSL execution and account parity

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F4
- Outcome: Each WSL distro acts as an execution target for files, Git, PTYs, provider homes, usage, and recovery.
- Scope: Distro inventory; path translation; service/command bridge; account selection by distro; process/PTY evidence; mixed Windows/WSL workspaces.
- Start points: Windows platform helpers, new WSL host adapter, host-aware files/Git/PTY/provider services, path translation, and Windows package tests.
- Acceptance: No host/distro credential mixing; Linux paths stay canonical in WSL; missing distro/binary is actionable; system-default logins remain untouched.
- Verification: Multi-distro fixtures, real WSL when available, path spaces/symlinks, account switch, usage, restart, process ownership, and Windows package tests.
- Blocked by: S9-F1-T1, S9-F1-T3
- Blocks: S9-F8-T1

### S9-F5-T1: Add mobile protocol compatibility, offline, and recovery gates

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F5
- Outcome: Desktop, host, PWA, and native mobile combinations fail safely across additive and breaking versions and recover from gaps/restarts.
- Scope: Version constants; capability flags; kill switches; resnapshot; cache versions; upgrade links; retry journals; compatibility matrix.
- Start points: Shared mobile-control protocol/version schemas, PWA/native caches and recovery, Expo/EAS configuration, desktop packaging metadata, and release documentation.
- Acceptance: Additive changes interoperate; breaking changes block only affected hosts/features; offline mutations never queue invisibly; retries cannot duplicate destructive actions.
- Verification: Paired-version matrix, event gaps, host/desktop/app restart, cache migration, kill switch, idempotency, and release-candidate tests.
- Blocked by: S9-F3-T2
- Blocks: S9-F5-T2, S9-F8-T1

### S9-F5-T2: Add iOS and Android build/release paths

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F5
- Outcome: Reproducible signed-development and release-candidate mobile artifacts are inspected, privacy-documented, and paired to exact desktop protocol versions.
- Scope: Expo prebuild/build; iOS/Android IDs; permissions/privacy manifests; notifications; signing placeholders; APK/TestFlight/App Store docs; artifact audit.
- Start points: Shared mobile-control protocol/version schemas, PWA/native caches and recovery, Expo/EAS configuration, desktop packaging metadata, and release documentation.
- Acceptance: Builds contain no development secrets; requested permissions match features; version/protocol metadata is exact; unsupported signing/store gates remain explicit.
- Verification: Type/lint/tests, prebuild diff audit, Android artifact inspection/smoke, iOS simulator/device build when available, privacy and dependency review.
- Blocked by: S9-F3-T4, S9-F3-T5, S9-F3-T6, S9-F3-T7, S9-F5-T1
- Blocks: S9-F8-T1

### S9-F6-T1: Define optional relay security and routing contracts

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F6
- Outcome: Desktop, host, and mobile peers can negotiate an optional relay route without giving the relay plaintext authority or making local/direct operation dependent on it.
- Scope: End-to-end session keys; peer identity binding; route capabilities; direct/relay fallback; replay protection; revocation; traffic and metadata limits; self-hosted deployment contract.
- Start points: New relay protocol/broker/cell packages, host/mobile transports, sequence/backpressure ledgers, optional service configuration, privacy schemas, and deployment tests.
- Acceptance: Relay operators cannot decrypt payloads or mint device authority; direct LAN/VPN/SSH paths remain usable without relay configuration; downgrade and replay attempts fail closed.
- Verification: Cryptographic protocol vectors, handshake/downgrade/replay, revocation, direct fallback, metadata audit, compatibility, and threat-model review.
- Blocked by: S9-F1-T1, S9-F3-T2
- Blocks: S9-F6-T2

### S9-F6-T2: Add relay broker, assignment, and regional placement

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F6
- Outcome: A replaceable relay broker assigns healthy cells and selects an allowlisted region through bounded latency probes without collecting credentials or device content.
- Scope: Broker/cell service; health catalog; assignment; three-sample probe; 24-hour cache; material-improvement threshold; explicit override; capacity and abuse limits; self-hosted configuration.
- Start points: New relay protocol/broker/cell packages, host/mobile transports, sequence/backpressure ledgers, optional service configuration, privacy schemas, and deployment tests.
- Acceptance: Region catalogs accept only broker-owned HTTPS endpoints; probe/catalog/cache failure falls back safely; assignment sends only the preferred region; a broker rollback tolerates the new field.
- Verification: Catalog allowlist, latency sampling/cache, rollback compatibility, assignment fallback, capacity, malformed/oversized frames, regional outage, and deployment smoke.
- Blocked by: S9-F6-T1
- Blocks: S9-F6-T3, S9-F6-T4

### S9-F6-T3: Route remote and native reconnect through the relay

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F6
- Outcome: Desktop, headless hosts, SSH targets, and native clients reconnect through their assigned relay while preserving sequence, ownership, backpressure, and truthful unreachable state.
- Scope: Relay channels; multiplexed RPC/events/PTY streams; sequence and credit ledgers; reconnect incarnation; route migration; notification ownership; direct-route preference.
- Start points: New relay protocol/broker/cell packages, host/mobile transports, sequence/backpressure ledgers, optional service configuration, privacy schemas, and deployment tests.
- Acceptance: Route loss never implies process exit; reconnect cannot duplicate mutations or terminal bytes; stale relay incarnations cannot publish; backpressure remains bounded across slow peers.
- Verification: Network partitions, route migration, reconnect interleavings, sequence gaps, PTY floods, slow consumers, duplicate mutation attempts, host/mobile restart, and multi-client tests.
- Blocked by: S9-F1-T4, S9-F3-T3, S9-F6-T2
- Blocks: S9-F6-T4, S9-F8-T1

### S9-F6-T4: Add relay privacy, operations, and recovery gates

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F6
- Outcome: Owners can inspect route health, revoke relay access, export redacted diagnostics, and recover from cell/director failures under documented limits.
- Scope: Route inventory; kill switch; diagnostics; retention; metrics allowlist; deployment upgrade/rollback; disaster recovery; regional failover; support runbook.
- Start points: New relay protocol/broker/cell packages, host/mobile transports, sequence/backpressure ledgers, optional service configuration, privacy schemas, and deployment tests.
- Acceptance: Logs and metrics exclude payloads, credentials, private paths, and stable cross-account identifiers; revocation closes routes; cell failure preserves direct fallback and truthful state.
- Verification: Privacy schema, log scan, revoke, kill switch, cell/director restart/upgrade/rollback, regional failover, retention, capacity degradation, and runbook exercise.
- Blocked by: S9-F6-T2, S9-F6-T3
- Blocks: S9-F8-T1

### S9-F7-T1: Define ephemeral VM recipe and trust contracts

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F7
- Outcome: Ephemeral VM workspaces use explicit, reproducible recipes with pinned source/image identity, bounded capacity, capability negotiation, and an owned cleanup boundary.
- Scope: Recipe schema; image/source pinning; host capabilities; resource quotas; root/workspace identity; provisioning states; secret references; audit and ownership records.
- Start points: Execution-host contracts, SSH transport, new ephemeral VM runtime/provisioning services, runtime settings, protected credentials, host inventory, CLI schemas, and integration harnesses.
- Acceptance: Unpinned or over-capacity recipes fail before provisioning; secrets remain references; every created resource has one owner and cleanup receipt; unsupported backends are absent.
- Verification: Schema/version, image/source validation, quotas, secret redaction, ownership collision, capability mismatch, migration, and threat-model tests.
- Blocked by: S9-F1-T1
- Blocks: S9-F7-T2

### S9-F7-T2: Provision and attach ephemeral VM runtimes

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F7
- Outcome: Users provision a temporary VM from an approved recipe and attach Flapstack files, Git, PTY, process, and agent services to the verified VM host.
- Scope: Provisioning backend interface; create/probe/bootstrap; SSH ownership; root/workspace setup; host registration; agent launch; progress/cancel; timeout and partial-failure cleanup.
- Start points: Execution-host routing, SSH profiles/transport, new ephemeral VM runtime/provisioning services, runtime settings, protected credentials, host inventory, CLI schemas, and integration harnesses.
- Acceptance: Provisioning never grants broader cloud or host authority than the recipe; cancel/timeout cleans only owned resources; attached operations cannot fall back locally; retries are idempotent.
- Verification: Fake and disposable backend end-to-end, bootstrap failure, auth/host-key, cancel/timeout, retry, path/PTY/Git parity, capacity, and secret exposure tests.
- Blocked by: S9-F1-T3, S9-F2-T1, S9-F7-T1
- Blocks: S9-F7-T3, S9-F7-T4

### S9-F7-T3: Add VM resume, snapshot, recovery, and verified cleanup

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F7
- Outcome: Owned ephemeral VM workspaces resume or terminate truthfully, preserve approved state only, and leave no orphaned billable resource after verified cleanup.
- Scope: Runtime journal; snapshot/resume policy; TTL/idle expiry; unreachable/orphan detection; cleanup retries; cost/resource visibility; recovery and manual repair receipts.
- Start points: Execution-host recovery, ephemeral VM runtime/provisioning services, terminal journal, workspace cleanup authority, host inventory, diagnostics, and integration harnesses.
- Acceptance: Disconnect never implies deletion; snapshot scope is explicit; cleanup revalidates provider/resource identity; failed cleanup remains visible and retryable; no unrelated VM, volume, key, or network is touched.
- Verification: Restart/disconnect, snapshot/resume integrity, TTL/idle expiry, partial deletion, provider drift, orphan reconciliation, retry/idempotency, cost-state, and disposable-backend tests.
- Blocked by: S9-F7-T2
- Blocks: S9-F7-T4, S9-F8-T1

### S9-F7-T4: Add VM controls, emulator, and integrated runtime tests

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F7
- Outcome: Desktop, CLI, and granted mobile surfaces create, inspect, connect, stop, resume, and clean up ephemeral VM runtimes with an emulator for deterministic development.
- Scope: Runtime UI/status; CLI commands and receipts; mobile projections/actions; recipe editor; local emulator/fake backend; notifications; diagnostics; package exclusions; acceptance matrix.
- Start points: Ephemeral VM runtime/provisioning services, desktop runtime settings, operator CLI, native mobile runtime slices, notification/diagnostic services, package manifests, and test harnesses.
- Acceptance: Every mutation previews exact backend, recipe, resource, cost/TTL effect, and target; mobile authority remains grant-scoped; emulator state cannot count as real-backend evidence; production packages contain no test credentials.
- Verification: UI/accessibility, CLI schemas, mobile grants, create/connect/stop/resume/delete, emulator parity, notification, redaction, package audit, and credentialed disposable-backend smoke when available.
- Blocked by: S9-F7-T2, S9-F7-T3
- Blocks: S9-F8-T1

### S9-F8-T1: Close integrated Stage 9 acceptance

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S9 / Feature S9-F8
- Outcome: Local, headless, SSH, WSL, ephemeral VM, PWA, native, direct, and optional relay clients share truthful authority, recovery, and version behavior on one exact candidate.
- Scope: Integrated matrix; threat review; mixed versions; direct/relay/remote/VM/mobile failures; performance; package/mobile artifacts; owner-test backlog.
- Start points: Stage 9 local/SSH/WSL/VM/mobile/relay integration suites, threat review, compatibility matrix, package artifacts, and owner-testing backlog.
- Acceptance: No secret or authority crosses targets; disconnects never falsify state; revoked identities stop; no P0/P1 or T2-core blocker; uncertified devices/stores remain explicit.
- Verification: Desktop `npm run check`, mobile gates, strict OpenSpec when available, local/SSH/WSL/device e2e as available, desktop/mobile artifact inspection/smoke.
- Blocked by: S9-F1-T4, S9-F2-T2, S9-F2-T3, S9-F3-T3, S9-F3-T4, S9-F3-T5, S9-F3-T6, S9-F3-T7, S9-F4-T1, S9-F5-T1, S9-F5-T2, S9-F6-T3, S9-F6-T4, S9-F7-T3, S9-F7-T4
- Blocks: S10-F1-T1, S10-F2-T1, S10-F3-T1, S10-F4-T1, S10-F5-T1
