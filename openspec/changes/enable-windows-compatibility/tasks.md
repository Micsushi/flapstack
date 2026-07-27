# Stage 5 - Native Windows Compatibility

Task state lives only here. Every completion requires linked implementation,
automated evidence, native Windows observation where specified, and matching
matrix rows in `docs/stage5-full-feature-test-matrix.md`.
These checkboxes use Tier 2 from `docs/completion-tiers.md`. Tier 3 owner status
lives only in `docs/owner-manual-testing-backlog.md`.
Every task below names its evidence class. For a mixed task, the checkbox closes
on acceptance of its `T2-core` scope; separate capability/release sub-bullets
retain independent matrix status. For a pure capability or release task, the
checkbox records only the named certification and is excluded from
implementation completion.
The board contains 76 work records: 37 core-only, 13 mixed tasks whose checkbox
closes on the core portion, 14 capability-only, one capability-plus-release, 10
release-only, and one tracking-only. Therefore 50 task checkboxes gate
implementation. Pure capability/release tasks are excluded from that count.

## S5-F1 - Supported Windows Toolchain

### S5-F1-T1 - Freeze Windows support and evidence matrix

- Evidence class: `T2-core`.
- [x] Completion: support matrix and evidence template approved
- Outcome: Required Windows edition/architecture, shell, artifact, VM, account, credential, audio, and upgrade profiles are explicit.
- Scope: Windows 11 x64; PowerShell 7/5.1; clean and upgrade VMs; standard/admin users; Preview/NSIS/portable; native-only evidence.
- Acceptance: Every support claim has owner, host, command/walkthrough, evidence field, and stop/go rule; unclaimed targets remain explicit.
- Verification: Matrix review against package config, CI, runtime adapters, and Stage 5 docs.
- Blocks: S5-F1-T2 through T7 and S5-F9-T1.
- Context: `package.json`, electron-builder configuration, `docs/stage5-full-feature-test-matrix.md`.

### S5-F1-T2 - Pin Node, npm, and Python acceptance versions

- Evidence class: `T2-core`.
- [x] Completion: version files and package engines enforce accepted versions
- Outcome: Clean setup consistently uses Node 22, repository npm, and Python 3.11 instead of machine defaults such as Node 25/Python 3.13.
- Scope: `package.json` engines/packageManager; Node/Python version files; CI inputs; bootstrap and diagnostics.
- Acceptance: Supported versions pass; unsupported major versions fail before native work with exact repair guidance.
- Verification: Version-contract tests plus supported/unsupported clean-shell probes.
- Blocked by: S5-F1-T1.
- Blocks: S5-F1-T3, S5-F1-T4, S5-F3-T1, S5-F4-T1.

### S5-F1-T3 - Detect CMake, Rust, MSVC, Build Tools, and Windows SDK

- Evidence class: `T2-core`.
- [x] Completion: prerequisite diagnostic covers full native toolchain
- Outcome: Missing CMake/Rust/MSVC/SDK cannot surface later as opaque npm or speech build failure.
- Scope: `cmake`, `cargo`, `rustc`, MSVC compiler/linker, VS 2022 Build Tools Desktop C++ workload, x64/x86 Spectre-mitigated libraries required by `node-pty`, Windows SDK, architecture.
- Acceptance: Diagnostic reports detected path/version/architecture, flags unsupported combinations, and gives official install component names without mutating machine state.
- Verification: Fixture tests plus clean VM probes with each dependency absent/present.
- Blocked by: S5-F1-T1, S5-F1-T2.
- Blocks: S5-F1-T4, S5-F3-T3, S5-F3-T4, S5-F7-T1.

### S5-F1-T4 - Add one Windows prerequisite and bootstrap command

- Evidence class: `T2-core`.
- [ ] Completion: root bootstrap entrypoint and Windows setup guide reproduce clean setup
- Outcome: Developer gets deterministic preflight, install order, binary preparation, and next commands from one documented entrypoint.
- Scope: Read-only preflight by default; explicit optional setup helpers; install, binary downloads, ABI preparation; reboot/shell refresh guidance.
- Acceptance: Fresh user follows guide without manual source patch, WSL, Git Bash, or hidden global environment edits.
- Verification: Clean Windows VM walkthrough from clone through `npm run check` readiness.
- Blocked by: S5-F1-T2, S5-F1-T3.
- Blocks: S5-F1-T6, S5-F3-T8, S5-F4-T1.

### S5-F1-T5 - Normalize environment discovery and sanitized diagnostics

- Evidence class: `T2-core`.
- [ ] Completion: one platform-aware environment report exists
- Outcome: Tool resolution failures can be diagnosed without exposing credentials, usernames, private paths, or full environment dumps.
- Scope: PATH segments, executable resolution, architecture, shell, repo root, temp/cache/output availability, redaction rules.
- Acceptance: Report explains conflicting/missing tools and path precedence; secret-like values and user-specific path prefixes are redacted.
- Verification: Snapshot/redaction tests and diagnostics review on clean/user-customized hosts.
- Blocked by: S5-F1-T1, S5-F1-T3.
- Blocks: S5-F2-T1, S5-F4-T3, S5-F9-T5.

### S5-F1-T6 - Prove spaces, Unicode, long paths, and restricted directories

- Evidence class: `T2-core`.
- [ ] Completion: path-variant toolchain suite passes
- Outcome: Supported setup does not assume simple ASCII paths or writable global directories.
- Scope: Repo/userData/temp/cache paths; spaces, Unicode, long paths; standard user; read-only/global-write denial.
- Acceptance: Bootstrap and preflight either pass or give safe actionable limitation without corrupting state.
- Verification: Parameterized Windows path suite and clean VM walkthrough.
- Blocked by: S5-F1-T4, S5-F1-T5.
- Blocks: S5-F2-T5, S5-F3-T8, S5-F5-T7.

### S5-F1-T7 - Close toolchain acceptance and operator docs

- Evidence class: `T2-core`.
- [ ] Completion: S5-TC matrix rows pass and docs match observed setup
- Outcome: Supported Windows developer environment is reproducible and maintainable.
- Scope: Prerequisite table, install order, verification commands, common failures, repair, upgrades, evidence links.
- Acceptance: Independent user provisions clean host and reaches green preflight using docs only.
- Verification: `S5-TC01` through `S5-TC05`, link/command review, secret scan.
- Blocked by: S5-F1-T2 through T6.
- Blocks: S5-F3-T8, S5-F4-T8, S5-F9-T2.

## S5-F2 - Portable Build Scripts

### S5-F2-T1 - Create cross-platform executable resolver and process runner

- Evidence class: `T2-core`.
- [ ] Completion: shared runner has unit tests and replaces ad hoc critical spawns
- Outcome: Node, npm/npx, Python, CMake, Cargo, and helper binaries resolve correctly on Windows `.cmd`/`.exe` and POSIX hosts.
- Scope: Argument arrays, `shell: false` default, Windows shim discovery, cwd/env, stdio, exit/signal propagation, redacted diagnostics.
- Acceptance: No command-string interpolation; spaces/Unicode/special characters survive unchanged; missing executable gives actionable error.
- Verification: Unit/integration matrix on Windows and macOS.
- Blocked by: S5-F1-T5.
- Blocks: S5-F2-T2 through T8, S5-F3-T2, S5-F3-T6.
- Context: `scripts/*.mjs`, `child_process` call sites, npm shims.

### S5-F2-T2 - Replace POSIX build environment assignment

- Evidence class: `T2-core`.
- [x] Completion: production build sets environment variables platform-neutrally
- Outcome: `npm run build` no longer depends on `NODE_OPTIONS=... command` syntax.
- Scope: Build entrypoint, environment allowlist, inherited values, memory option, Windows/macOS behavior.
- Acceptance: Build gets intended options on Windows and macOS; user-supplied unrelated environment remains intact.
- Verification: Environment-capture tests and full production builds on both OS families.
- Blocked by: S5-F2-T1.
- Blocks: S5-F2-T9, S5-F4-T1, S5-F8-T1.
- Context: `package.json`, build wrapper scripts.

### S5-F2-T3 - Replace `sh -c` in full check gate

- Evidence class: `T2-core`.
- [x] Completion: `npm run check` uses platform-neutral ordered orchestration
- Outcome: Lint, style, typecheck, tests, and build run fail-fast without `sh`.
- Scope: Step ordering, exit code, signal forwarding, readable step boundaries, CI parity.
- Acceptance: First failed step stops later steps; success runs all steps; Windows/macOS outputs identify failing gate.
- Verification: Injected failure tests at each step plus native full check.
- Blocked by: S5-F2-T1, S5-F2-T2.
- Blocks: S5-F2-T9, S5-F4-T1, S5-F9-T3.
- Context: `package.json`, `scripts/with-heavy-job-lock.mjs`.

