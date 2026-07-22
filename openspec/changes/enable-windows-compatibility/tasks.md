# Stage 5 - Native Windows Compatibility

Task state lives only here. Every completion requires linked implementation,
automated evidence, native Windows observation where specified, and matching
matrix rows in `docs/stage5-full-feature-test-matrix.md`.

## S5-F1 - Supported Windows Toolchain

### S5-F1-T1 - Freeze Windows support and evidence matrix

- [ ] Completion: support matrix and evidence template approved
- Outcome: Required Windows edition/architecture, shell, artifact, VM, account, credential, audio, and upgrade profiles are explicit.
- Scope: Windows 11 x64; PowerShell 7/5.1; clean and upgrade VMs; standard/admin users; Preview/NSIS/portable; native-only evidence.
- Acceptance: Every support claim has owner, host, command/walkthrough, evidence field, and stop/go rule; unclaimed targets remain explicit.
- Verification: Matrix review against package config, CI, runtime adapters, and Stage 5 docs.
- Blocks: S5-F1-T2 through T7 and S5-F9-T1.
- Context: `package.json`, electron-builder configuration, `docs/stage5-full-feature-test-matrix.md`.

### S5-F1-T2 - Pin Node, npm, and Python acceptance versions

- [ ] Completion: version files and package engines enforce accepted versions
- Outcome: Clean setup consistently uses Node 22, repository npm, and Python 3.11 instead of machine defaults such as Node 25/Python 3.13.
- Scope: `package.json` engines/packageManager; Node/Python version files; CI inputs; bootstrap and diagnostics.
- Acceptance: Supported versions pass; unsupported major versions fail before native work with exact repair guidance.
- Verification: Version-contract tests plus supported/unsupported clean-shell probes.
- Blocked by: S5-F1-T1.
- Blocks: S5-F1-T3, S5-F1-T4, S5-F3-T1, S5-F4-T1.

### S5-F1-T3 - Detect CMake, Rust, MSVC, Build Tools, and Windows SDK

- [ ] Completion: prerequisite diagnostic covers full native toolchain
- Outcome: Missing CMake/Rust/MSVC/SDK cannot surface later as opaque npm or speech build failure.
- Scope: `cmake`, `cargo`, `rustc`, MSVC compiler/linker, VS 2022 Build Tools Desktop C++ workload, x64/x86 Spectre-mitigated libraries required by `node-pty`, Windows SDK, architecture.
- Acceptance: Diagnostic reports detected path/version/architecture, flags unsupported combinations, and gives official install component names without mutating machine state.
- Verification: Fixture tests plus clean VM probes with each dependency absent/present.
- Blocked by: S5-F1-T1, S5-F1-T2.
- Blocks: S5-F1-T4, S5-F3-T3, S5-F3-T4, S5-F7-T1.

### S5-F1-T4 - Add one Windows prerequisite and bootstrap command

- [ ] Completion: root bootstrap entrypoint and Windows setup guide reproduce clean setup
- Outcome: Developer gets deterministic preflight, install order, binary preparation, and next commands from one documented entrypoint.
- Scope: Read-only preflight by default; explicit optional setup helpers; install, binary downloads, ABI preparation; reboot/shell refresh guidance.
- Acceptance: Fresh user follows guide without manual source patch, WSL, Git Bash, or hidden global environment edits.
- Verification: Clean Windows VM walkthrough from clone through `npm run check` readiness.
- Blocked by: S5-F1-T2, S5-F1-T3.
- Blocks: S5-F1-T6, S5-F3-T8, S5-F4-T1.

### S5-F1-T5 - Normalize environment discovery and sanitized diagnostics

- [ ] Completion: one platform-aware environment report exists
- Outcome: Tool resolution failures can be diagnosed without exposing credentials, usernames, private paths, or full environment dumps.
- Scope: PATH segments, executable resolution, architecture, shell, repo root, temp/cache/output availability, redaction rules.
- Acceptance: Report explains conflicting/missing tools and path precedence; secret-like values and user-specific path prefixes are redacted.
- Verification: Snapshot/redaction tests and diagnostics review on clean/user-customized hosts.
- Blocked by: S5-F1-T1, S5-F1-T3.
- Blocks: S5-F2-T1, S5-F4-T3, S5-F9-T5.

### S5-F1-T6 - Prove spaces, Unicode, long paths, and restricted directories

- [ ] Completion: path-variant toolchain suite passes
- Outcome: Supported setup does not assume simple ASCII paths or writable global directories.
- Scope: Repo/userData/temp/cache paths; spaces, Unicode, long paths; standard user; read-only/global-write denial.
- Acceptance: Bootstrap and preflight either pass or give safe actionable limitation without corrupting state.
- Verification: Parameterized Windows path suite and clean VM walkthrough.
- Blocked by: S5-F1-T4, S5-F1-T5.
- Blocks: S5-F2-T5, S5-F3-T8, S5-F5-T7.

### S5-F1-T7 - Close toolchain acceptance and operator docs

- [ ] Completion: S5-TC matrix rows pass and docs match observed setup
- Outcome: Supported Windows developer environment is reproducible and maintainable.
- Scope: Prerequisite table, install order, verification commands, common failures, repair, upgrades, evidence links.
- Acceptance: Independent user provisions clean host and reaches green preflight using docs only.
- Verification: `S5-TC01` through `S5-TC05`, link/command review, secret scan.
- Blocked by: S5-F1-T2 through T6.
- Blocks: S5-F3-T8, S5-F4-T8, S5-F9-T2.

## S5-F2 - Portable Build Scripts

### S5-F2-T1 - Create cross-platform executable resolver and process runner

- [ ] Completion: shared runner has unit tests and replaces ad hoc critical spawns
- Outcome: Node, npm/npx, Python, CMake, Cargo, and helper binaries resolve correctly on Windows `.cmd`/`.exe` and POSIX hosts.
- Scope: Argument arrays, `shell: false` default, Windows shim discovery, cwd/env, stdio, exit/signal propagation, redacted diagnostics.
- Acceptance: No command-string interpolation; spaces/Unicode/special characters survive unchanged; missing executable gives actionable error.
- Verification: Unit/integration matrix on Windows and macOS.
- Blocked by: S5-F1-T5.
- Blocks: S5-F2-T2 through T8, S5-F3-T2, S5-F3-T6.
- Context: `scripts/*.mjs`, `child_process` call sites, npm shims.

### S5-F2-T2 - Replace POSIX build environment assignment

- [ ] Completion: production build sets environment variables platform-neutrally
- Outcome: `npm run build` no longer depends on `NODE_OPTIONS=... command` syntax.
- Scope: Build entrypoint, environment allowlist, inherited values, memory option, Windows/macOS behavior.
- Acceptance: Build gets intended options on Windows and macOS; user-supplied unrelated environment remains intact.
- Verification: Environment-capture tests and full production builds on both OS families.
- Blocked by: S5-F2-T1.
- Blocks: S5-F2-T9, S5-F4-T1, S5-F8-T1.
- Context: `package.json`, build wrapper scripts.

### S5-F2-T3 - Replace `sh -c` in full check gate

