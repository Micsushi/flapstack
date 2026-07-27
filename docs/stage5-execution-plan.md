# Stage 5 Windows Compatibility Execution Plan

Roadmap note: former Stage 5 product-polish work moved intact to Stage 6. Stage
5 now owns native Windows development, runtime, packaging, and acceptance.

Stage 5 begins only after one exact Stage 4 source state has all 73
implementation-gating task checkboxes and all 52 `T2-core` matrix rows
accepted. Stage 6 cannot begin until Stage 5 reaches `T2-core` implementation
completion.

Task and stage completion use
[`completion-tiers.md`](completion-tiers.md). Owner testing is tracked
separately in
[`owner-manual-testing-backlog.md`](owner-manual-testing-backlog.md).

## Outcome

Deliver Flapstack as a first-class Windows 11 x64 Electron application. A
developer must be able to clone, install, check, run, verify, package, inspect,
install, upgrade, repair, and uninstall from native PowerShell without WSL, Git
Bash, or undocumented manual patches. Supported agent, terminal, credential,
speech, deep-link, and lifecycle flows must work in both verified development
and packaged builds.

## Support contract

- Required OS: supported Windows 11 x64 editions on clean native hosts or VMs.
- Required shell: PowerShell 7 and Windows PowerShell 5.1 for documented user
  commands; scripts must not depend on POSIX shell semantics.
- Required toolchain: Node.js 22, repository-pinned npm, Python 3.11, CMake,
  Rust stable with MSVC target, Visual Studio 2022 Build Tools with Desktop C++
  workload and x64/x86 Spectre-mitigated libraries, and current Windows SDK.
- Required artifacts: unpacked Preview build, x64 NSIS installer, and portable
  x64 package when electron-builder config declares it.
- Operator setup: [Windows development and packaging](windows-development.md).
- Required native proof: better-sqlite3, node-pty, whisper.cpp/Parakeet paths,
  bundled Claude/Codex binaries, DPAPI storage, scheduled tasks, terminal
  process trees, protocol/deep links, and installer lifecycle.
- Production signing credentials remain external. Stage 5 must implement and
  verify Authenticode-ready signing, fail safely when credentials are absent,
  and prove signature validation when authorized credentials are available.
- Windows 10, Windows on ARM, Store/MSIX distribution, hosted services,
  auto-update, and Linux public support remain unclaimed unless separately
  promoted with native evidence.

## Feature crosswalk

| Feature                            | Tasks | Outcome                                                                      |
| ---------------------------------- | ----: | ---------------------------------------------------------------------------- |
| S5-F1 Supported Windows toolchain  |     7 | Reproducible prerequisites, versions, bootstrap, and diagnostics             |
| S5-F2 Portable build scripts       |     9 | Every root npm workflow runs without POSIX-only syntax or shim failures      |
| S5-F3 Native dependency install    |     8 | Clean npm install and Node/Electron ABI repair work natively                 |
| S5-F4 Windows CI and dev lifecycle |     8 | Windows CI, process verification, cleanup, and exact-checkout proof          |
| S5-F5 Windows OS integration       |     9 | Paths, terminal, DPAPI, scheduler, protocols, and lifecycle behave correctly |
| S5-F6 Agent harness parity         |     8 | Claude, Codex, auth, resume, permissions, and tool execution pass natively   |
| S5-F7 Speech and voice parity      |     8 | STT/TTS install, credentials, capture, playback, fallback, and cleanup pass  |
| S5-F8 Packaging and security       |    10 | Preview, NSIS, portable, signing, integrity, upgrade, and uninstall pass     |
| S5-F9 Integrated Windows release   |     9 | One exact SHA closes the Tier 2 matrix and prepares the owner walkthrough    |

Task status lives only in
`openspec/changes/enable-windows-compatibility/tasks.md`.

## Dependency waves

### Wave 0 - Freeze baseline and ownership

- S5-F1-T1 through T3: record exact failures, support matrix, and toolchain.
- S5-F9-T1: freeze one source SHA and evidence ledger format.
- Do not hide failures behind WSL, global PATH mutations, or manual source edits.

### Wave 1 - Make repository commands portable