### S5-F2-T4 - Make heavy-job and UI locks Windows-safe

- Evidence class: `T2-core`.
- [ ] Completion: lock acquisition, contention, stale recovery, and cleanup pass on Windows
- Outcome: Lint/style/check/build/package serialization launches npm shims reliably and never deadlocks after crash.
- Scope: Atomic lock files, PID ownership, process liveness, timeout, Ctrl+C, stale lock, path normalization.
- Acceptance: Concurrent jobs serialize; killed owner releases/reclaims safely; unrelated process cannot lose its lock.
- Verification: Multi-process contention/crash tests on Windows and macOS.
- Blocked by: S5-F2-T1.
- Blocks: S5-F2-T9, S5-F4-T6, S5-F8-T1.
- Context: `scripts/with-heavy-job-lock.mjs`, `scripts/with-ui-lock.mjs`.

### S5-F2-T5 - Harden Windows quoting and path argument handling

- Evidence class: `T2-core`.
- [ ] Completion: command/path corpus passes every script runner
- Outcome: Spaces, Unicode, parentheses, ampersands, percent signs, quotes, and long paths cannot alter command meaning.
- Scope: Download, rebuild, package, inspect, dev, verify, and helper-launch arguments.
- Acceptance: Arguments arrive byte-for-byte/character-for-character at fixture executable; no shell injection or truncation.
- Verification: Property/corpus tests on Windows with malicious and ordinary paths.
- Blocked by: S5-F1-T6, S5-F2-T1.
- Blocks: S5-F3-T2, S5-F5-T1, S5-F6-T1, S5-F8-T1.

### S5-F2-T6 - Port package, download, and native preparation entrypoints

- Evidence class: `T2-core`.
- [ ] Completion: critical scripts use shared runner and platform-aware paths
- Outcome: Package resource preparation and Claude/Codex/native dependency commands work from PowerShell.
- Scope: `scripts/package-app.mjs`, `prepare-package-resources.mjs`, download scripts, ABI scripts, staging/cleanup.
- Acceptance: No Unix executable-name, quoting, separator, permission-bit, or path-layout assumption remains in required Windows lane.
- Verification: Script unit tests, dry-run manifests, Windows package preparation smoke.
- Blocked by: S5-F2-T1, S5-F2-T5.
- Blocks: S5-F3-T2, S5-F3-T6, S5-F8-T1.

### S5-F2-T7 - Remove required POSIX shell and command dependencies

- Evidence class: `T2-core`.
- [ ] Completion: required-command audit contains no Windows-blocking dependency
- Outcome: `sh`, `bash`, `/bin/zsh`, `open -a`, `which`, POSIX env assignment, and Unix-only utilities do not gate Windows workflows.
- Scope: npm scripts, Node scripts, Electron main process, speech credentials, docs, CI, tests.
- Acceptance: Each occurrence is ported, isolated to guarded non-Windows branch, or documented as non-required platform code.
- Verification: Static audit test plus native command walkthrough.
- Blocked by: S5-F2-T1.
- Blocks: S5-F5-T1, S5-F7-T2, S5-F2-T9.

### S5-F2-T8 - Preserve exit, cancellation, and log semantics

- Evidence class: `T2-core`.
- [ ] Completion: process contract suite passes on Windows
- Outcome: Ctrl+C, child failure, timeout, signal emulation, and output streaming behave consistently across wrapper layers.
- Scope: Process tree ownership, graceful timeout, forced fallback, exit code mapping, stdout/stderr, redaction.
- Acceptance: Failure never reports success; cancellation does not leave lock/child; sensitive arguments never print.
- Verification: Fixture process tree tests and manual cancellation during check/build/download.
- Blocked by: S5-F2-T1, S5-F2-T4.
- Blocks: S5-F4-T4, S5-F4-T6, S5-F5-T6, S5-F6-T6.

### S5-F2-T9 - Close portable-script acceptance

- Evidence classes: `T2-core` for S5-PS01 through S5-PS06;
  `T2-capability:macos-shared-scripts` for S5-PS07.
- [ ] Completion: S5-PS01 through S5-PS06 pass on Windows
- Separate certification: S5-PS07 records the macOS shared-script regression.
- Outcome: Root workflows have one trustworthy cross-platform command contract.
- Scope: Install helpers, lint, style, typecheck, test, build, check, dev, verify, package preparation.
- Acceptance: Required commands pass native PowerShell; static audit finds no
  unguarded POSIX dependency. macOS regression status remains separate.
- Verification: `S5-PS01` through `S5-PS06` and a native Windows command
  transcript. S5-PS07 separately owns macOS capability certification.
- Blocked by: S5-F2-T2 through T8.
- Blocks: S5-F3-T8, S5-F4-T8, S5-F8-T10, S5-F9-T2.

## S5-F3 - Native Dependency Install

### S5-F3-T1 - Define install and ABI dependency graph

- Evidence class: `T2-core`.
- [ ] Completion: install phases and ownership are explicit and tested
- Outcome: npm install, binary download, Node native ABI, Electron native ABI, speech build, and package preparation run in deterministic order.
- Scope: `preinstall`/`postinstall`, npm lifecycle, cache, success markers, recovery, package invalidation.
- Acceptance: No consumer runs before prerequisite; repeated install is idempotent; partial failure resumes safely.
- Verification: Dependency-graph tests and injected failure at each phase.
- Blocked by: S5-F1-T2.
- Blocks: S5-F3-T2 through T8.

### S5-F3-T2 - Fix Windows native rebuild command resolution

- Evidence class: `T2-core`.
- [ ] Completion: native rebuild tools launch through resolved Windows executables
- Outcome: `npm ci` no longer fails because rebuild scripts invoke Unix-style npm/npx/electron-rebuild names.
- Scope: npm/npx `.cmd`, local `node_modules/.bin`, electron-builder rebuild, cwd/env, error output.
- Acceptance: Clean install resolves repository-local tools first and never depends on shell command lookup.
- Verification: Resolver fixtures and empty-cache Windows install.
- Blocked by: S5-F2-T1, S5-F2-T5, S5-F2-T6, S5-F3-T1.
- Blocks: S5-F3-T3, S5-F3-T4, S5-F3-T8.

### S5-F3-T3 - Build and probe Node ABI modules

- Evidence classes: `T2-core` for ABI preparation and `better-sqlite3`;
  `T2-capability:windows-terminal` for real `node-pty` terminal behavior.
- [ ] Completion: ABI preparation and `better-sqlite3` pass real Node load/use probes
- Separate certification: Windows terminal rows own the real `node-pty` behavior.
- Outcome: Development/test tooling gets architecture-correct native modules for Node 22.
- Scope: Rebuild inputs, MSVC/Python selection, SQLite open/query, PTY spawn/resize/exit.
- Acceptance: Real probes pass after clean install and repair; wrong ABI/architecture fails before marker write.
- Verification: Native Node probes and corruption/wrong-ABI recovery tests.
- Blocked by: S5-F1-T3, S5-F3-T2.
- Blocks: S5-F3-T4, S5-F3-T5, S5-F4-T1.

### S5-F3-T4 - Build and probe Electron ABI modules

- Evidence classes: `T2-core` for ABI preparation and `better-sqlite3`;
  `T2-capability:windows-terminal` for real `node-pty` terminal behavior.
- [ ] Completion: ABI preparation and `better-sqlite3` load under the required Electron version
- Separate certification: Windows terminal rows own real `node-pty` operation.
- Outcome: Dev and package no longer rely on stale Node-targeted binaries.
- Scope: Electron ABI rebuild, better-sqlite3 query, node-pty PowerShell session, architecture verification.
- Acceptance: Real Electron probes pass; switching targets invalidates stale output and rebuilds once.
- Verification: Electron probe harness and Node/Electron alternating-target tests.
- Blocked by: S5-F1-T3, S5-F3-T2, S5-F3-T3.
- Blocks: S5-F3-T5, S5-F4-T4, S5-F8-T1.

### S5-F3-T5 - Harden ABI marker, cache, and repair state