- [ ] Completion: `npm run check` uses platform-neutral ordered orchestration
- Outcome: Lint, style, typecheck, tests, and build run fail-fast without `sh`.
- Scope: Step ordering, exit code, signal forwarding, readable step boundaries, CI parity.
- Acceptance: First failed step stops later steps; success runs all steps; Windows/macOS outputs identify failing gate.
- Verification: Injected failure tests at each step plus native full check.
- Blocked by: S5-F2-T1, S5-F2-T2.
- Blocks: S5-F2-T9, S5-F4-T1, S5-F9-T3.
- Context: `package.json`, `scripts/with-heavy-job-lock.mjs`.

### S5-F2-T4 - Make heavy-job and UI locks Windows-safe

- [ ] Completion: lock acquisition, contention, stale recovery, and cleanup pass on Windows
- Outcome: Lint/style/check/build/package serialization launches npm shims reliably and never deadlocks after crash.
- Scope: Atomic lock files, PID ownership, process liveness, timeout, Ctrl+C, stale lock, path normalization.
- Acceptance: Concurrent jobs serialize; killed owner releases/reclaims safely; unrelated process cannot lose its lock.
- Verification: Multi-process contention/crash tests on Windows and macOS.
- Blocked by: S5-F2-T1.
- Blocks: S5-F2-T9, S5-F4-T6, S5-F8-T1.
- Context: `scripts/with-heavy-job-lock.mjs`, `scripts/with-ui-lock.mjs`.

### S5-F2-T5 - Harden Windows quoting and path argument handling

- [ ] Completion: command/path corpus passes every script runner
- Outcome: Spaces, Unicode, parentheses, ampersands, percent signs, quotes, and long paths cannot alter command meaning.
- Scope: Download, rebuild, package, inspect, dev, verify, and helper-launch arguments.
- Acceptance: Arguments arrive byte-for-byte/character-for-character at fixture executable; no shell injection or truncation.
- Verification: Property/corpus tests on Windows with malicious and ordinary paths.
- Blocked by: S5-F1-T6, S5-F2-T1.
- Blocks: S5-F3-T2, S5-F5-T1, S5-F6-T1, S5-F8-T1.

### S5-F2-T6 - Port package, download, and native preparation entrypoints

- [ ] Completion: critical scripts use shared runner and platform-aware paths
- Outcome: Package resource preparation and Claude/Codex/native dependency commands work from PowerShell.
- Scope: `scripts/package-app.mjs`, `prepare-package-resources.mjs`, download scripts, ABI scripts, staging/cleanup.
- Acceptance: No Unix executable-name, quoting, separator, permission-bit, or path-layout assumption remains in required Windows lane.
- Verification: Script unit tests, dry-run manifests, Windows package preparation smoke.
- Blocked by: S5-F2-T1, S5-F2-T5.
- Blocks: S5-F3-T2, S5-F3-T6, S5-F8-T1.

### S5-F2-T7 - Remove required POSIX shell and command dependencies

- [ ] Completion: required-command audit contains no Windows-blocking dependency
- Outcome: `sh`, `bash`, `/bin/zsh`, `open -a`, `which`, POSIX env assignment, and Unix-only utilities do not gate Windows workflows.
- Scope: npm scripts, Node scripts, Electron main process, speech credentials, docs, CI, tests.
- Acceptance: Each occurrence is ported, isolated to guarded non-Windows branch, or documented as non-required platform code.
- Verification: Static audit test plus native command walkthrough.
- Blocked by: S5-F2-T1.
- Blocks: S5-F5-T1, S5-F7-T2, S5-F2-T9.

### S5-F2-T8 - Preserve exit, cancellation, and log semantics

- [ ] Completion: process contract suite passes on Windows
- Outcome: Ctrl+C, child failure, timeout, signal emulation, and output streaming behave consistently across wrapper layers.
- Scope: Process tree ownership, graceful timeout, forced fallback, exit code mapping, stdout/stderr, redaction.
- Acceptance: Failure never reports success; cancellation does not leave lock/child; sensitive arguments never print.
- Verification: Fixture process tree tests and manual cancellation during check/build/download.
- Blocked by: S5-F2-T1, S5-F2-T4.
- Blocks: S5-F4-T4, S5-F4-T6, S5-F5-T6, S5-F6-T6.

### S5-F2-T9 - Close portable-script acceptance

- [ ] Completion: S5-PS matrix rows and shared-platform regressions pass
- Outcome: Root workflows have one trustworthy cross-platform command contract.
- Scope: Install helpers, lint, style, typecheck, test, build, check, dev, verify, package preparation.
- Acceptance: Required commands pass native PowerShell and macOS; static audit finds no unguarded POSIX dependency.
- Verification: `S5-PS01` through `S5-PS07`, Windows/macOS CI, full command transcript.
- Blocked by: S5-F2-T2 through T8.
- Blocks: S5-F3-T8, S5-F4-T8, S5-F8-T10, S5-F9-T2.

## S5-F3 - Native Dependency Install

### S5-F3-T1 - Define install and ABI dependency graph

- [ ] Completion: install phases and ownership are explicit and tested
- Outcome: npm install, binary download, Node native ABI, Electron native ABI, speech build, and package preparation run in deterministic order.
- Scope: `preinstall`/`postinstall`, npm lifecycle, cache, success markers, recovery, package invalidation.
- Acceptance: No consumer runs before prerequisite; repeated install is idempotent; partial failure resumes safely.
- Verification: Dependency-graph tests and injected failure at each phase.
- Blocked by: S5-F1-T2.
- Blocks: S5-F3-T2 through T8.

### S5-F3-T2 - Fix Windows native rebuild command resolution

- [ ] Completion: native rebuild tools launch through resolved Windows executables
- Outcome: `npm ci` no longer fails because rebuild scripts invoke Unix-style npm/npx/electron-rebuild names.
- Scope: npm/npx `.cmd`, local `node_modules/.bin`, electron-builder rebuild, cwd/env, error output.
- Acceptance: Clean install resolves repository-local tools first and never depends on shell command lookup.
- Verification: Resolver fixtures and empty-cache Windows install.
- Blocked by: S5-F2-T1, S5-F2-T5, S5-F2-T6, S5-F3-T1.
- Blocks: S5-F3-T3, S5-F3-T4, S5-F3-T8.

### S5-F3-T3 - Build and probe Node ABI modules

- [ ] Completion: better-sqlite3 and node-pty pass real Node load/use probes
- Outcome: Development/test tooling gets architecture-correct native modules for Node 22.
- Scope: Rebuild inputs, MSVC/Python selection, SQLite open/query, PTY spawn/resize/exit.
- Acceptance: Real probes pass after clean install and repair; wrong ABI/architecture fails before marker write.
- Verification: Native Node probes and corruption/wrong-ABI recovery tests.
- Blocked by: S5-F1-T3, S5-F3-T2.
- Blocks: S5-F3-T4, S5-F3-T5, S5-F4-T1.

### S5-F3-T4 - Build and probe Electron ABI modules

- [ ] Completion: required modules load and operate under packaged Electron version
- Outcome: Dev and package no longer rely on stale Node-targeted binaries.
- Scope: Electron ABI rebuild, better-sqlite3 query, node-pty PowerShell session, architecture verification.
- Acceptance: Real Electron probes pass; switching targets invalidates stale output and rebuilds once.
- Verification: Electron probe harness and Node/Electron alternating-target tests.
- Blocked by: S5-F1-T3, S5-F3-T2, S5-F3-T3.
- Blocks: S5-F3-T5, S5-F4-T4, S5-F8-T1.

