# S5-F10 — Cross-Platform Public Distribution

### S5-F10-T1 — Lock support matrix, release channels, artifacts, and credential ownership

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F10
- Outcome: Public/Preview channels, target OS/architectures, artifact types, signing owners, hosts/runners, and stop/go rules are explicit.
- Scope: macOS/Windows/Linux matrix; minimum versions; arm/x64; DMG/ZIP/installer/package choices; distribution location; update boundary; Apple/Windows credentials; native hosts; retention/withdrawal.
- Out of scope: Credential purchase or artifact build.
- Acceptance: Every claimed target has native owner/host and evidence path; hosted sign-in/sync/telemetry remain excluded; unavailable credentials are explicit blockers.
- Verification: Release/security/operations review and matrix link check.
- Blocked by: Stage 5 feature candidate scope
- Blocks: S5-F5-T7, S5-F10-T2, S5-F10-T3, S5-F10-T4, S5-F10-T5, S5-F10-T6, S5-F10-T7
- Context: electron-builder configs, current Preview commands, future release considerations.

### S5-F10-T2 — Add macOS signing, notarization, staple, and credential runbook

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F10
- Outcome: macOS artifacts pass Developer ID signing and Apple notarization without exposing credentials.
- Scope: Developer Program/certificate prerequisite; hardened runtime/entitlements; nested binaries/sidecars; notarization upload/wait/log; staple; credential storage/rotation; failure/revoke/expiry runbook.
- Out of scope: Publishing before other gates.
- Acceptance: Every executable/library is correctly signed; notarization/staple validate; credentials absent from repo/logs/artifacts.
- Verification: codesign/spctl/stapler inspection, notarization record, secret scan, clean keychain recovery rehearsal.
- Blocked by: S5-F10-T1 and available Apple Developer credentials
- Blocks: S5-F10-T3, S5-F10-T6, S5-F10-T8
- Context: mac package config, bundled Runtime/speech/native sidecars.

### S5-F10-T3 — Prove macOS public install, first launch, upgrade, recovery, and uninstall

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F10
- Outcome: Signed/notarized macOS DMG/ZIP behaves correctly on clean supported machines.
- Scope: Download/quarantine; Gatekeeper; install; first-run onboarding; permissions; data/profile; agents/speech/services/helper; upgrade preserving data; rollback/backup; uninstall/cleanup; diagnostics.
- Out of scope: Windows/Linux.
- Acceptance: No unsafe bypass; expected prompts documented; upgrade preserves data; uninstall removes owned processes/services with explicit data choice.
- Verification: Clean macOS arm64 and x64/translated-or-native matrix as declared, package smoke, filesystem/process inspection.
- Blocked by: S5-F9-T3, S5-F10-T1, S5-F10-T2
- Blocks: S5-F10-T7, S5-F10-T8
- Context: onboarding, LaunchAgent, speech, capture helper, app data paths.

### S5-F10-T4 — Build and prove native Windows distribution

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F10
- Outcome: Declared Windows packages install and run all required shared/native features with honest limitations.
- Scope: Native build; signing decision; installer; paths; native modules/PTY; secret store; services/daemon; Runtimes; speech/capture; firewall/mobile; upgrade/uninstall; logs/diagnostics; clean VM/host.
- Out of scope: Inferring from macOS/cross-build.
- Acceptance: Required matrix passes natively; path/permission/service cleanup correct; unsupported items documented.
- Verification: Native Windows Node 22 check, install/upgrade/uninstall, Dev/package feature matrix, security/process/filesystem inspection.
- Blocked by: S5-F10-T1 and native Windows host/credentials where required
- Blocks: S5-F7-T6, S5-F10-T6, S5-F10-T7, S5-F10-T8
- Context: Windows builder, services, safe storage, shell/path validation.

### S5-F10-T5 — Build and prove native Linux distribution

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F10
- Outcome: Declared Linux packages install and run required shared/native features with honest desktop/service limitations.
- Scope: Native build; AppImage/deb/rpm decision; desktop integration; native modules/PTY; secret store fallback; systemd/user service; Runtimes; speech/capture/display server; firewall/mobile; upgrade/uninstall; clean VM/host.
- Out of scope: Inferring from cross-build or one distro for all.
- Acceptance: Required distro/display matrix passes natively; secret/service fallback honest; unsupported items documented.
- Verification: Native Linux Node 22 check, install/upgrade/uninstall, X11/Wayland as declared, Dev/package feature matrix, process/filesystem inspection.
- Blocked by: S5-F10-T1 and native Linux hosts
- Blocks: S5-F7-T6, S5-F10-T6, S5-F10-T7, S5-F10-T8
- Context: Linux builder, systemd user service, keyring, display/capture.

### S5-F10-T6 — Add artifact integrity, dependency/SBOM, and release security gates

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F10
- Outcome: Every candidate artifact is inspectable, attributable, architecture-correct, secret-free, and security-scanned.
- Scope: Checksums; file manifest; version/SHA; architecture; bundled binaries/licenses; dependency/SBOM; secret scan; malware/notary/signature results; reproducibility metadata; provenance record.
- Out of scope: Claiming perfect supply-chain security.
- Acceptance: Mismatch/secret/unexpected binary/high-severity unresolved issue blocks publication; reports exclude sensitive paths/keys.
- Verification: Automated artifact inspection on macOS/Windows/Linux candidates plus independent security review.
- Blocked by: S5-F10-T2, S5-F10-T4, S5-F10-T5
- Blocks: S5-F10-T7, S5-F10-T8, S5-F11-T4
- Context: package manifests, lockfile, licenses, signing tools.

### S5-F10-T7 — Write platform installation, support, diagnostics, and recovery docs

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F10
- Outcome: Users can install, grant permissions, diagnose, back up, recover, upgrade, and uninstall without unsafe instructions.
- Scope: Per-platform guides; system requirements; artifact verification; first launch; permissions; data paths; logs; backup/restore; migration; services; helper; known limits; support bundle; uninstall; withdrawal/recovery.
- Out of scope: Hosted support portal.
- Acceptance: Docs match observed package; commands/paths verified; no signing/security bypass; secret-safe support bundle.
- Verification: Fresh user follows each guide on clean target; link/command/path review and support-bundle secret scan.
- Blocked by: S5-F10-T3, S5-F10-T4, S5-F10-T5, S5-F10-T6
- Blocks: S5-F10-T8, S5-F11-T7
- Context: README, package scripts, diagnostics, data/profile docs.

### S5-F10-T8 — Close cross-platform distribution acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F10
- Outcome: Every promoted target has signed/verified artifacts and observed native lifecycle/feature evidence.
- Scope: Matrix S5-PD; artifacts; signing; install/upgrade/uninstall; first-run; services; secrets; agents; speech; capture; performance; docs; withdrawal rehearsal.
- Out of scope: Targets not explicitly promoted in T1.
- Acceptance: No target promoted from cross-build; all artifacts map exact SHA; platform limitations are public and truthful.
- Verification: Native platform matrices, artifact/security gates, Node 22 checks, performance budgets, independent release review.
- Blocked by: S5-F9-T8, S5-F10-T2, S5-F10-T3, S5-F10-T4, S5-F10-T5, S5-F10-T6, S5-F10-T7
- Blocks: S5-F11-T2, S5-F11-T4, S5-F11-T6, S5-F11-T7, S5-F12-T9
- Context: docs/stage5-full-feature-test-matrix.md.