- Evidence class: `T2-core`.
- [ ] Completion: marker reflects verified content, not attempted command
- Outcome: Interrupted or partial rebuild cannot poison later development/package runs.
- Scope: ABI key, toolchain/version inputs, architecture, artifact hashes, atomic marker, lock, invalidation, repair.
- Acceptance: Marker writes only after probes; stale/corrupt state is detected; concurrent repair serializes safely.
- Verification: State-machine tests, interrupted rebuild, cache deletion, version/architecture changes.
- Blocked by: S5-F3-T3, S5-F3-T4.
- Blocks: S5-F3-T8, S5-F4-T6, S5-F8-T2.
- Context: `scripts/native-abi-key.mjs`, `scripts/ensure-native-abi.mjs`.

### S5-F3-T6 - Make Claude/Codex binary preparation deterministic

- Evidence class: `T2-core`.
- [ ] Completion: Windows x64 downloads validate, cache, retry, and package correctly
- Outcome: Supported provider binaries are exact-version, architecture-correct, and never accepted from partial/corrupt downloads.
- Scope: URLs/assets, checksum/signature metadata, atomic download, executable naming, cache, offline/error state, staging.
- Acceptance: Clean and cached runs pass; wrong platform/hash/partial file fails safely; package contains expected versions.
- Verification: Download fixture tests, real Windows downloads, package manifest inspection.
- Blocked by: S5-F2-T1, S5-F2-T6, S5-F3-T1.
- Blocks: S5-F6-T1, S5-F6-T2, S5-F8-T3.
- Context: `scripts/download-claude-binary.mjs`, `scripts/download-codex-binary.mjs`.

### S5-F3-T7 - Integrate speech native build preparation

- Evidence classes: `T2-capability:local-stt` and `T2-capability:kokoro`.
- [ ] Completion: speech sidecars/models have deterministic Windows preparation path
- Outcome: CMake/Rust/MSVC requirements are checked before whisper.cpp/Parakeet/Kokoro work.
- Scope: Native STT sidecar, whisper.cpp build/download, Rust target, model cache, package staging, failure recovery.
- Acceptance: Missing tool gives preflight error; successful build is architecture/version verified; partial state is retryable.
- Verification: Clean/cached/offline/interrupted preparation tests on Windows.
- Blocked by: S5-F1-T3, S5-F3-T1, S5-F2-T6.
- Blocks: S5-F7-T1, S5-F8-T3.

### S5-F3-T8 - Close clean-install and native dependency acceptance

- Evidence classes: `T2-core` for S5-ND01 through S5-ND03 and S5-ND05
  through S5-ND07; `T2-capability:windows-terminal` for S5-ND04.
- [ ] Completion: the `T2-core` S5-ND rows pass from a clean checkout and empty cache
- Separate certification: S5-ND04 records real Windows terminal capability.
- Outcome: `npm ci --legacy-peer-deps` and all required preparation finish without manual rebuild toggle or patch.
- Scope: The `T2-core` scope covers clean/cached/offline retry,
  Node/Electron `better-sqlite3` probes, provider binary preparation, and
  uninstall/reinstall dependency state. Real terminal and speech preparation
  retain their named capability status.
- Acceptance: Two consecutive installs are deterministic; failure leaves actionable state; exact versions and artifacts recorded.
- Verification: The `T2-core` S5-ND rows from an isolated clean checkout and
  empty cache plus the native manifest. S5-ND04 and speech preparation retain
  separate capability evidence.
- Blocked by for `T2-core`: S5-F1-T4, S5-F1-T6, S5-F1-T7, the
  `T2-core` scope of S5-F2-T9, S5-F3-T2, the `T2-core` scopes of
  S5-F3-T3 and S5-F3-T4, S5-F3-T5, and S5-F3-T6.
- Separate terminal and speech capability certifications depend on the matching
  capability scopes of S5-F3-T3, S5-F3-T4, and S5-F3-T7.
- Blocks: S5-F4-T8, S5-F6-T8, S5-F7-T8, S5-F8-T10, S5-F9-T2.

## S5-F4 - Windows CI and Development Lifecycle

### S5-F4-T1 - Add Windows install, check, test, and build CI lane

- Evidence class: `release-gate`.
- [ ] Completion: required Windows CI job passes from clean hosted runner
- Outcome: Every change gets native proof for install, lint, style, typecheck, tests, and production build.
- Scope: Windows runner, Node 22/npm cache, Python 3.11, CMake/Rust/MSVC setup, timeouts, concurrency, artifacts.
- Acceptance: Job starts clean, runs same root commands as developer docs, and cannot pass after any required gate fails.
- Verification: Successful workflow plus deliberate failure probes for install/check/build.
- Blocked by: S5-F1-T2, S5-F1-T4, S5-F3-T3, S5-F2-T2, S5-F2-T3.
- Blocks: S5-F4-T2, S5-F4-T3, S5-F4-T8, S5-F9-T3.
- Context: `.github/workflows/ci.yml`, `package.json`.

### S5-F4-T2 - Add Windows package preparation and inspection CI lane

- Evidence class: `release-gate`.
- [ ] Completion: CI creates and inspects bounded Windows Preview/package artifact
- Outcome: Packaging regressions, wrong architectures, missing binaries, and native ABI mismatches fail before manual release testing.
- Scope: Resource preparation, unpacked Preview or installer as practical, manifest, architecture, native load probes, upload limits.
- Acceptance: Artifact maps exact SHA/version and contains required Windows resources; inspection failure blocks job.
- Verification: Green package job plus tampered/missing/wrong-architecture fixtures.
- Blocked by: S5-F4-T1, S5-F3-T4, S5-F3-T5, S5-F3-T6, S5-F3-T7.
- Blocks: S5-F4-T8, S5-F8-T3, S5-F9-T3.

### S5-F4-T3 - Publish bounded secret-safe CI evidence

- Evidence class: `release-gate`.
- [ ] Completion: failed/successful Windows jobs retain useful sanitized evidence
- Outcome: CI failures can be diagnosed without dumping environment, credentials, usernames, tokens, or large package trees.
- Scope: Tool versions, step summaries, manifests, probe output, redaction, retention, artifact size, path normalization.
- Acceptance: Evidence identifies exact failure and candidate while secret/path corpus remains redacted.
- Verification: Redaction tests, artifact inspection, failed-workflow review.
- Blocked by: S5-F1-T5, S5-F4-T1, S5-F4-T2.
- Blocks: S5-F4-T8, S5-F9-T1, S5-F9-T5.

### S5-F4-T4 - Make root development command own complete Windows stack

- Evidence class: `T2-core`.
- [ ] Completion: one root command starts renderer, Electron main, helpers, and required development services
- Outcome: Windows users never manually launch frontend/backend/helper pieces or stale packaged executables.
- Scope: `scripts/dev.mjs`, startup order, port/profile/protocol identity, logs, readiness, shutdown.
- Acceptance: One command reaches ready window; child failure stops startup; Ctrl+C closes only owned process tree.
- Verification: Clean start, injected child failure, Ctrl+C, terminal close, and repeated start tests.
- Blocked by: S5-F2-T8, S5-F3-T4.
- Blocks: S5-F4-T5, S5-F4-T6, S5-F4-T7, S5-F5-T6.

### S5-F4-T5 - Extend exact-checkout and profile verification to Windows

- Evidence class: `T2-core`.
- [ ] Completion: `dev:verify` proves active Windows renderer/main/profile ownership
- Outcome: Agent/user cannot mistake packaged, stale, or another checkout instance for current source changes.
- Scope: PID/executable path, checkout root, Dev data profile, renderer origin, protocol, helper/service ownership, package conflict.
- Acceptance: Correct instance passes; stale/packaged/wrong-checkout/wrong-profile cases fail with exact repair command.
- Verification: Fixture tests and live matrix with Dev, Preview, product, and second checkout.
- Blocked by: S5-F4-T4.
- Blocks: S5-F4-T7, S5-F4-T8, S5-F9-T4.
- Context: `scripts/verify-dev-instance.mjs`, shared dev-test control.

### S5-F4-T6 - Add Windows-owned process restart and cleanup

- Evidence class: `T2-core`.
- [ ] Completion: restart/stop commands terminate only recorded Flapstack process trees
- Outcome: Stale Electron/helper/terminal/provider children do not block new run, while unrelated Node/PowerShell/provider sessions survive.
- Scope: PID records, creation identity, descendants, graceful shutdown, timeout, force fallback, locks, ports, scheduled helpers.
- Acceptance: Owned tree fully exits; PID reuse and unrelated matching names are never killed; cleanup is idempotent.
- Verification: Process-tree integration tests with owned/unowned siblings and forced-hang fixtures.
- Blocked by: S5-F2-T4, S5-F2-T8, S5-F3-T5, S5-F4-T4.
- Blocks: S5-F4-T7, S5-F5-T4, S5-F5-T6, S5-F6-T6, S5-F7-T7.