### S5-F3-T5 - Harden ABI marker, cache, and repair state

- [ ] Completion: marker reflects verified content, not attempted command
- Outcome: Interrupted or partial rebuild cannot poison later development/package runs.
- Scope: ABI key, toolchain/version inputs, architecture, artifact hashes, atomic marker, lock, invalidation, repair.
- Acceptance: Marker writes only after probes; stale/corrupt state is detected; concurrent repair serializes safely.
- Verification: State-machine tests, interrupted rebuild, cache deletion, version/architecture changes.
- Blocked by: S5-F3-T3, S5-F3-T4.
- Blocks: S5-F3-T8, S5-F4-T6, S5-F8-T2.
- Context: `scripts/native-abi-key.mjs`, `scripts/ensure-native-abi.mjs`.

### S5-F3-T6 - Make Claude/Codex binary preparation deterministic

- [ ] Completion: Windows x64 downloads validate, cache, retry, and package correctly
- Outcome: Supported provider binaries are exact-version, architecture-correct, and never accepted from partial/corrupt downloads.
- Scope: URLs/assets, checksum/signature metadata, atomic download, executable naming, cache, offline/error state, staging.
- Acceptance: Clean and cached runs pass; wrong platform/hash/partial file fails safely; package contains expected versions.
- Verification: Download fixture tests, real Windows downloads, package manifest inspection.
- Blocked by: S5-F2-T1, S5-F2-T6, S5-F3-T1.
- Blocks: S5-F6-T1, S5-F6-T2, S5-F8-T3.
- Context: `scripts/download-claude-binary.mjs`, `scripts/download-codex-binary.mjs`.

### S5-F3-T7 - Integrate speech native build preparation

- [ ] Completion: speech sidecars/models have deterministic Windows preparation path
- Outcome: CMake/Rust/MSVC requirements are checked before whisper.cpp/Parakeet/Kokoro work.
- Scope: Native STT sidecar, whisper.cpp build/download, Rust target, model cache, package staging, failure recovery.
- Acceptance: Missing tool gives preflight error; successful build is architecture/version verified; partial state is retryable.
- Verification: Clean/cached/offline/interrupted preparation tests on Windows.
- Blocked by: S5-F1-T3, S5-F3-T1, S5-F2-T6.
- Blocks: S5-F7-T1, S5-F8-T3.

### S5-F3-T8 - Close clean-install and native dependency acceptance

- [ ] Completion: S5-ND matrix rows pass from clean checkout and empty cache
- Outcome: `npm ci --legacy-peer-deps` and all required preparation finish without manual rebuild toggle or patch.
- Scope: Clean/cached/offline retry, Node/Electron probes, provider binaries, speech preparation, uninstall/reinstall dependencies.
- Acceptance: Two consecutive installs are deterministic; failure leaves actionable state; exact versions and artifacts recorded.
- Verification: `S5-ND01` through `S5-ND07`, clean VM transcript, native manifest.
- Blocked by: S5-F1-T4, S5-F1-T6, S5-F1-T7, S5-F2-T9, S5-F3-T2 through T7.
- Blocks: S5-F4-T8, S5-F6-T8, S5-F7-T8, S5-F8-T10, S5-F9-T2.

## S5-F4 - Windows CI and Development Lifecycle

### S5-F4-T1 - Add Windows install, check, test, and build CI lane

- [ ] Completion: required Windows CI job passes from clean hosted runner
- Outcome: Every change gets native proof for install, lint, style, typecheck, tests, and production build.
- Scope: Windows runner, Node 22/npm cache, Python 3.11, CMake/Rust/MSVC setup, timeouts, concurrency, artifacts.
- Acceptance: Job starts clean, runs same root commands as developer docs, and cannot pass after any required gate fails.
- Verification: Successful workflow plus deliberate failure probes for install/check/build.
- Blocked by: S5-F1-T2, S5-F1-T4, S5-F3-T3, S5-F2-T2, S5-F2-T3.
- Blocks: S5-F4-T2, S5-F4-T3, S5-F4-T8, S5-F9-T3.
- Context: `.github/workflows/ci.yml`, `package.json`.

### S5-F4-T2 - Add Windows package preparation and inspection CI lane

- [ ] Completion: CI creates and inspects bounded Windows Preview/package artifact
- Outcome: Packaging regressions, wrong architectures, missing binaries, and native ABI mismatches fail before manual release testing.
- Scope: Resource preparation, unpacked Preview or installer as practical, manifest, architecture, native load probes, upload limits.
- Acceptance: Artifact maps exact SHA/version and contains required Windows resources; inspection failure blocks job.
- Verification: Green package job plus tampered/missing/wrong-architecture fixtures.
- Blocked by: S5-F4-T1, S5-F3-T4, S5-F3-T5, S5-F3-T6, S5-F3-T7.
- Blocks: S5-F4-T8, S5-F8-T3, S5-F9-T3.

### S5-F4-T3 - Publish bounded secret-safe CI evidence

- [ ] Completion: failed/successful Windows jobs retain useful sanitized evidence
- Outcome: CI failures can be diagnosed without dumping environment, credentials, usernames, tokens, or large package trees.
- Scope: Tool versions, step summaries, manifests, probe output, redaction, retention, artifact size, path normalization.
- Acceptance: Evidence identifies exact failure and candidate while secret/path corpus remains redacted.
- Verification: Redaction tests, artifact inspection, failed-workflow review.
- Blocked by: S5-F1-T5, S5-F4-T1, S5-F4-T2.
- Blocks: S5-F4-T8, S5-F9-T1, S5-F9-T5.

### S5-F4-T4 - Make root development command own complete Windows stack

- [ ] Completion: one root command starts renderer, Electron main, helpers, and required development services
- Outcome: Windows users never manually launch frontend/backend/helper pieces or stale packaged executables.
- Scope: `scripts/dev.mjs`, startup order, port/profile/protocol identity, logs, readiness, shutdown.
- Acceptance: One command reaches ready window; child failure stops startup; Ctrl+C closes only owned process tree.
- Verification: Clean start, injected child failure, Ctrl+C, terminal close, and repeated start tests.
- Blocked by: S5-F2-T8, S5-F3-T4.
- Blocks: S5-F4-T5, S5-F4-T6, S5-F4-T7, S5-F5-T6.

### S5-F4-T5 - Extend exact-checkout and profile verification to Windows

- [ ] Completion: `dev:verify` proves active Windows renderer/main/profile ownership
- Outcome: Agent/user cannot mistake packaged, stale, or another checkout instance for current source changes.
- Scope: PID/executable path, checkout root, Dev data profile, renderer origin, protocol, helper/service ownership, package conflict.
- Acceptance: Correct instance passes; stale/packaged/wrong-checkout/wrong-profile cases fail with exact repair command.
- Verification: Fixture tests and live matrix with Dev, Preview, product, and second checkout.
- Blocked by: S5-F4-T4.
- Blocks: S5-F4-T7, S5-F4-T8, S5-F9-T4.
- Context: `scripts/verify-dev-instance.mjs`, shared dev-test control.