- S5-F1 closes bootstrap and prerequisite diagnostics.
- S5-F2 replaces shell-specific environment assignment, `sh -c`, executable
  assumptions, quoting, lock behavior, and path handling.
- Root commands remain one-command entrypoints on every supported platform.

### Wave 2 - Stabilize install, native ABI, CI, and dev lifecycle

- S5-F3 makes `npm ci --legacy-peer-deps` deterministic on a clean Windows host.
- S5-F4 adds Windows CI for install, check, build, package, native inspection,
  process cleanup, and exact-checkout verification.
- macOS gates stay green after shared script changes.

### Wave 3 - Close native product parity

- S5-F5 proves OS integration: paths, shell/terminal, DPAPI, scheduler, process
  trees, protocols, file opening, data directories, and cleanup.
- S5-F6 proves Claude and Codex download, login/status, run/resume, permissions,
  cancellation, restart, and worktree behavior.
- S5-F7 proves Windows STT/TTS dependencies, credential lookup, recording,
  transcription, playback, fallback, and teardown.

### Wave 4 - Package, secure, and test lifecycle

- S5-F8 produces Preview, NSIS, and portable artifacts from native Windows.
- Inspect architectures, native modules, bundled binaries, secrets, hashes,
  version/SHA, signatures, process cleanup, data migration, and rollback.
- Exercise clean install, upgrade, repair/reinstall, uninstall-keep-data, and
  uninstall-remove-data paths on clean Windows VMs.

### Wave 5 - Integrated exact-SHA Tier 2 acceptance

- S5-F9 runs the full agent-operated matrix against one immutable candidate.
- Run fresh-user and existing-profile workflows with credentialed Claude/Codex,
  terminal, worktrees, voice, deep links, restart, package lifecycle, and logs.
- Close only when no P0/P1 defect, required row, or unsupported claim remains.
- Prepare the separate Tier 3 owner backlog without holding Tier 2 checkboxes
  open.

## Required command contract

These entrypoints must work from native PowerShell on a clean supported host:

```powershell
npm ci --legacy-peer-deps
npm run claude:download
npm run codex:download
npm run check
npm run dev
npm run dev:verify
npm run package:preview:win
npm run package:inspect:preview:win
npm run package:smoke:preview:win
npm run package:win
```

Final script names may be added by S5-F2/S5-F8, but one root command must own
each lifecycle. Users must not manually launch renderer, main process, helper,
or packaged executable pieces to satisfy acceptance.

## Tier 2 implementation completion gate

All conditions required:

1. All 50 implementation-gating task checkboxes close with linked current
   evidence. The complete 76-record ledger keeps capability, release, and
   tracking work visible without adding it to this denominator.
2. All 40 `T2-core` rows in
   `docs/stage5-full-feature-test-matrix.md` pass on one exact source state.
3. The exact-source local Windows CI-equivalent gate passes install, lint,
   style, typecheck, unit/integration tests, production build, native-module
   inspection, unpacked Preview build, inspection, and smoke.
4. Real Windows Dev and unpacked Preview core walkthroughs pass without POSIX
   shell tools.
5. Security, privacy, path, data-loss, recovery, and owned-process core reviews
   pass without a required manual patch.
6. The owner walkthrough and hierarchical Tier 3 backlog are accurate and
   ready; owner execution is tracked separately.
7. Stage 6 routers and dependencies point to the accepted Stage 5 `T2-core`
   baseline.

Provider, terminal-device, speech-device, hardware/OS-environment, and macOS
rows remain separate `T2-capability:*` certifications. Hosted CI retention,
installer/portable lifecycle, signing, malware scanning, clean-VM
install/upgrade/rollback/uninstall, and other distributable-artifact checks
remain `release-gate` work. They block only their named capability or
`release ready` claim.

## Stop/go rule

Any missing `T2-core` native observation, manual patch, secret leak, orphaned
owned process, data-loss path, or required core-matrix gap blocks Stage 5
implementation completion. Cross-compilation and mocks do not replace required
native Windows core evidence. An uncertified capability blocks only that
capability claim. A clean-host package failure or unsafe signing bypass blocks
`release ready`, not implementation completion. Unlabeled Tier 3 owner checks
do not block either state.
