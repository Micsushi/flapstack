# S10: Sharing, Distribution, and Support

### S10-F1-T1: Define immutable skill-bundle and trust contracts

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S10 / Feature S10-F1
- Outcome: Skills and bundles have canonical manifests, immutable versions, digests, author provenance, executable/script disclosure, and destination capability rules.
- Scope: Manifest/schema; canonical archive; digest/signature; size/file/path limits; author/org identity; release notes; global/workspace scope; provider placement map.
- Start points: `src/main/lib/skills/`, skills tRPC/UI, provider placement adapters, host transport, credential service, new bundle/share service, and migrations.
- Acceptance: Archive order and metadata cannot change the digest; paths cannot escape; scripts/executables are visible before install; malformed or incompatible bundles fail without writes or execution.
- Verification: Canonicalization vectors, traversal/symlink/archive-bomb cases, signature/provenance, size/count limits, compatibility, and no-execution tests.
- Blocked by: S9-F8-T1
- Blocks: S10-F1-T2, S10-F1-T3

### S10-F1-T2: Add protected cross-host skill installation

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S10 / Feature S10-F1
- Outcome: Users preview and transactionally install, update, roll back, or remove managed skills on local, WSL, SSH, and headless targets.
- Scope: Destination resolver; provider paths; new/unchanged/update/conflict plan; keep-local default; staging/atomic apply; ownership ledger; restart recovery; removal safeguards.
- Start points: `src/main/lib/skills/`, skills tRPC/UI, provider placement adapters, host transport, credential service, new bundle/share service, and migrations.
- Acceptance: Modified or unowned files are preserved by default; interrupted installs recover; rollback restores one retained immutable version; removal touches only verified owned copies and placements.
- Verification: Multi-provider/host fixtures, conflicts, partial failure, restart, rollback, removal, symlink/path races, permission, audit, and selected live-agent discovery smokes.
- Blocked by: S10-F1-T1
- Blocks: S10-F1-T3, S10-F6-T1

### S10-F1-T3: Add optional revocable skill share links

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S10 / Feature S10-F1
- Outcome: Authorized users publish immutable skill versions or bundles behind unlisted links and recipients inspect and install selected skills without public discovery.
- Scope: Optional account/auth; upload grant; quarantine; object storage; preview/download grant; versioning; link copy/revoke/delete; retention; self-hosted endpoint.
- Start points: `src/main/lib/skills/`, skills tRPC/UI, provider placement adapters, host transport, credential service, new bundle/share service, and migrations.
- Acceptance: A link reveals no local paths or secret content; revocation blocks new grants; missing/revoked/deleted responses do not disclose existence; publishing a new version never mutates old bytes.
- Verification: Upload/download grants, expiry, revoke/delete races, quarantine, immutable version, enumeration resistance, retention, self-hosted deployment, and privacy audit.
- Blocked by: S10-F1-T1, S10-F1-T2
- Blocks: S10-F6-T1

### S10-F2-T1: Define bounded artifact publication

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S10 / Feature S10-F2
- Outcome: Selected task/run artifacts can become immutable content-addressed publications with explicit type, size, retention, provenance, and redaction state.
- Scope: Publishable type allowlist; digest; metadata; preview generation; malware/content scan hook; upload/download grants; revoke/delete; local/self-hosted storage adapter.
- Start points: Attachments/task artifacts, preview/redaction services, new publication adapters, artifact UI, operator CLI, mobile DTOs, and migrations.
- Acceptance: Publication never expands from one selected artifact to adjacent files; unsupported/oversized/private artifacts fail before upload; previews cannot execute active content; versions are immutable.
- Verification: Type/size/path limits, active HTML/PDF/image fixtures, redaction, digest, upload faults, revoke/delete races, retention, and storage-adapter tests.
- Blocked by: S9-F8-T1
- Blocks: S10-F2-T2

### S10-F2-T2: Add artifact publish and link-management surfaces

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S10 / Feature S10-F2
- Outcome: Desktop, CLI, and granted mobile clients publish, inspect, copy, revoke, and delete artifact links through one production service.
- Scope: Artifact page/actions; preview/confirmation; version list; published-link panel; CLI commands; mobile projection; permissions; audit; exact-source linkage.
- Start points: Attachments/task artifacts, preview/redaction services, new publication adapters, artifact UI, operator CLI, mobile DTOs, and migrations.
- Acceptance: Clients show exact artifact/version/size/retention before publish; retries are idempotent; revocation is immediate for new grants; no client receives storage credentials.
- Verification: UI/accessibility, CLI schemas, mobile grants, idempotency, revoke/delete, stale artifact identity, permission denial, restart, and end-to-end self-hosted smoke.
- Blocked by: S8-F3-T3, S9-F3-T4, S10-F2-T1
- Blocks: S10-F6-T1