### S5-F4-T7 - Recover stale locks, ports, crashes, sleep, and abrupt shutdown

- Evidence classes: `T2-core` for stale locks, ports, crashes, and abrupt
  shutdown; `T2-capability:windows-power-network` for real sleep/wake recovery.
- [ ] Completion: stale-lock, port, crash, and abrupt-shutdown recovery returns Windows Dev to one healthy instance
- Separate certification: S5-WI07 owns real sleep/wake behavior.
- Outcome: Common interruption cannot require task-manager hunting or machine reboot.
- Scope: Stale lock/PID, occupied port, renderer/main/helper crash, power transition, terminal close, forced process kill.
- Acceptance: Repair distinguishes owned/stale/unrelated state, preserves logs/data, and reaches verified instance.
- Verification: Fault-injection lifecycle suite and live repeated-recovery walkthrough.
- Blocked by: S5-F4-T4, S5-F4-T5, S5-F4-T6.
- Blocks: S5-F4-T8, S5-F5-T8, S5-F9-T4.

### S5-F4-T8 - Close Windows CI and dev lifecycle acceptance

- Evidence classes: `T2-core` for S5-DV; `release-gate` for hosted S5-CI.
- [ ] Completion: all S5-DV rows pass
- Separate certification: S5-CI01 through S5-CI03 own hosted-CI release evidence.
- Outcome: Windows failures reproduce in CI or through one verified local lifecycle.
- Scope: The `T2-core` scope covers native Windows
  start/verify/restart/stop, crash/stale recovery, exact-source local gates,
  logs, and process ownership. Hosted CI and retained artifacts remain release
  gates.
- Acceptance: S5-DV01 through S5-DV04 pass; live Dev reaches the correct
  profile; no orphan or unrelated-process kill remains.
- Verification: S5-DV01 through S5-DV04, local CI-equivalent transcripts,
  logs, and process audit. S5-CI01 through S5-CI03 remain separate release
  evidence.
- Blocked by for `T2-core`: S5-F1-T7, the `T2-core` scopes of
  S5-F2-T9 and S5-F3-T8, and S5-F4-T1 through S5-F4-T7.
- Blocks: S5-F5-T9, S5-F6-T8, S5-F7-T8, S5-F8-T10, S5-F9-T2.

## S5-F5 - Windows OS Integration

### S5-F5-T1 - Replace macOS-only open-path and external launch behavior

- Evidence class: `T2-core`.
- [ ] Completion: files, folders, URLs, and app targets use platform-native guarded adapters
- Outcome: Windows never executes `open -a` or another macOS/POSIX-only command.
- Scope: `src/main/lib/open-external.ts`, open-in UI, Explorer/default app/browser, path validation, errors.
- Acceptance: Existing file/folder and allowed URL open correctly; invalid/unsafe targets fail without shell injection.
- Verification: Unit tests plus live file/folder/URL matrix with special-character paths.
- Blocked by: S5-F2-T5, S5-F2-T7.
- Blocks: S5-F5-T9, S5-F9-T4.

### S5-F5-T2 - Prove Windows terminal profile and PTY behavior

- Evidence class: `T2-capability:windows-terminal`.
- [ ] Completion: PowerShell/cmd configured profiles pass real node-pty lifecycle
- Outcome: Integrated terminal preserves cwd, environment, UTF-8, resize, links, input/output, exit, cancellation, and restart.
- Scope: Shell discovery, profile selection, PTY env, path links, command history, renderer terminal state.
- Acceptance: Missing preferred shell falls back visibly; no Unix shell default; process tree closes with terminal/run.
- Verification: Unit/integration tests and live PowerShell/cmd walkthrough in simple and Unicode worktrees.
- Blocked by: S5-F3-T3, S5-F4-T6.
- Blocks: S5-F5-T6, S5-F5-T9, S5-F6-T4.
- Context: `src/main/lib/terminal/**`, renderer terminal features.

### S5-F5-T3 - Prove DPAPI credential lifecycle and migration

- Evidence class: `T2-core`.
- [ ] Completion: create/read/update/delete/restart/migration paths pass native Windows
- Outcome: Provider and speech secrets remain encrypted and recoverable without plaintext or POSIX shell fallback.
- Scope: Credential service, Claude storage, migrations, corruption/unavailable account, delete, diagnostics redaction.
- Acceptance: Same user/app reads after restart; other context/corrupt ciphertext fails safely; no secret enters logs/export.
- Verification: Native DPAPI integration tests, migration/rollback, secret scan.
- Blocked by: S5-F4-T4.
- Blocks: S5-F6-T3, S5-F7-T2, S5-F8-T7, S5-F9-T4.
- Context: `src/main/lib/credential-service.ts`, Claude credential storage.

### S5-F5-T4 - Prove Windows scheduled and background task lifecycle

- Evidence class: `T2-core`.
- [ ] Completion: owned task create/run/disable/repair/remove flows pass
- Outcome: Automations and background polling survive restart without stale or invisible scheduled work.
- Scope: Task Scheduler adapter, quoting, user/session context, executable/profile path, history, cancellation, uninstall cleanup.
- Acceptance: Task targets exact installed/Dev identity, exposes status/failure, obeys disable/kill, and never runs after removal.
- Verification: Native task lifecycle integration tests and Task Scheduler inspection.
- Blocked by: S5-F4-T6.
- Blocks: S5-F5-T6, S5-F5-T8, S5-F8-T6, S5-F9-T4.
- Context: automation/usage scheduler and Windows platform adapter.

### S5-F5-T5 - Separate protocols, deep links, identities, and data profiles

- Evidence class: `T2-core`.
- [ ] Completion: Dev, Preview, and product deep links route to correct instance/profile
- Outcome: Windows protocol activation cannot cross profiles, steal focus unexpectedly, or spawn duplicate conflicting windows.
- Scope: Protocol registration, command-line parsing, single-instance lock, pending link queue, validation, uninstall cleanup.
- Acceptance: Cold/warm links reach intended object once; malformed/unsafe link rejected; each channel remains isolated.
- Verification: Native protocol matrix across Dev/Preview/product and reinstall/uninstall.
- Blocked by: S5-F4-T4, S5-F4-T5.
- Blocks: S5-F5-T6, S5-F8-T4, S5-F8-T6, S5-F9-T4.
- Context: Electron main/window manager and package protocol config.

### S5-F5-T6 - Unify owned process and app lifecycle behavior

- Evidence class: `T2-core`.
- [ ] Completion: main, renderer, terminal, agent, speech, and background children share ownership rules
- Outcome: Quit/restart/crash/cancel stops appropriate descendants without broad process-name killing.
- Scope: Ownership registry, shutdown order, timeout/force policy, single-instance behavior, logs, recovery.
- Acceptance: Normal/forced exits leave no owned child; unrelated process survives; repeated lifecycle is stable.
- Verification: Native process-tree tests and Process Explorer/PowerShell inspection.
- Blocked by: S5-F2-T8, S5-F4-T4, S5-F4-T6, S5-F5-T2, S5-F5-T4, S5-F5-T5.
- Blocks: S5-F5-T8, S5-F6-T6, S5-F7-T7, S5-F8-T6.

### S5-F5-T7 - Normalize Windows data, cache, temp, export, and worktree paths

- Evidence class: `T2-core`.
- [ ] Completion: all owned filesystem roots use Windows platform APIs and safety checks
- Outcome: App works under standard user with spaces, Unicode, long paths, locked files, and multiple drives.
- Scope: userData, logs, cache, downloads, models, temp, attachments, exports, repo/worktrees, diagnostics.
- Acceptance: No hard-coded POSIX path; traversal/UNC/device/drive boundary policy explicit; cleanup touches only owned paths.
- Verification: Path-safety suite and live matrix across path variants and permissions.
- Blocked by: S5-F1-T6.
- Blocks: S5-F5-T8, S5-F6-T4, S5-F7-T6, S5-F8-T4, S5-F8-T6.
- Context: shared checkout/path safety, project paths, portability IO.

### S5-F5-T8 - Handle Windows power, network, UAC, firewall, antivirus, and file locks

- Evidence classes: `T2-core` for simulated file-lock/restart behavior;
  `T2-capability:windows-power-network` and
  `T2-capability:windows-security-environment` for real OS conditions.