### S5-F4-T6 - Add Windows-owned process restart and cleanup

- [ ] Completion: restart/stop commands terminate only recorded Flapstack process trees
- Outcome: Stale Electron/helper/terminal/provider children do not block new run, while unrelated Node/PowerShell/provider sessions survive.
- Scope: PID records, creation identity, descendants, graceful shutdown, timeout, force fallback, locks, ports, scheduled helpers.
- Acceptance: Owned tree fully exits; PID reuse and unrelated matching names are never killed; cleanup is idempotent.
- Verification: Process-tree integration tests with owned/unowned siblings and forced-hang fixtures.
- Blocked by: S5-F2-T4, S5-F2-T8, S5-F3-T5, S5-F4-T4.
- Blocks: S5-F4-T7, S5-F5-T4, S5-F5-T6, S5-F6-T6, S5-F7-T7.

### S5-F4-T7 - Recover stale locks, ports, crashes, sleep, and abrupt shutdown

- [ ] Completion: lifecycle recovery suite returns Windows Dev to one healthy instance
- Outcome: Common interruption cannot require task-manager hunting or machine reboot.
- Scope: Stale lock/PID, occupied port, renderer/main/helper crash, power transition, terminal close, forced process kill.
- Acceptance: Repair distinguishes owned/stale/unrelated state, preserves logs/data, and reaches verified instance.
- Verification: Fault-injection lifecycle suite and live repeated-recovery walkthrough.
- Blocked by: S5-F4-T4, S5-F4-T5, S5-F4-T6.
- Blocks: S5-F4-T8, S5-F5-T8, S5-F9-T4.

### S5-F4-T8 - Close Windows CI and dev lifecycle acceptance

- [ ] Completion: S5-CI and S5-DV matrix rows pass
- Outcome: Windows failures reproduce in CI or through one verified local lifecycle.
- Scope: Clean CI, package inspection, evidence, start/verify/restart/stop, crash/stale recovery, macOS regression.
- Acceptance: Required jobs pass exact SHA; live Dev reaches correct profile; no orphan or unrelated-process kill remains.
- Verification: `S5-CI01` through `S5-CI03`, `S5-DV01` through `S5-DV04`, workflow links, process audit.
- Blocked by: S5-F1-T7, S5-F2-T9, S5-F3-T8, S5-F4-T1 through T7.
- Blocks: S5-F5-T9, S5-F6-T8, S5-F7-T8, S5-F8-T10, S5-F9-T2.

## S5-F5 - Windows OS Integration

### S5-F5-T1 - Replace macOS-only open-path and external launch behavior

- [ ] Completion: files, folders, URLs, and app targets use platform-native guarded adapters
- Outcome: Windows never executes `open -a` or another macOS/POSIX-only command.
- Scope: `src/main/lib/open-external.ts`, open-in UI, Explorer/default app/browser, path validation, errors.
- Acceptance: Existing file/folder and allowed URL open correctly; invalid/unsafe targets fail without shell injection.
- Verification: Unit tests plus live file/folder/URL matrix with special-character paths.
- Blocked by: S5-F2-T5, S5-F2-T7.
- Blocks: S5-F5-T9, S5-F9-T4.

### S5-F5-T2 - Prove Windows terminal profile and PTY behavior

- [ ] Completion: PowerShell/cmd configured profiles pass real node-pty lifecycle
- Outcome: Integrated terminal preserves cwd, environment, UTF-8, resize, links, input/output, exit, cancellation, and restart.
- Scope: Shell discovery, profile selection, PTY env, path links, command history, renderer terminal state.
- Acceptance: Missing preferred shell falls back visibly; no Unix shell default; process tree closes with terminal/run.
- Verification: Unit/integration tests and live PowerShell/cmd walkthrough in simple and Unicode worktrees.
- Blocked by: S5-F3-T3, S5-F4-T6.
- Blocks: S5-F5-T6, S5-F5-T9, S5-F6-T4.
- Context: `src/main/lib/terminal/**`, renderer terminal features.

### S5-F5-T3 - Prove DPAPI credential lifecycle and migration

- [ ] Completion: create/read/update/delete/restart/migration paths pass native Windows
- Outcome: Provider and speech secrets remain encrypted and recoverable without plaintext or POSIX shell fallback.
- Scope: Credential service, Claude storage, migrations, corruption/unavailable account, delete, diagnostics redaction.
- Acceptance: Same user/app reads after restart; other context/corrupt ciphertext fails safely; no secret enters logs/export.
- Verification: Native DPAPI integration tests, migration/rollback, secret scan.
- Blocked by: S5-F4-T4.
- Blocks: S5-F6-T3, S5-F7-T2, S5-F8-T7, S5-F9-T4.
- Context: `src/main/lib/credential-service.ts`, Claude credential storage.

### S5-F5-T4 - Prove Windows scheduled and background task lifecycle

- [ ] Completion: owned task create/run/disable/repair/remove flows pass
- Outcome: Automations and background polling survive restart without stale or invisible scheduled work.
- Scope: Task Scheduler adapter, quoting, user/session context, executable/profile path, history, cancellation, uninstall cleanup.
- Acceptance: Task targets exact installed/Dev identity, exposes status/failure, obeys disable/kill, and never runs after removal.
- Verification: Native task lifecycle integration tests and Task Scheduler inspection.
- Blocked by: S5-F4-T6.
- Blocks: S5-F5-T6, S5-F5-T8, S5-F8-T6, S5-F9-T4.
- Context: automation/usage scheduler and Windows platform adapter.

### S5-F5-T5 - Separate protocols, deep links, identities, and data profiles

- [ ] Completion: Dev, Preview, and product deep links route to correct instance/profile
- Outcome: Windows protocol activation cannot cross profiles, steal focus unexpectedly, or spawn duplicate conflicting windows.
- Scope: Protocol registration, command-line parsing, single-instance lock, pending link queue, validation, uninstall cleanup.
- Acceptance: Cold/warm links reach intended object once; malformed/unsafe link rejected; each channel remains isolated.
- Verification: Native protocol matrix across Dev/Preview/product and reinstall/uninstall.
- Blocked by: S5-F4-T4, S5-F4-T5.
- Blocks: S5-F5-T6, S5-F8-T4, S5-F8-T6, S5-F9-T4.
- Context: Electron main/window manager and package protocol config.

### S5-F5-T6 - Unify owned process and app lifecycle behavior

- [ ] Completion: main, renderer, terminal, agent, speech, and background children share ownership rules
- Outcome: Quit/restart/crash/cancel stops appropriate descendants without broad process-name killing.
- Scope: Ownership registry, shutdown order, timeout/force policy, single-instance behavior, logs, recovery.
- Acceptance: Normal/forced exits leave no owned child; unrelated process survives; repeated lifecycle is stable.
- Verification: Native process-tree tests and Process Explorer/PowerShell inspection.
- Blocked by: S5-F2-T8, S5-F4-T4, S5-F4-T6, S5-F5-T2, S5-F5-T4, S5-F5-T5.
- Blocks: S5-F5-T8, S5-F6-T6, S5-F7-T7, S5-F8-T6.