### S10-F3-T1: Add localization extraction and catalog gates

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S10 / Feature S10-F3
- Outcome: Desktop, CLI, native mobile, and shared product strings use stable keys and generated catalogs with CI coverage enforcement.
- Scope: i18n runtime; source extraction; English catalog; interpolation/plural rules; locale metadata; fallback; pseudo-locale; dead/missing key checks; contributor workflow.
- Start points: Renderer, CLI, shared, and mobile user-facing strings; new i18n runtime/catalog tooling; settings/onboarding locale UI; and CI coverage gates.
- Acceptance: Raw user-facing strings in governed surfaces fail CI; missing keys fall back to English without raw identifiers; interpolation cannot inject markup; catalogs are deterministic.
- Verification: Extraction snapshots, missing/dead/duplicate keys, plural/interpolation, pseudo-locale overflow, desktop/mobile/CLI type checks, and package smoke.
- Blocked by: S9-F8-T1
- Blocks: S10-F3-T2

### S10-F3-T2: Ship initial language packs and locale UX

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S10 / Feature S10-F3
- Outcome: Users select Simplified Chinese, Japanese, Korean, Spanish, French, or Portuguese and see compatible desktop/mobile core workflows localized.
- Scope: Six catalogs; settings/onboarding selector; locale detection; live switch/restart boundary; dates/numbers/shortcuts; fonts/layout; pack compatibility and fallback.
- Start points: Renderer, CLI, shared, and mobile user-facing strings; new i18n runtime/catalog tooling; settings/onboarding locale UI; and CI coverage gates.
- Acceptance: Core onboarding, navigation, Chat, permissions, settings, provider, mobile, and recovery paths meet the coverage threshold; unsupported/stale packs fall back safely; locale never changes command or file semantics.
- Verification: Coverage audit, locale snapshots, pseudo/real long strings, RTL-readiness audit, date/number formatting, IME, screen readers, mobile/desktop package smokes, and human language review gate.
- Blocked by: S10-F3-T1
- Blocks: S10-F6-T1

### S10-F4-T1: Define signed update channels and rollout authority

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S10 / Feature S10-F4
- Outcome: Preview and stable update manifests bind exact source, artifact, platform, architecture, protocol/database compatibility, rollout, and signature authority.
- Scope: Manifest/schema; signing keys and rotation; channel policy; staged rollout cohort; minimum/rollback versions; CDN/self-hosted source; revocation; offline verification.
- Start points: `src/main/index.ts`, packaging/release scripts and config, new updater state service, migrations, platform installers, and release documentation.
- Acceptance: Unsigned, wrong-channel, wrong-platform, downgraded, expired, or revoked manifests fail before download/install; local builds never impersonate a release channel.
- Verification: Signature/key rotation, downgrade/rollback, channel/platform mismatch, rollout determinism, revocation, offline cache, malformed manifest, and threat review.
- Blocked by: S9-F8-T1
- Blocks: S10-F4-T2

### S10-F4-T2: Add durable update, restart, health, and rollback lifecycle

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S10 / Feature S10-F4
- Outcome: Users download, verify, schedule, install, restart, health-check, and roll back updates without losing the prior package or user data.
- Scope: Update state machine; resumable download; digest/signature check; busy-work deferral; restart handoff; migration compatibility; health marker/watchdog; retry budget; rollback UI.
- Start points: `src/main/index.ts`, packaging/release scripts and config, new updater state service, migrations, platform installers, and release documentation.
- Acceptance: Active work is never killed without confirmation; failed verification does not install; failed health restores or offers the prior package; bad candidates do not loop; database changes remain rollback-compatible within policy.
- Verification: State-machine/property tests, interrupted download, corrupt artifact, busy runs, restart crash, migration failure, watchdog, rollback, retry exhaustion, and update E2E harness.
- Blocked by: S10-F4-T1
- Blocks: S10-F4-T3

### S10-F4-T3: Certify platform update and rollback paths

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S10 / Feature S10-F4
- Outcome: macOS, Windows, Linux, iOS, and Android release paths publish exact compatible artifacts and prove their supported update or store-mediated rollback behavior.
- Scope: DMG/ZIP, NSIS/portable, AppImage/deb, TestFlight/App Store, Android APK/store; signing/notarization; manifest publication; channel promotion; artifact retention; release runbook.
- Start points: `src/main/index.ts`, packaging/release scripts and config, new updater state service, migrations, platform installers, and release documentation.
- Acceptance: Every claimed platform has an exact signed artifact, digest, source revision, protocol range, install/upgrade result, and documented rollback boundary; unsupported store rollback remains explicit.
- Verification: Artifact inspection, clean install/upgrade/rollback VMs/devices, signing/notarization, manifest/CDN redirects, channel promotion rehearsal, retention, and runbook review.
- Blocked by: S10-F4-T2
- Blocks: S10-F6-T1