- [ ] Completion: simulated file-lock/restart failures recover safely or produce an actionable limit
- Separate certifications: S5-WI07 owns power/network behavior; S5-WI08 owns
  firewall, antivirus, and UAC behavior.
- Outcome: Common Windows host behavior cannot silently lose state or leave app permanently wedged.
- Scope: Sleep/wake, lock/unlock, offline/online, denied elevation, firewall prompt/block, quarantined file, locked executable/database.
- Acceptance: State persists; retries are bounded; user sees exact remediation; security protections are never bypassed.
- Verification: Clean VM fault matrix and recovery logs.
- Blocked by: S5-F4-T7, S5-F5-T4, S5-F5-T6, S5-F5-T7.
- Blocks: S5-F5-T9, S5-F8-T6, S5-F9-T6.

### S5-F5-T9 - Close Windows OS integration acceptance

- Evidence classes: `T2-core` for S5-WI01 through S5-WI06 and S5-WI09;
  named Windows environment capabilities for S5-WI07 and S5-WI08.
- [ ] Completion: all `T2-core` S5-WI rows pass in Dev/Preview
- Separate certifications: S5-WI07 and S5-WI08 retain independent capability status.
- Outcome: Windows platform services meet one documented runtime contract.
- Scope: Open actions, terminal, credentials, tasks, protocols, paths, process ownership, power/network/security interruptions.
- Acceptance: Required flows pass standard user and expected elevation paths; unsupported behavior is visible and documented.
- Verification: `S5-WI01` through `S5-WI08`, process/path/secret audits, exact-SHA walkthrough.
- Blocked by for `T2-core`: the `T2-core` scope of S5-F4-T8,
  S5-F5-T1 through S5-F5-T7, and the `T2-core` scope of S5-F5-T8.
- Separate hardware/OS-environment certification depends on the matching
  capability scope of S5-F5-T8.
- Blocks: S5-F6-T8, S5-F7-T8, S5-F8-T10, S5-F9-T2.

## S5-F6 - Agent Harness Parity

### S5-F6-T1 - Prove Claude binary discovery and launch

- Evidence class: `T2-capability:claude-windows`.
- [ ] Completion: bundled/downloaded Claude Windows binary resolves and launches in Dev/package
- Outcome: Claude does not depend on macOS/Linux executable names, permissions, paths, or shell lookup.
- Scope: Version selection, discovery precedence, architecture, environment, stdio, working directory, diagnostics.
- Acceptance: Exact binary/version shown; missing/corrupt/wrong-arch state gives repair; no global binary shadows pinned choice silently.
- Verification: Discovery fixtures, real status probe, Dev/package launch.
- Blocked by: S5-F2-T5, S5-F3-T6.
- Blocks: S5-F6-T3, S5-F6-T4, S5-F6-T7.

### S5-F6-T2 - Prove Codex binary discovery and launch

- Evidence class: `T2-capability:codex-windows`.
- [ ] Completion: bundled/downloaded Codex Windows binary resolves and launches in Dev/package
- Outcome: Codex uses pinned architecture-correct executable with actionable fallback behavior.
- Scope: Version/discovery, ACP/app-server invocation, environment, stdio, working directory, diagnostics.
- Acceptance: Exact binary/version shown; corrupt/missing/wrong-arch state blocks safely; arguments survive Windows quoting.
- Verification: Discovery fixtures, real status/model probe, Dev/package launch.
- Blocked by: S5-F2-T5, S5-F3-T6.
- Blocks: S5-F6-T3, S5-F6-T4, S5-F6-T7.

### S5-F6-T3 - Close Claude and Codex login/status/credential flows

- Evidence class: `T2-capability:windows-agent-providers`.
- [ ] Completion: interactive/noninteractive auth status and repair work on Windows
- Outcome: Users can authenticate, see truthful status, restart, revoke, and recover without secret exposure.
- Scope: Local provider auth, app credential references, DPAPI, modal/status UI, offline/expired/revoked cases, logs.
- Acceptance: Login completes in expected terminal/browser path; status survives restart; logout/revoke removes owned secret state.
- Verification: Credentialed native provider matrix and secret-safe log review.
- Blocked by: S5-F5-T3, S5-F6-T1, S5-F6-T2.
- Blocks: S5-F6-T4, S5-F6-T7, S5-F9-T4.

### S5-F6-T4 - Prove global/project/task chat and session resume

- Evidence class: `T2-capability:windows-agent-providers`.
- [ ] Completion: both providers run and resume across all supported chat scopes
- Outcome: Windows paths/worktrees and provider session IDs preserve one-chat/one-agent identity.
- Scope: New run, follow-up, restart/resume, cwd/worktree, spaces/Unicode paths, persistence, unsupported resume state.
- Acceptance: Correct scope/context/session resumes once; provider failure does not corrupt chat/run history.
- Verification: Credentialed Dev matrix for Claude/Codex and all scopes, including restart.
- Blocked by: S5-F5-T2, S5-F5-T7, S5-F6-T1, S5-F6-T2, S5-F6-T3.
- Blocks: S5-F6-T5, S5-F6-T6, S5-F6-T7.

### S5-F6-T5 - Prove permissions, approvals, tools, worktrees, and checkpoints

- Evidence class: `T2-capability:windows-agent-providers`.
- [ ] Completion: provider controls enforce same Windows authority contract
- Outcome: Command/path previews, allow/deny decisions, worktree limits, MCP/tools, checkpoints, and file manifests are truthful.
- Scope: Permission modes, approval UI, Windows command/path normalization, shell tools, file edits, rollback, audit.
- Acceptance: Denied action cannot execute; approved action matches preview; changes stay in allowed checkout/worktree and appear in manifests.
- Verification: Credentialed allow/deny/property tests and real tool-using workflows.
- Blocked by: S5-F6-T4.
- Blocks: S5-F6-T7, S5-F9-T4, S5-F9-T6.

### S5-F6-T6 - Prove streaming, cancellation, retry, and provider process cleanup

- Evidence class: `T2-capability:windows-agent-providers`.
- [ ] Completion: event and lifecycle matrix passes without orphan provider children
- Outcome: Text, reasoning, tool events, usage, failure, cancellation, retry, and app shutdown remain coherent.
- Scope: Event normalization, Ctrl+C/cancel, timeout, provider child tree, retry/resume policy, terminal close, restart.
- Acceptance: No duplicate/replayed result; cancellation reaches provider; owned processes stop; history records terminal state accurately.
- Verification: Fault-injection tests and credentialed cancel/retry/restart workflows.
- Blocked by: S5-F2-T8, S5-F4-T6, S5-F5-T6, S5-F6-T4.
- Blocks: S5-F6-T7, S5-F9-T4.

### S5-F6-T7 - Repeat provider parity in packaged Windows app

- Evidence classes: `T2-capability:windows-agent-providers` for Preview;
  `release-gate` for an installed candidate.
- [ ] Completion: Claude/Codex capability flows pass the unpacked Preview
- Separate certification: installed-candidate provider parity is a release gate.
- Outcome: Development-only PATH/config behavior cannot masquerade as packaged support.
- Scope: Bundled binaries, auth/status, run/resume, permissions, tools, cancellation, logs, upgrade persistence.
- Acceptance: Packaged flows match verified Dev or expose documented package-specific limitation; no dependency on repo files.
- Verification: Preview and NSIS provider walkthrough with exact artifact hashes.
- Blocked by: S5-F6-T1 through T6, S5-F8-T4.
- Blocks: S5-F6-T8, S5-F8-T10, S5-F9-T4.

### S5-F6-T8 - Close agent harness acceptance

- Evidence class: `T2-capability:windows-agent-providers`.
- [ ] Completion: S5-AH matrix rows pass for Claude and Codex
- Outcome: Windows is a supported provider execution host, not package-only shell.
- Scope: Downloads, discovery, auth, chats, resume, permissions, worktrees, events, cancellation, restart, package.
- Acceptance: Required credentialed matrix passes exact SHA/artifact; limitations are provider-specific and user-visible.
- Verification: `S5-AH01` through `S5-AH07`, logs/audit/history review, process/secret scan.
- Blocked by: S5-F3-T8, S5-F4-T8, S5-F5-T9, S5-F6-T3 through T7.
- Blocks: S5-F8-T10, S5-F9-T2.

## S5-F7 - Speech and Voice Parity

### S5-F7-T1 - Build and verify Windows speech prerequisites