### S5-F5-T7 - Normalize Windows data, cache, temp, export, and worktree paths

- [ ] Completion: all owned filesystem roots use Windows platform APIs and safety checks
- Outcome: App works under standard user with spaces, Unicode, long paths, locked files, and multiple drives.
- Scope: userData, logs, cache, downloads, models, temp, attachments, exports, repo/worktrees, diagnostics.
- Acceptance: No hard-coded POSIX path; traversal/UNC/device/drive boundary policy explicit; cleanup touches only owned paths.
- Verification: Path-safety suite and live matrix across path variants and permissions.
- Blocked by: S5-F1-T6.
- Blocks: S5-F5-T8, S5-F6-T4, S5-F7-T6, S5-F8-T4, S5-F8-T6.
- Context: shared checkout/path safety, project paths, portability IO.

### S5-F5-T8 - Handle Windows power, network, UAC, firewall, antivirus, and file locks

- [ ] Completion: environmental interruption suite produces safe recovery or actionable limit
- Outcome: Common Windows host behavior cannot silently lose state or leave app permanently wedged.
- Scope: Sleep/wake, lock/unlock, offline/online, denied elevation, firewall prompt/block, quarantined file, locked executable/database.
- Acceptance: State persists; retries are bounded; user sees exact remediation; security protections are never bypassed.
- Verification: Clean VM fault matrix and recovery logs.
- Blocked by: S5-F4-T7, S5-F5-T4, S5-F5-T6, S5-F5-T7.
- Blocks: S5-F5-T9, S5-F8-T6, S5-F9-T6.

### S5-F5-T9 - Close Windows OS integration acceptance

- [ ] Completion: S5-WI matrix rows pass in Dev and package
- Outcome: Windows platform services meet one documented runtime contract.
- Scope: Open actions, terminal, credentials, tasks, protocols, paths, process ownership, power/network/security interruptions.
- Acceptance: Required flows pass standard user and expected elevation paths; unsupported behavior is visible and documented.
- Verification: `S5-WI01` through `S5-WI08`, process/path/secret audits, exact-SHA walkthrough.
- Blocked by: S5-F4-T8, S5-F5-T1 through T8.
- Blocks: S5-F6-T8, S5-F7-T8, S5-F8-T10, S5-F9-T2.

## S5-F6 - Agent Harness Parity

### S5-F6-T1 - Prove Claude binary discovery and launch

- [ ] Completion: bundled/downloaded Claude Windows binary resolves and launches in Dev/package
- Outcome: Claude does not depend on macOS/Linux executable names, permissions, paths, or shell lookup.
- Scope: Version selection, discovery precedence, architecture, environment, stdio, working directory, diagnostics.
- Acceptance: Exact binary/version shown; missing/corrupt/wrong-arch state gives repair; no global binary shadows pinned choice silently.
- Verification: Discovery fixtures, real status probe, Dev/package launch.
- Blocked by: S5-F2-T5, S5-F3-T6.
- Blocks: S5-F6-T3, S5-F6-T4, S5-F6-T7.

### S5-F6-T2 - Prove Codex binary discovery and launch

- [ ] Completion: bundled/downloaded Codex Windows binary resolves and launches in Dev/package
- Outcome: Codex uses pinned architecture-correct executable with actionable fallback behavior.
- Scope: Version/discovery, ACP/app-server invocation, environment, stdio, working directory, diagnostics.
- Acceptance: Exact binary/version shown; corrupt/missing/wrong-arch state blocks safely; arguments survive Windows quoting.
- Verification: Discovery fixtures, real status/model probe, Dev/package launch.
- Blocked by: S5-F2-T5, S5-F3-T6.
- Blocks: S5-F6-T3, S5-F6-T4, S5-F6-T7.

### S5-F6-T3 - Close Claude and Codex login/status/credential flows

- [ ] Completion: interactive/noninteractive auth status and repair work on Windows
- Outcome: Users can authenticate, see truthful status, restart, revoke, and recover without secret exposure.
- Scope: Local provider auth, app credential references, DPAPI, modal/status UI, offline/expired/revoked cases, logs.
- Acceptance: Login completes in expected terminal/browser path; status survives restart; logout/revoke removes owned secret state.
- Verification: Credentialed native provider matrix and secret-safe log review.
- Blocked by: S5-F5-T3, S5-F6-T1, S5-F6-T2.
- Blocks: S5-F6-T4, S5-F6-T7, S5-F9-T4.

### S5-F6-T4 - Prove global/project/task chat and session resume

- [ ] Completion: both providers run and resume across all supported chat scopes
- Outcome: Windows paths/worktrees and provider session IDs preserve one-chat/one-agent identity.
- Scope: New run, follow-up, restart/resume, cwd/worktree, spaces/Unicode paths, persistence, unsupported resume state.
- Acceptance: Correct scope/context/session resumes once; provider failure does not corrupt chat/run history.
- Verification: Credentialed Dev matrix for Claude/Codex and all scopes, including restart.
- Blocked by: S5-F5-T2, S5-F5-T7, S5-F6-T1, S5-F6-T2, S5-F6-T3.
- Blocks: S5-F6-T5, S5-F6-T6, S5-F6-T7.

### S5-F6-T5 - Prove permissions, approvals, tools, worktrees, and checkpoints

- [ ] Completion: provider controls enforce same Windows authority contract
- Outcome: Command/path previews, allow/deny decisions, worktree limits, MCP/tools, checkpoints, and file manifests are truthful.
- Scope: Permission modes, approval UI, Windows command/path normalization, shell tools, file edits, rollback, audit.
- Acceptance: Denied action cannot execute; approved action matches preview; changes stay in allowed checkout/worktree and appear in manifests.
- Verification: Credentialed allow/deny/property tests and real tool-using workflows.
- Blocked by: S5-F6-T4.
- Blocks: S5-F6-T7, S5-F9-T4, S5-F9-T6.

### S5-F6-T6 - Prove streaming, cancellation, retry, and provider process cleanup

- [ ] Completion: event and lifecycle matrix passes without orphan provider children
- Outcome: Text, reasoning, tool events, usage, failure, cancellation, retry, and app shutdown remain coherent.
- Scope: Event normalization, Ctrl+C/cancel, timeout, provider child tree, retry/resume policy, terminal close, restart.
- Acceptance: No duplicate/replayed result; cancellation reaches provider; owned processes stop; history records terminal state accurately.
- Verification: Fault-injection tests and credentialed cancel/retry/restart workflows.
- Blocked by: S5-F2-T8, S5-F4-T6, S5-F5-T6, S5-F6-T4.
- Blocks: S5-F6-T7, S5-F9-T4.

### S5-F6-T7 - Repeat provider parity in packaged Windows app

- [ ] Completion: Claude/Codex core flows pass Preview and installed candidate
- Outcome: Development-only PATH/config behavior cannot masquerade as packaged support.
- Scope: Bundled binaries, auth/status, run/resume, permissions, tools, cancellation, logs, upgrade persistence.
- Acceptance: Packaged flows match verified Dev or expose documented package-specific limitation; no dependency on repo files.
- Verification: Preview and NSIS provider walkthrough with exact artifact hashes.
- Blocked by: S5-F6-T1 through T6, S5-F8-T4.
- Blocks: S5-F6-T8, S5-F8-T10, S5-F9-T4.