### S10-F5-T1: Add crash survival and redacted local support bundles

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S10 / Feature S10-F5
- Outcome: Flapstack recovers durable work after renderer/main failure and lets users preview and export a bounded support bundle from allowlisted diagnostics.
- Scope: Crash marker/watchdog; renderer reload; safe-mode startup; last-known run/PTY reconciliation; allowlisted logs/state; redaction; size/time limits; bundle preview/export/delete.
- Start points: `src/main/lib/analytics.ts`, diagnostics and test-control services, process/PTY recovery, new crash/support store and UI, consent settings, and package harnesses.
- Acceptance: Recovery never replays a mutation or adopts an unrelated process; bundle generation reads no arbitrary project files; prompts, file contents, credentials, private paths, share URLs, and unsupported fields are absent or redacted.
- Verification: Renderer/main/native crash harnesses, restart reconciliation, safe mode, process identity, redaction corpus, bundle limits, corrupt logs, export/delete, and package smokes.
- Blocked by: S9-F8-T1
- Blocks: S10-F5-T2, S10-F5-T3

### S10-F5-T2: Add separately consented crash and support reporting

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S10 / Feature S10-F5
- Outcome: Users explicitly send selected crash/support evidence to a configured endpoint and can revoke that consent independently of analytics.
- Scope: Consent state; evidence selection; upload grant; abort/retry; endpoint adapter; retention receipt; deletion request; offline/local-only mode; settings and privacy copy.
- Start points: `src/main/lib/analytics.ts`, diagnostics and test-control services, process/PTY recovery, new crash/support store and UI, consent settings, and package harnesses.
- Acceptance: Missing/malformed/revoked consent fails closed; revocation aborts active upload and prevents retry; endpoint failure never affects app behavior; local operation and bundle export remain available without service access.
- Verification: Consent races, abort/retry, network loss, endpoint substitution, retention/deletion receipts, analytics independence, secret scan, settings accessibility, and self-hosted endpoint smoke.
- Blocked by: S10-F5-T1
- Blocks: S10-F6-T1

### S10-F5-T3: Add system tray continuity and explicit quit semantics

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S10 / Feature S10-F5
- Outcome: Windows and Linux users can keep Flapstack available from a system tray, inspect attention/running state, reopen the app, and choose between closing windows and fully quitting owned background services.
- Scope: Tray lifecycle/icon/menu; attention and running summaries; show/hide; start-at-login boundary; quit/restart/update actions; daemon/PTY/relay ownership; notification coexistence; macOS dock/menu parity.
- Start points: `src/main/index.ts`, window lifecycle, app menu/dock code, notifications/unread state, runtime/terminal service ownership, updater state, and platform package assets.
- Acceptance: Closing a window never implies full quit without the configured behavior; full quit reconciles or preserves owned runs/PTYs truthfully; tray state exposes no prompt/file content; updates and crash recovery cannot leave duplicate tray owners.
- Verification: Windows/Linux tray lifecycle, macOS dock/menu regression, multi-window show/hide, attention state, login launch, full quit with active resources, restart/update/crash, accessibility, and packaged smoke.
- Blocked by: S10-F5-T1
- Blocks: S10-F6-T1

### S10-F6-T1: Close integrated Stage 10 acceptance

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S10 / Feature S10-F6
- Outcome: Sharing, localization, updates, rollback, crash recovery, and support workflows operate together without making local Flapstack depend on hosted services.
- Scope: Integrated matrix; migrations; privacy/security; service outages; package/mobile artifacts; language coverage; update/rollback; support redaction; owner-test backlog.
- Start points: Stage 10 sharing/i18n/updater/crash integration suites, privacy review, service-outage matrix, signed artifacts, acceptance matrix, and owner-testing backlog.
- Acceptance: Local-only mode retains all core development workflows; shared bytes are immutable and revocable; updates are signed and recoverable; support uploads require separate consent; no P0/P1 or T2-core blocker remains.
- Verification: Desktop/mobile checks, strict OpenSpec, focused integration/e2e, service-outage matrix, language gates, signed update/rollback rehearsal, crash/support harnesses, artifact inspection, and package smoke.
- Blocked by: S10-F1-T2, S10-F1-T3, S10-F2-T2, S10-F3-T2, S10-F4-T3, S10-F5-T2, S10-F5-T3
- Blocks: none