- Evidence classes: `T2-capability:local-stt` and `T2-capability:kokoro`.
- [ ] Completion: STT/TTS native prerequisites prepare from documented Windows command
- Outcome: CMake, Rust/MSVC, Windows SDK, sidecars, and model requirements are explicit before voice launch.
- Scope: Native STT sidecar, whisper.cpp, Parakeet, Kokoro/system TTS dependencies, x64 architecture, package staging.
- Acceptance: Clean preparation passes or stops at preflight with exact missing component; artifacts report version/architecture/hash.
- Verification: Clean/cached/offline preparation tests and real sidecar version probes.
- Blocked by: S5-F1-T3, S5-F3-T7.
- Blocks: S5-F7-T3 through T8.
- Context: `native/stt-sidecar/**`, speech build/download scripts.

### S5-F7-T2 - Remove POSIX speech credential fallback

- Evidence class: `T2-core`.
- [ ] Completion: speech credentials use platform-aware secure service only
- Outcome: Windows voice path never invokes `/bin/zsh` or reads plaintext shell configuration.
- Scope: Cloud STT/TTS keys, provider credential migration, DPAPI, missing/denied/corrupt credential, diagnostics.
- Acceptance: Secure lookup survives restart; missing credential offers repair; no secret or shell command appears in logs.
- Verification: Credential integration/migration tests, static `/bin/zsh` audit, secret scan.
- Blocked by: S5-F2-T7, S5-F5-T3.
- Blocks: S5-F7-T5, S5-F7-T8.

### S5-F7-T3 - Prove Windows microphone capture and dictation ownership

- Evidence class: `T2-capability:microphone`.
- [ ] Completion: microphone permission, selection, recording, cancellation, and device loss pass
- Outcome: Voice input captures only during visible owned session and releases device on stop/crash.
- Scope: Device enumeration, default/device change, denied permission, audio format, hotkey, concurrent request ownership, temp data.
- Acceptance: No hidden recording; UI shows active owner/state; denied/missing/lost device recovers without wedging next session.
- Verification: Renderer/main tests plus real microphone walkthrough and forced device removal.
- Blocked by: S5-F7-T1, S5-F5-T6.
- Blocks: S5-F7-T4, S5-F7-T5, S5-F7-T7.

### S5-F7-T4 - Prove local/offline Windows transcription

- Evidence class: `T2-capability:local-stt`.
- [ ] Completion: supported local engine transcribes, cancels, restarts, and reports progress
- Outcome: Offline dictation remains available without cloud key on Windows.
- Scope: Parakeet/whisper.cpp engine selection, sidecar launch, model path, streaming/file input, progress, cancel, restart, language.
- Acceptance: Known audio meets baseline accuracy/latency; wrong/missing model repairs; cancellation stops owned sidecar.
- Verification: Fixture audio suite, offline live dictation, process/model inspection.
- Blocked by: S5-F7-T1, S5-F7-T3, S5-F5-T7.
- Blocks: S5-F7-T5, S5-F7-T7, S5-F7-T8.

### S5-F7-T5 - Prove configured cloud transcription fallback

- Evidence class: `T2-capability:cloud-stt`.
- [ ] Completion: cloud fallback activates only by policy and shows provenance
- Outcome: Local failure or explicit selection can use configured cloud service without silent audio upload.
- Scope: Credential, consent/policy, provider request, timeout/retry, offline/error, result provenance, cancellation.
- Acceptance: No cloud call without configured authority; result identifies engine; secret/audio not retained beyond policy.
- Verification: Mock contract tests plus authorized live success/failure/cancel matrix.
- Blocked by: S5-F7-T2, S5-F7-T3, S5-F7-T4.
- Blocks: S5-F7-T8.

### S5-F7-T6 - Prove Windows system and offline TTS playback

- Evidence classes: `T2-capability:system-tts` and `T2-capability:kokoro`.
- [ ] Completion: system TTS and Kokoro paths speak, stop, replay, switch device, and recover
- Outcome: Read-aloud works without macOS/Linux command assumptions and offers offline default.
- Scope: Voice discovery, output device, queue/ownership, stop/interrupt, cached audio, offline engine, missing device/model.
- Acceptance: Only current owner plays; stop is prompt; fallback is visible; temp audio and child processes clean.
- Verification: Playback unit tests and live speaker/headphone/device-change walkthrough.
- Blocked by: S5-F7-T1, S5-F5-T7.
- Blocks: S5-F7-T7, S5-F7-T8.

### S5-F7-T7 - Harden voice model, temp-file, process, and restart lifecycle

- Evidence classes: `T2-core` for history/temp/owned-process cleanup;
  `T2-capability:local-stt` and `T2-capability:kokoro` for real model/process
  recovery.
- [ ] Completion: voice history, temporary files, and owned-process records clean safely
- Separate certifications: real STT/Kokoro download and crash recovery remain
  with their named capability rows.
- Outcome: Large models, recordings, generated audio, and sidecars stay bounded, verified, private, and removable.
- Scope: Atomic model cache, hash/version, disk-space error, partial download, temp permissions, retention, shutdown, app upgrade/uninstall.
- Acceptance: Partial files never appear valid; owned temp/process state cleans; history retains only declared metadata/content.
- Verification: Fault-injection model/temp/process tests and restart/uninstall inspection.
- Blocked by for `T2-core`: S5-F4-T6 and S5-F5-T6. Device, local-STT,
  system-TTS, and Kokoro cleanup certification depends on S5-F7-T3,
  S5-F7-T4, and S5-F7-T6.
- Blocks: S5-F7-T8, S5-F8-T3, S5-F8-T6.

### S5-F7-T8 - Close Windows speech and voice acceptance

- Evidence classes: `T2-core` for S5-VO02 and S5-VO07; all named speech
  capabilities for the other S5-VO rows; `release-gate` for installed-package
  composition.
- [ ] Completion: S5-VO02 and S5-VO07 pass in Dev/Preview
- Separate certifications: Each speech capability retains independent status;
  installed-package composition remains a release gate.
- Outcome: The Windows voice foundation keeps credentials, history, temporary
  files, and owned processes private and recoverable. Each STT/TTS/device path
  keeps independent capability status.
- Scope: The `T2-core` scope covers S5-VO02 and S5-VO07. Capture,
  local/cloud STT, system/offline TTS, models, devices, installed-package
  composition, and audio accessibility retain capability or release status.
- Acceptance: S5-VO02 and S5-VO07 pass in Dev/Preview; all
  device/credential/model limitations remain visible.
- Verification: S5-VO02 and S5-VO07 plus process/file/secret audits. The
  remaining S5-VO rows use their separately labeled capability/release
  evidence.
- Blocked by for `T2-core`: the `T2-core` scopes of S5-F3-T8,
  S5-F4-T8, and S5-F5-T9; S5-F7-T2; and the `T2-core` scope of
  S5-F7-T7.
- Separate speech/provider/device capability certifications depend on the
  matching capability scopes of S5-F3-T8, S5-F4-T8, S5-F5-T9, and
  S5-F7-T1 through S5-F7-T7.
- Blocks: S5-F8-T10, S5-F9-T2.

## S5-F8 - Windows Packaging and Security

### S5-F8-T1 - Add explicit Windows Preview and release package entrypoints

- Evidence classes: `T2-core` for the unpacked Preview entrypoint;
  `release-gate` for NSIS and portable artifacts.
- [x] Completion: root commands own the Windows unpacked Preview build
- Separate certification: NSIS and portable artifacts remain release gates.
- Outcome: Package target, architecture, channel, app identity, output, and resources derive from one resolved plan.
- Scope: `package:preview:win`, inspect/smoke commands, `package:win`, channel/app IDs, x64 target, clean outputs.
- Acceptance: Command rejects conflicting target/config; logs exact plan; no manual electron-builder invocation required.
- Verification: Plan-resolution tests and native Windows dry-run/build.
- Blocked by: S5-F2-T2, S5-F2-T4, S5-F2-T5, S5-F2-T6, S5-F3-T4.
- Blocks: S5-F8-T2 through T5.
- Context: `scripts/package-app.mjs`, electron-builder config, `package.json`.

### S5-F8-T2 - Make package staging atomic and ABI-aware