### S5-F6-T8 - Close agent harness acceptance

- [ ] Completion: S5-AH matrix rows pass for Claude and Codex
- Outcome: Windows is a supported provider execution host, not package-only shell.
- Scope: Downloads, discovery, auth, chats, resume, permissions, worktrees, events, cancellation, restart, package.
- Acceptance: Required credentialed matrix passes exact SHA/artifact; limitations are provider-specific and user-visible.
- Verification: `S5-AH01` through `S5-AH07`, logs/audit/history review, process/secret scan.
- Blocked by: S5-F3-T8, S5-F4-T8, S5-F5-T9, S5-F6-T3 through T7.
- Blocks: S5-F8-T10, S5-F9-T2.

## S5-F7 - Speech and Voice Parity

### S5-F7-T1 - Build and verify Windows speech prerequisites

- [ ] Completion: STT/TTS native prerequisites prepare from documented Windows command
- Outcome: CMake, Rust/MSVC, Windows SDK, sidecars, and model requirements are explicit before voice launch.
- Scope: Native STT sidecar, whisper.cpp, Parakeet, Kokoro/system TTS dependencies, x64 architecture, package staging.
- Acceptance: Clean preparation passes or stops at preflight with exact missing component; artifacts report version/architecture/hash.
- Verification: Clean/cached/offline preparation tests and real sidecar version probes.
- Blocked by: S5-F1-T3, S5-F3-T7.
- Blocks: S5-F7-T3 through T8.
- Context: `native/stt-sidecar/**`, speech build/download scripts.

### S5-F7-T2 - Remove POSIX speech credential fallback

- [ ] Completion: speech credentials use platform-aware secure service only
- Outcome: Windows voice path never invokes `/bin/zsh` or reads plaintext shell configuration.
- Scope: Cloud STT/TTS keys, provider credential migration, DPAPI, missing/denied/corrupt credential, diagnostics.
- Acceptance: Secure lookup survives restart; missing credential offers repair; no secret or shell command appears in logs.
- Verification: Credential integration/migration tests, static `/bin/zsh` audit, secret scan.
- Blocked by: S5-F2-T7, S5-F5-T3.
- Blocks: S5-F7-T5, S5-F7-T8.

### S5-F7-T3 - Prove Windows microphone capture and dictation ownership

- [ ] Completion: microphone permission, selection, recording, cancellation, and device loss pass
- Outcome: Voice input captures only during visible owned session and releases device on stop/crash.
- Scope: Device enumeration, default/device change, denied permission, audio format, hotkey, concurrent request ownership, temp data.
- Acceptance: No hidden recording; UI shows active owner/state; denied/missing/lost device recovers without wedging next session.
- Verification: Renderer/main tests plus real microphone walkthrough and forced device removal.
- Blocked by: S5-F7-T1, S5-F5-T6.
- Blocks: S5-F7-T4, S5-F7-T5, S5-F7-T7.

### S5-F7-T4 - Prove local/offline Windows transcription

- [ ] Completion: supported local engine transcribes, cancels, restarts, and reports progress
- Outcome: Offline dictation remains available without cloud key on Windows.
- Scope: Parakeet/whisper.cpp engine selection, sidecar launch, model path, streaming/file input, progress, cancel, restart, language.
- Acceptance: Known audio meets baseline accuracy/latency; wrong/missing model repairs; cancellation stops owned sidecar.
- Verification: Fixture audio suite, offline live dictation, process/model inspection.
- Blocked by: S5-F7-T1, S5-F7-T3, S5-F5-T7.
- Blocks: S5-F7-T5, S5-F7-T7, S5-F7-T8.

### S5-F7-T5 - Prove configured cloud transcription fallback

- [ ] Completion: cloud fallback activates only by policy and shows provenance
- Outcome: Local failure or explicit selection can use configured cloud service without silent audio upload.
- Scope: Credential, consent/policy, provider request, timeout/retry, offline/error, result provenance, cancellation.
- Acceptance: No cloud call without configured authority; result identifies engine; secret/audio not retained beyond policy.
- Verification: Mock contract tests plus authorized live success/failure/cancel matrix.
- Blocked by: S5-F7-T2, S5-F7-T3, S5-F7-T4.
- Blocks: S5-F7-T8.

### S5-F7-T6 - Prove Windows system and offline TTS playback

- [ ] Completion: system TTS and Kokoro paths speak, stop, replay, switch device, and recover
- Outcome: Read-aloud works without macOS/Linux command assumptions and offers offline default.
- Scope: Voice discovery, output device, queue/ownership, stop/interrupt, cached audio, offline engine, missing device/model.
- Acceptance: Only current owner plays; stop is prompt; fallback is visible; temp audio and child processes clean.
- Verification: Playback unit tests and live speaker/headphone/device-change walkthrough.
- Blocked by: S5-F7-T1, S5-F5-T7.
- Blocks: S5-F7-T7, S5-F7-T8.

### S5-F7-T7 - Harden voice model, temp-file, process, and restart lifecycle

- [ ] Completion: interrupted downloads and voice crashes recover without orphan or leaked artifact
- Outcome: Large models, recordings, generated audio, and sidecars stay bounded, verified, private, and removable.
- Scope: Atomic model cache, hash/version, disk-space error, partial download, temp permissions, retention, shutdown, app upgrade/uninstall.
- Acceptance: Partial files never appear valid; owned temp/process state cleans; history retains only declared metadata/content.
- Verification: Fault-injection model/temp/process tests and restart/uninstall inspection.
- Blocked by: S5-F4-T6, S5-F5-T6, S5-F7-T3, S5-F7-T4, S5-F7-T6.
- Blocks: S5-F7-T8, S5-F8-T3, S5-F8-T6.

### S5-F7-T8 - Close Windows speech and voice acceptance

- [ ] Completion: S5-VO matrix rows pass in Dev and package
- Outcome: Windows STT/TTS support is native, private by policy, recoverable, and documented.
- Scope: Prerequisites, credentials, capture, local/cloud STT, system/offline TTS, models, temp state, package, accessibility.
- Acceptance: Required offline flows pass; authorized cloud flows pass; all device/credential/model limits are visible.
- Verification: `S5-VO01` through `S5-VO07`, exact-SHA audio walkthrough, process/file/secret audit.
- Blocked by: S5-F3-T8, S5-F4-T8, S5-F5-T9, S5-F7-T1 through T7.
- Blocks: S5-F8-T10, S5-F9-T2.

## S5-F8 - Windows Packaging and Security

### S5-F8-T1 - Add explicit Windows Preview and release package entrypoints

- [ ] Completion: root commands own Windows unpacked Preview, NSIS, and portable builds
- Outcome: Package target, architecture, channel, app identity, output, and resources derive from one resolved plan.
- Scope: `package:preview:win`, inspect/smoke commands, `package:win`, channel/app IDs, x64 target, clean outputs.
- Acceptance: Command rejects conflicting target/config; logs exact plan; no manual electron-builder invocation required.
- Verification: Plan-resolution tests and native Windows dry-run/build.
- Blocked by: S5-F2-T2, S5-F2-T4, S5-F2-T5, S5-F2-T6, S5-F3-T4.
- Blocks: S5-F8-T2 through T5.
- Context: `scripts/package-app.mjs`, electron-builder config, `package.json`.