- Evidence class: `T2-core`.
- [ ] Completion: fresh allowlisted staging tree is built only after Electron ABI verification
- Outcome: Package cannot reuse stale binaries/resources or leak development/local artifacts.
- Scope: ABI invalidation/repair, resource allowlist, atomic replace, output cleanup, concurrent package lock, failure recovery.
- Acceptance: Staging starts clean; wrong ABI or unexpected file fails; interrupted package leaves prior valid artifact distinguishable.
- Verification: Staging manifest tests, interrupted build, unexpected-file and stale-ABI fixtures.
- Blocked by: S5-F3-T5, S5-F8-T1.
- Blocks: S5-F8-T3, S5-F8-T4, S5-F8-T5.
- Context: `scripts/prepare-package-resources.mjs`, package staging logic.

### S5-F8-T3 - Extend packaged binary and resource inspection for Windows

- Evidence class: `T2-core`.
- [ ] Completion: inspector validates every required Windows executable, DLL, native module, and sidecar
- Outcome: Wrong/missing architecture, version, resource, license, or unexpected binary blocks candidate.
- Scope: PE architecture, better-sqlite3, node-pty, Claude/Codex, STT/TTS sidecars, ASAR/resources, manifest, executable load/smoke.
- Acceptance: Expected allowlist and versions match; tampered/wrong-arch/missing/extra fixtures fail with exact path/reason.
- Verification: Inspector unit tests and real Preview/NSIS/portable inspection.
- Blocked by for `T2-core`: S5-F3-T6, S5-F4-T2, the `T2-core` scope
  of S5-F7-T7, and S5-F8-T2.
- Inspection of optional speech sidecars depends on S5-F3-T7 and the matching
  capability scope of S5-F7-T7.
- Blocks: S5-F8-T4, S5-F8-T5, S5-F8-T8.
- Context: `scripts/inspect-packaged-binaries.mjs`, `scripts/lib/packaged-binary.mjs`.

### S5-F8-T4 - Prove Windows Preview package runtime

- Evidence class: `T2-core`.
- [ ] Completion: unpacked Preview launches and passes core package smoke
- Outcome: Packaged resource/layout/profile behavior is tested before installer lifecycle.
- Scope: Preview identity/userData/protocol, native module loads, window, terminal, credentials, agents, voice, logs, shutdown.
- Acceptance: Preview stays isolated from Dev/product, uses no repo runtime files, and leaves no owned process after quit.
- Verification: Automated smoke plus native manual core-flow walkthrough.
- Blocked by: S5-F5-T5, S5-F5-T7, S5-F8-T1, S5-F8-T2, S5-F8-T3.
- Blocks: S5-F6-T7, S5-F8-T5, S5-F8-T6, S5-F8-T10.

### S5-F8-T5 - Build deterministic NSIS installer and portable package

- Evidence class: `release-gate`.
- [ ] Completion: x64 installer and portable artifacts map exact SHA/version
- Outcome: Declared Windows artifacts build natively with stable names, metadata, icons, protocols, and resources.
- Scope: NSIS install mode, portable target, version/file metadata, shortcuts, protocol registration, output hashes, reproducibility metadata.
- Acceptance: Repeated equivalent build has explainable manifest; artifact names/metadata/architectures match plan.
- Verification: Native builds, PE/resource inspection, manifest/hash comparison.
- Blocked by: S5-F8-T1, S5-F8-T2, S5-F8-T3, S5-F8-T4.
- Blocks: S5-F8-T6, S5-F8-T7, S5-F8-T8.

### S5-F8-T6 - Prove install, upgrade, repair, rollback, and uninstall

- Evidence class: `release-gate`.
- [ ] Completion: clean and Stage 4 upgrade VM lifecycle matrices pass
- Outcome: Installer preserves user data when required and removes only owned state on uninstall.
- Scope: Standard/admin install, first launch, upgrade, schema/data backup, repair/reinstall, supported rollback, keep/remove-data uninstall, tasks/protocols/process cleanup.
- Acceptance: No data loss/profile crossover/orphan; rollback procedure restores usable backup; uninstall choices match docs.
- Verification: Snapshot-based clean/upgrade VM walkthrough and filesystem/registry/task/process diff.
- Blocked by: S5-F5-T4 through T8, S5-F7-T7, S5-F8-T4, S5-F8-T5.
- Blocks: S5-F8-T9, S5-F8-T10, S5-F9-T5, S5-F9-T6.

### S5-F8-T7 - Implement Authenticode-ready signing and verification

- Evidence class: `release-gate`.
- [ ] Completion: signing path uses external credentials and verifies chain/timestamp
- Outcome: Production Windows artifacts can be signed without credentials entering repo, package logs, or persisted workspace state.
- Scope: Certificate source contract, nested executables, signing order, timestamp service, verify command, missing/expired/revoked credential, rotation/recovery.
- Acceptance: Authorized signed fixture/candidate validates every required executable; absent credential yields explicit unsigned Preview and blocks signed claim.
- Verification: Signature inspection, invalid/expired/tampered fixtures, secret scan, sanitized CI dry run.
- Blocked by: S5-F5-T3, S5-F8-T5.
- Blocks: S5-F8-T8, S5-F8-T9, S5-F8-T10.

### S5-F8-T8 - Add artifact integrity, dependency, license, malware, and secret gates

- Evidence class: `release-gate`.
- [ ] Completion: candidate security report covers every distributed file
- Outcome: Artifact is attributable, architecture-correct, licensed, secret-free, and scanned before support claim.
- Scope: SHA256, file manifest, source SHA/version, dependency/license inventory, unexpected binaries, malware scan result, signature state, provenance.
- Acceptance: Mismatch, secret, unexplained executable, missing license, or unresolved severe finding blocks candidate.
- Verification: Automated package report, tampered/secret fixture tests, independent review.
- Blocked by: S5-F8-T3, S5-F8-T5, S5-F8-T7.
- Blocks: S5-F8-T9, S5-F8-T10, S5-F9-T5.

### S5-F8-T9 - Write Windows install, support, diagnostics, recovery, and signing docs

- Evidence class: `release-gate`.
- [ ] Completion: operator/user docs match observed candidate lifecycle
- Outcome: Users can verify, install, grant permissions, diagnose, back up, recover, upgrade, and uninstall without unsafe bypasses.
- Scope: Prerequisites, artifact/hash/signature verification, UAC/antivirus/firewall, data/log paths, support bundle, backup/rollback, uninstall, known limits.
- Acceptance: Fresh user follows commands/paths; docs never advise disabling security or exposing secrets; support bundle is redacted.
- Verification: Clean-user doc walkthrough, link/command/path review, secret scan.
- Blocked by: S5-F8-T6, S5-F8-T7, S5-F8-T8.
- Blocks: S5-F8-T10, S5-F9-T7.

### S5-F8-T10 - Close Windows packaging and security acceptance

- Evidence classes: `T2-core` for S5-PK01 and S5-PK03; `release-gate` for the
  other S5-PK rows.
- [ ] Completion: S5-PK01 and S5-PK03 pass on the exact Preview artifact
- Separate certification: S5-PK02 and S5-PK04 through S5-PK09 retain release-gate status.
- Outcome: The unpacked Preview build and inspector have truthful native
  Windows behavior. Installer, portable, signing, malware, and lifecycle
  evidence remain distributable-release certification.
- Scope: The `T2-core` scope covers S5-PK01 and S5-PK03. S5-PK02 and
  S5-PK04 through S5-PK09 remain release gates.
- Acceptance: S5-PK01 and S5-PK03 pass with no core P0/P1 package or security
  defect. Production signature or installability claims require their separate
  release evidence.
- Verification: S5-PK01 and S5-PK03, Preview inspection, and independent
  core package/security review. Exact distributable hashes, VM snapshots,
  signing, and lifecycle evidence remain release gates.
- Blocked by for `T2-core`: the `T2-core` scopes of S5-F2-T9,
  S5-F3-T8, S5-F4-T8, and S5-F5-T9; S5-F8-T1 through S5-F8-T4.
- Separate provider/speech capability and distributable-release
  certifications depend on S5-F6-T7, S5-F7-T8, and S5-F8-T5 through
  S5-F8-T9.
- Blocks: S5-F9-T2.

## S5-F9 - Integrated Windows Release

### S5-F9-T1 - Freeze candidate and evidence ledger

- Evidence classes: `T2-core` for exact source/profile identity; `release-gate`
  for the immutable distributable artifact set.
- [ ] Completion: one exact source state and profile identity own Stage 5 implementation acceptance
- Separate certification: immutable artifact hashes own release acceptance.
- Outcome: Task, matrix, command, VM, credential class, package hash, and defect evidence cannot drift across builds.
- Scope: Source SHA/branch, clean checkout, CI runs, artifact manifest, Windows builds/VM snapshots, account classes, timestamps, redacted evidence links.
- Acceptance: Every checked item resolves to candidate; later source/artifact change invalidates affected evidence explicitly.
- Verification: Ledger consistency/link/hash check and independent review.
- Blocked by: S5-F1-T1, S5-F4-T3.
- Blocks: S5-F9-T2 through T9.

### S5-F9-T2 - Reconcile every task, spec, router, and matrix row

- Evidence class: `T2-core`.
- [ ] Completion: Stage 5 crosswalk has no missing, duplicate, stale, or contradictory authority
- Outcome: 76 task IDs, feature routers, capability spec, execution waves,
  Tier 2 matrix rows, and the separate Tier 3 owner backlog agree.
- Scope: S5-F1 through F9, dependencies, counts, links, completion status, Stage 4 entry and Stage 6 exit boundary.
- Acceptance: Strict OpenSpec passes; link/ID/task-count checks pass; status lives only in task board/matrix.
- Verification: Automated crosswalk/link scan and reviewer trace from each feature to evidence.
- Blocked by: S5-F9-T1. Reconciliation records the current independent core,
  capability, release, and tracking states; it does not require every
  certification to close first.
- Blocks: S5-F9-T3 through T9.

### S5-F9-T3 - Run full automated Windows candidate gate

- Evidence classes: `T2-core` for the exact-source local gate; `release-gate`
  for hosted Windows CI and retained artifacts.
- [ ] Completion: the full exact-source local Windows gate passes
- Separate certification: Hosted Windows CI and artifact retention remain release gates.
- Outcome: Style, lint, typecheck, tests, build, OpenSpec, native probes,
  unpacked Preview, inspection, and smoke share one source state. Hosted CI and
  retained distributable artifacts remain release evidence.
- Scope: `npm run check`, strict OpenSpec, native ABI probes, unpacked Preview
  commands, inspection, and smoke. Hosted Windows CI, installer/portable
  artifacts, and release security reports remain release gates.
- Acceptance: No rerun from changed source; flaky or skipped required test remains blocker; outputs retained in ledger.
- Verification: Command/workflow links, SHA/hash match, failure/skip audit.
- Blocked by: S5-F4-T1, S5-F4-T2, S5-F9-T1, S5-F9-T2.
- Blocks: S5-F9-T4 through T9.

### S5-F9-T4 - Run integrated verified-Dev Windows workflow

- Evidence class: `T2-core`.
- [ ] Completion: one native Dev session exercises the complete `T2-core`
      Windows workflow
- Outcome: Tooling, lifecycle, core OS integration, credentials, protocols,
  worktrees, restart, and recovery compose correctly. Provider and speech
  device paths retain independent capability status.
- Scope: Clean project/task/chat, provider-neutral run controls, DPAPI
  credentials, attachments, checkpoint, scheduled work, deep link, restart,
  and recovery. Real terminal, Claude/Codex, microphone, STT, and TTS
  certifications stay in their named capability rows.
- Acceptance: `dev:verify` proves candidate checkout/profile; state/audit/history match visible actions; no orphan or secret leak.
- Verification: Agent-operated product/test-control MCP development flows plus
  logs, process, database, and filesystem review. The owner walkthrough remains
  Tier 3.
- Blocked by for `T2-core`: S5-F4-T5, S5-F4-T7, S5-F5-T1,
  S5-F5-T3, S5-F5-T4, S5-F5-T5, and the `T2-core` scope of
  S5-F9-T3.
- Separate Claude/Codex Windows capability certification depends on
  S5-F6-T3 through S5-F6-T7.
- Blocks: S5-F9-T5, S5-F9-T6, S5-F9-T9.

### S5-F9-T5 - Run clean installed-candidate Windows workflow

- Evidence class: `release-gate`.
- [ ] Completion: agent-operated standard-user VM passes the packaged walkthrough
- Outcome: Installer, product identity, runtime features, support docs, and security prompts work outside repository.
- Scope: Artifact/hash/signature check, install, first launch, terminal, harnesses, credentials, voice, protocol, scheduler, restart, diagnostics.
- Acceptance: No repo dependency/manual patch/unsafe security bypass; package matches ledger and support claims.
- Verification: Clean VM snapshot walkthrough, support-bundle review, artifact/process/filesystem inspection.
- Blocked by: S5-F1-T5, S5-F8-T6, S5-F8-T8, S5-F9-T3, S5-F9-T4.
- Blocks: S5-F9-T6 and the matching release/Tier 3 handoff lanes. It does not
  block the S5-F9-T9 `T2-core` decision.

### S5-F9-T6 - Run upgrade, rollback, interruption, and uninstall acceptance

- Evidence class: `release-gate`.
- [ ] Completion: existing Stage 4 profile and failure-path VM matrices pass
- Outcome: Windows support does not trade compatibility for data loss, stuck integrations, or irreversible package state.
- Scope: Upgrade, backup, migrations, repair, rollback, keep/remove-data uninstall, power/network/UAC/antivirus/file-lock failures.
- Acceptance: Supported state survives or restores; owned tasks/protocols/processes clean; unrelated data remains untouched.
- Verification: VM snapshots, database/config diff, registry/task/process/file audit.
- Blocked by: S5-F5-T8, S5-F6-T5, S5-F8-T6, S5-F9-T4, S5-F9-T5.
- Blocks: the matching release/Tier 3 handoff lanes. It does not block the
  S5-F9-T9 `T2-core` decision.

### S5-F9-T7 - Prepare the owner walkthrough and documentation review

- Evidence class: `tracking-only`.
- [x] Completion: Tier 3 owner instructions and product documentation are
      accurate, hierarchical, and independently reviewed
- Outcome: The owner can test setup, UX, prompts, errors, and recovery without
  Tier 3 status holding Tier 2 implementation work open.
- Scope: `docs/owner-manual-testing-backlog.md`,
  `docs/stage5-windows-manual-test.md`, README, Windows
  setup/install/support/recovery docs, known limits, and feedback capture.
- Acceptance: Feature checks contain concise instructions; manually testable
  tasks are nested with detailed steps and expected results; commands and paths
  match the candidate; only explicitly labeled `release-blocking` owner checks
  can gate release.
- Verification: Link/command/path scan, hierarchy review, and independent
  documentation review.
- Evidence: 2026-07-26 link/path/hierarchy audit and independent review passed
  for the 47-feature/130-task owner backlog. Candidate-specific commands must be
  refreshed if the release artifact changes.
- Blocked by: none for preparation; owner execution remains separate Tier 3.
- Blocks: Tier 3 handoff readiness only; owner execution does not block
  S5-F9-T9.

### S5-F9-T8 - Prove shared contracts and Stage 6 handoff

- Evidence class: `T2-core`.
- [ ] Completion: platform-neutral contract gates pass and Stage 6 consumes the
      accepted Stage 5 implementation baseline
- Outcome: Windows portability changes preserve shared contracts; the
  renumbered roadmap has one dependency chain. macOS certification remains a
  separate capability row.
- Scope: Platform-neutral shared tests; Stage 6 router/execution/matrix/change
  IDs/links; Windows evidence reuse boundary.
- Acceptance: Shared contract tests pass; Stage 6 starts after Stage 5
  implementation acceptance; no active non-archive S5 product-polish ID
  remains.
- Verification: Node 22 shared-contract gates, roadmap link/ID scan, and Stage
  6 review. S5-I05 separately owns macOS regression certification.
- Blocked by: S5-F9-T2, S5-F9-T3.
- Blocks: S5-F9-T9 and Stage 6 entry.

### S5-F9-T9 - Record exact-source Stage 5 implementation decision

- Evidence class: `T2-core`.
- [ ] Completion: the `T2-core` matrix closes with an explicit implementation
      go/no-go and separately listed capability/release blockers
- Outcome: The Windows implementation claim is tied to one reviewed source
  state and can be reproduced or withdrawn.
- Scope: All S5 `T2-core` rows, defects, security/privacy/data review,
  owner-backlog state, known capability/release limits, and implementation
  support statement.
- Acceptance: No core P0/P1, required skipped core row, false implementation
  claim, data-loss path, secret leak, or orphan process remains; Stage 6 gate
  is updated. Capability and release rows retain independent status.
- Verification: Independent core-ledger review and `T2-core` completion in
  `docs/stage5-full-feature-test-matrix.md`.
- Blocked by: The `T2-core` scopes of S5-F9-T1 through T8.
- Blocks: Stage 6 implementation start.