### S5-F8-T2 - Make package staging atomic and ABI-aware

- [ ] Completion: fresh allowlisted staging tree is built only after Electron ABI verification
- Outcome: Package cannot reuse stale binaries/resources or leak development/local artifacts.
- Scope: ABI invalidation/repair, resource allowlist, atomic replace, output cleanup, concurrent package lock, failure recovery.
- Acceptance: Staging starts clean; wrong ABI or unexpected file fails; interrupted package leaves prior valid artifact distinguishable.
- Verification: Staging manifest tests, interrupted build, unexpected-file and stale-ABI fixtures.
- Blocked by: S5-F3-T5, S5-F8-T1.
- Blocks: S5-F8-T3, S5-F8-T4, S5-F8-T5.
- Context: `scripts/prepare-package-resources.mjs`, package staging logic.

### S5-F8-T3 - Extend packaged binary and resource inspection for Windows

- [ ] Completion: inspector validates every required Windows executable, DLL, native module, and sidecar
- Outcome: Wrong/missing architecture, version, resource, license, or unexpected binary blocks candidate.
- Scope: PE architecture, better-sqlite3, node-pty, Claude/Codex, STT/TTS sidecars, ASAR/resources, manifest, executable load/smoke.
- Acceptance: Expected allowlist and versions match; tampered/wrong-arch/missing/extra fixtures fail with exact path/reason.
- Verification: Inspector unit tests and real Preview/NSIS/portable inspection.
- Blocked by: S5-F3-T6, S5-F3-T7, S5-F4-T2, S5-F7-T7, S5-F8-T2.
- Blocks: S5-F8-T4, S5-F8-T5, S5-F8-T8.
- Context: `scripts/inspect-packaged-binaries.mjs`, `scripts/lib/packaged-binary.mjs`.

### S5-F8-T4 - Prove Windows Preview package runtime

- [ ] Completion: unpacked Preview launches and passes core package smoke
- Outcome: Packaged resource/layout/profile behavior is tested before installer lifecycle.
- Scope: Preview identity/userData/protocol, native module loads, window, terminal, credentials, agents, voice, logs, shutdown.
- Acceptance: Preview stays isolated from Dev/product, uses no repo runtime files, and leaves no owned process after quit.
- Verification: Automated smoke plus native manual core-flow walkthrough.
- Blocked by: S5-F5-T5, S5-F5-T7, S5-F8-T1, S5-F8-T2, S5-F8-T3.
- Blocks: S5-F6-T7, S5-F8-T5, S5-F8-T6, S5-F8-T10.

### S5-F8-T5 - Build deterministic NSIS installer and portable package

- [ ] Completion: x64 installer and portable artifacts map exact SHA/version
- Outcome: Declared Windows artifacts build natively with stable names, metadata, icons, protocols, and resources.
- Scope: NSIS install mode, portable target, version/file metadata, shortcuts, protocol registration, output hashes, reproducibility metadata.
- Acceptance: Repeated equivalent build has explainable manifest; artifact names/metadata/architectures match plan.
- Verification: Native builds, PE/resource inspection, manifest/hash comparison.
- Blocked by: S5-F8-T1, S5-F8-T2, S5-F8-T3, S5-F8-T4.
- Blocks: S5-F8-T6, S5-F8-T7, S5-F8-T8.

### S5-F8-T6 - Prove install, upgrade, repair, rollback, and uninstall

- [ ] Completion: clean and Stage 4 upgrade VM lifecycle matrices pass
- Outcome: Installer preserves user data when required and removes only owned state on uninstall.
- Scope: Standard/admin install, first launch, upgrade, schema/data backup, repair/reinstall, supported rollback, keep/remove-data uninstall, tasks/protocols/process cleanup.
- Acceptance: No data loss/profile crossover/orphan; rollback procedure restores usable backup; uninstall choices match docs.
- Verification: Snapshot-based clean/upgrade VM walkthrough and filesystem/registry/task/process diff.
- Blocked by: S5-F5-T4 through T8, S5-F7-T7, S5-F8-T4, S5-F8-T5.
- Blocks: S5-F8-T9, S5-F8-T10, S5-F9-T5, S5-F9-T6.

### S5-F8-T7 - Implement Authenticode-ready signing and verification

- [ ] Completion: signing path uses external credentials and verifies chain/timestamp
- Outcome: Production Windows artifacts can be signed without credentials entering repo, package logs, or persisted workspace state.
- Scope: Certificate source contract, nested executables, signing order, timestamp service, verify command, missing/expired/revoked credential, rotation/recovery.
- Acceptance: Authorized signed fixture/candidate validates every required executable; absent credential yields explicit unsigned Preview and blocks signed claim.
- Verification: Signature inspection, invalid/expired/tampered fixtures, secret scan, sanitized CI dry run.
- Blocked by: S5-F5-T3, S5-F8-T5.
- Blocks: S5-F8-T8, S5-F8-T9, S5-F8-T10.

### S5-F8-T8 - Add artifact integrity, dependency, license, malware, and secret gates

- [ ] Completion: candidate security report covers every distributed file
- Outcome: Artifact is attributable, architecture-correct, licensed, secret-free, and scanned before support claim.
- Scope: SHA256, file manifest, source SHA/version, dependency/license inventory, unexpected binaries, malware scan result, signature state, provenance.
- Acceptance: Mismatch, secret, unexplained executable, missing license, or unresolved severe finding blocks candidate.
- Verification: Automated package report, tampered/secret fixture tests, independent review.
- Blocked by: S5-F8-T3, S5-F8-T5, S5-F8-T7.
- Blocks: S5-F8-T9, S5-F8-T10, S5-F9-T5.

### S5-F8-T9 - Write Windows install, support, diagnostics, recovery, and signing docs

- [ ] Completion: operator/user docs match observed candidate lifecycle
- Outcome: Users can verify, install, grant permissions, diagnose, back up, recover, upgrade, and uninstall without unsafe bypasses.
- Scope: Prerequisites, artifact/hash/signature verification, UAC/antivirus/firewall, data/log paths, support bundle, backup/rollback, uninstall, known limits.
- Acceptance: Fresh user follows commands/paths; docs never advise disabling security or exposing secrets; support bundle is redacted.
- Verification: Clean-user doc walkthrough, link/command/path review, secret scan.
- Blocked by: S5-F8-T6, S5-F8-T7, S5-F8-T8.
- Blocks: S5-F8-T10, S5-F9-T7.

### S5-F8-T10 - Close Windows packaging and security acceptance

- [ ] Completion: S5-PK matrix rows pass on exact artifacts
- Outcome: Preview, NSIS, and portable Windows artifacts have truthful lifecycle and security evidence.
- Scope: Build, staging, inspection, Preview, installer/portable, lifecycle, signing policy, integrity, docs.
- Acceptance: All required rows pass; production signature claim exists only with valid credentialed evidence; no P0/P1 package/security defect remains.
- Verification: `S5-PK01` through `S5-PK09`, exact hashes/manifests, VM snapshots, independent package/security review.
- Blocked by: S5-F2-T9, S5-F3-T8, S5-F4-T8, S5-F5-T9, S5-F6-T7, S5-F7-T8, S5-F8-T1 through T9.
- Blocks: S5-F9-T2.

## S5-F9 - Integrated Windows Release

### S5-F9-T1 - Freeze candidate and evidence ledger

- [ ] Completion: one immutable candidate SHA and artifact set owns Stage 5 exit
- Outcome: Task, matrix, command, VM, credential class, package hash, and defect evidence cannot drift across builds.
- Scope: Source SHA/branch, clean checkout, CI runs, artifact manifest, Windows builds/VM snapshots, account classes, timestamps, redacted evidence links.
- Acceptance: Every checked item resolves to candidate; later source/artifact change invalidates affected evidence explicitly.
- Verification: Ledger consistency/link/hash check and independent review.
- Blocked by: S5-F1-T1, S5-F4-T3.
- Blocks: S5-F9-T2 through T9.

### S5-F9-T2 - Reconcile every task, spec, router, and matrix row

- [ ] Completion: Stage 5 crosswalk has no missing, duplicate, stale, or contradictory authority
- Outcome: 76 task IDs, feature routers, capability spec, execution waves, matrix rows, and manual test agree.
- Scope: S5-F1 through F9, dependencies, counts, links, completion status, Stage 4 entry and Stage 6 exit boundary.
- Acceptance: Strict OpenSpec passes; link/ID/task-count checks pass; status lives only in task board/matrix.
- Verification: Automated crosswalk/link scan and reviewer trace from each feature to evidence.
- Blocked by: S5-F1-T7, S5-F2-T9, S5-F3-T8, S5-F4-T8, S5-F5-T9, S5-F6-T8, S5-F7-T8, S5-F8-T10, S5-F9-T1.
- Blocks: S5-F9-T3 through T9.

### S5-F9-T3 - Run full automated Windows candidate gate

- [ ] Completion: required Windows CI and clean local equivalents pass candidate
- Outcome: Style, lint, typecheck, tests, build, OpenSpec, native probes, package, inspection, and smoke share one SHA.
- Scope: `npm run check`, strict OpenSpec, Windows CI, native ABI probes, package commands, artifact/security reports.
- Acceptance: No rerun from changed source; flaky or skipped required test remains blocker; outputs retained in ledger.
- Verification: Command/workflow links, SHA/hash match, failure/skip audit.
- Blocked by: S5-F4-T1, S5-F4-T2, S5-F9-T1, S5-F9-T2.
- Blocks: S5-F9-T4 through T9.

### S5-F9-T4 - Run integrated verified-Dev Windows workflow

- [ ] Completion: one native Dev session exercises all required runtime features
- Outcome: Tooling, lifecycle, OS integration, both harnesses, credentials, voice, protocols, worktrees, restart, and recovery compose correctly.
- Scope: Clean project/task/chat, terminal, Claude/Codex, permissions, attachments, checkpoint, scheduled work, dictation/TTS, deep link, restart.
- Acceptance: `dev:verify` proves candidate checkout/profile; state/audit/history match visible actions; no orphan or secret leak.
- Verification: `docs/stage5-windows-manual-test.md` development section plus logs/process/filesystem review.
- Blocked by: S5-F4-T5, S5-F4-T7, S5-F5-T1, S5-F5-T3, S5-F5-T4, S5-F5-T5, S5-F6-T3 through T7, S5-F9-T3.
- Blocks: S5-F9-T5, S5-F9-T6, S5-F9-T9.

### S5-F9-T5 - Run clean installed-candidate Windows workflow

- [ ] Completion: standard user completes packaged walkthrough from fresh VM
- Outcome: Installer, product identity, runtime features, support docs, and security prompts work outside repository.
- Scope: Artifact/hash/signature check, install, first launch, terminal, harnesses, credentials, voice, protocol, scheduler, restart, diagnostics.
- Acceptance: No repo dependency/manual patch/unsafe security bypass; package matches ledger and support claims.
- Verification: Clean VM snapshot walkthrough, support-bundle review, artifact/process/filesystem inspection.
- Blocked by: S5-F1-T5, S5-F8-T6, S5-F8-T8, S5-F9-T3, S5-F9-T4.
- Blocks: S5-F9-T6, S5-F9-T7, S5-F9-T9.

### S5-F9-T6 - Run upgrade, rollback, interruption, and uninstall acceptance

- [ ] Completion: existing Stage 4 profile and failure-path VM matrices pass
- Outcome: Windows support does not trade compatibility for data loss, stuck integrations, or irreversible package state.
- Scope: Upgrade, backup, migrations, repair, rollback, keep/remove-data uninstall, power/network/UAC/antivirus/file-lock failures.
- Acceptance: Supported state survives or restores; owned tasks/protocols/processes clean; unrelated data remains untouched.
- Verification: VM snapshots, database/config diff, registry/task/process/file audit.
- Blocked by: S5-F5-T8, S5-F6-T5, S5-F8-T6, S5-F9-T4, S5-F9-T5.
- Blocks: S5-F9-T7, S5-F9-T9.

### S5-F9-T7 - Complete user manual acceptance and documentation review

- [ ] Completion: user executes manual test and accepts Windows support result
- Outcome: Human-visible setup, UX, prompts, errors, docs, and recovery match automated evidence.
- Scope: `docs/stage5-windows-manual-test.md`, README, Windows setup/install/support/recovery docs, known limits, feedback/fix rounds.
- Acceptance: User reports pass; every issue is fixed/retested or recorded as explicit blocker/approved limitation.
- Verification: Signed-off walkthrough ledger and link/command/path review.
- Blocked by: S5-F8-T9, S5-F9-T5, S5-F9-T6.
- Blocks: S5-F9-T9.

### S5-F9-T8 - Prove shared-platform regression and Stage 6 handoff

- [ ] Completion: macOS shared gates pass and Stage 6 consumes accepted Stage 5 baseline
- Outcome: Windows portability changes do not silently regress current macOS product; renumbered roadmap has one dependency chain.
- Scope: macOS install/check/build/package smoke as available; Stage 6 router/execution/matrix/change IDs/links; Windows evidence reuse boundary.
- Acceptance: Shared tests pass; Stage 6 starts after Stage 5; no active non-archive S5 product-polish ID remains.
- Verification: macOS CI/local evidence, roadmap link/ID scan, Stage 6 review.
- Blocked by: S5-F9-T2, S5-F9-T3.
- Blocks: S5-F9-T9 and Stage 6 entry.

### S5-F9-T9 - Record exact-SHA Stage 5 release decision

- [ ] Completion: integrated matrix closes with explicit go/no-go and blockers
- Outcome: Windows compatibility claim is tied to one reviewed candidate and can be reproduced or withdrawn.
- Scope: All S5 matrix rows, defects, security/privacy/data review, package hashes/signatures, user acceptance, known limits, support statement.
- Acceptance: No P0/P1, required skipped row, false support claim, data-loss path, secret leak, or orphan process remains; Stage 6 gate updated.
- Verification: Independent final ledger review and `docs/stage5-full-feature-test-matrix.md` completion.
- Blocked by: S5-F9-T1 through T8.
- Blocks: Stage 6 implementation start.
