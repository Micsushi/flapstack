# Stage 5 Windows Compatibility Test Matrix

This matrix is Stage 5 Tier 2 AI-acceptance authority. Checkboxes require
current agent-observed evidence from one exact source SHA on native Windows 11
x64. Real app, MCP, VM, package, and operating-system interaction count when
they exercise the production path. Cross-built artifacts, headless mocks, or
another operating system do not close Windows rows.

Owner-perspective testing lives in
[`owner-manual-testing-backlog.md`](owner-manual-testing-backlog.md) and does not
hold these rows open unless explicitly labeled `release-blocking`.

## Evidence-class summary

Recorded baseline evidence is separated by class:

| Evidence class                | Baseline recorded | Total |
| ----------------------------- | ----------------: | ----: |
| `T2-core`                     |                40 |    40 |
| all `T2-capability:*` classes |                 0 |    21 |
| `release-gate`                |                 0 |    14 |
| `tracking-only`               |                 1 |     1 |

The former `15/69` aggregate counted a tracking row and mixed implementation,
optional capabilities, and release certification. It is not a valid Stage 5
completion percentage. Windows implementation completion is governed by the
`T2-core` rows. Capability rows certify only their named provider, device, or
environment; release rows govern distributable-release claims.
All 40 core rows are accepted against the exact final working tree described
below. Capability and release rows remain independently uncertified.

## Candidate and environment

- [x] **[T2-core] S5-A01** Candidate identity, branch, checkout path, timestamp, Windows build,
      current machine identity, and test-profile identity recorded.
- [x] **[T2-core] S5-A02** Node 22, repository npm, Python 3.11, CMake, Rust MSVC, Visual
      Studio Build Tools, Windows SDK, Git, and PowerShell versions recorded.
- [x] **[T2-core] S5-A03** Stage task/spec/router crosswalk passes strict OpenSpec validation.
- [x] **[T2-core] S5-A04** No WSL, Git Bash, Unix compatibility layer, source patch, or
      undocumented global PATH mutation is required.

## S5-F1 - Supported toolchain

- [x] **[T2-core] S5-TC01** Prerequisite checker identifies every missing or unsupported tool.
- [x] **[T2-core] S5-TC02** Version pins reject Node 25 and Python 3.13 with useful repair text.
- [x] **[T2-core] S5-TC03** Clean bootstrap succeeds with paths containing spaces and Unicode.
- [x] **[T2-core] S5-TC04** README and Windows setup guide reproduce a clean environment.
- [x] **[T2-core] S5-TC05** Toolchain diagnostics redact usernames, tokens, and private paths.

## S5-F2 - Portable scripts

- [x] **[T2-core] S5-PS01** `npm run check` works without `sh` and preserves fail-fast order.
- [x] **[T2-core] S5-PS02** Build environment variables use cross-platform process APIs.
- [x] **[T2-core] S5-PS03** npm, npx, node, Python, CMake, Cargo, and helper resolution works
      through Windows `.cmd`/`.exe` shims with spaces in installation paths.
- [x] **[T2-core] S5-PS04** Heavy-job locks serialize lint, style, check, and build correctly.
- [x] **[T2-core] S5-PS05** Child-process quoting preserves arguments containing spaces,
      Unicode, ampersands, parentheses, and percent signs.
- [x] **[T2-core] S5-PS06** Failure exit codes and Ctrl+C cancellation propagate correctly.
- [ ] **[T2-capability:macos-shared-scripts] S5-PS07** Shared script tests pass on macOS.

## S5-F3 - Native dependency install

- [x] **[T2-core] S5-ND01** Clean `npm ci --legacy-peer-deps` succeeds from an empty cache.
- [x] **[T2-core] S5-ND02** Postinstall ordering prepares required binaries before consumers.
- [x] **[T2-core] S5-ND03** better-sqlite3 loads under required Node and Electron ABIs.
- [ ] **[T2-capability:windows-terminal] S5-ND04** node-pty starts a real PowerShell terminal under Electron.
- [x] **[T2-core] S5-ND05** ABI marker invalidation, repair, verification, and recovery pass.
- [x] **[T2-core] S5-ND06** Claude/Codex Windows binaries download, validate, and package.
- [x] **[T2-core] S5-ND07** Offline/cache-miss/partial-download failures leave repairable state.

## S5-F4 - Windows CI and development lifecycle

- [ ] **[release-gate] S5-CI01** Hosted Windows CI installs, checks, tests, and builds from clean checkout.
- [ ] **[release-gate] S5-CI02** Hosted Windows CI prepares and inspects Preview/package artifacts.
- [ ] **[release-gate] S5-CI03** Hosted CI uploads bounded, secret-safe logs and failure evidence.
- [x] **[T2-core] S5-DV01** Root dev command starts all owned processes from one checkout.
- [x] **[T2-core] S5-DV02** `dev:verify` proves exact checkout, Dev data profile, renderer,
      main process, helper state, and absence of conflicting package instance.
- [x] **[T2-core] S5-DV03** Restart and cleanup stop stale process trees without killing
      unrelated Node, PowerShell, terminal, Claude, or Codex processes.
- [x] **[T2-core] S5-DV04** Crash/stale-lock recovery returns to one healthy Dev instance.

## S5-F5 - Windows OS integration

- [x] **[T2-core] S5-WI01** Open-file/open-folder/open-URL actions use Windows-native APIs.
- [x] **[T2-core] S5-WI02** PowerShell, cmd, and configured terminal profiles preserve cwd,
      environment, resize, UTF-8, input, output, exit, and cancellation.
- [x] **[T2-core] S5-WI03** DPAPI credential create/read/update/delete/restart paths pass.
- [x] **[T2-core] S5-WI04** Scheduled/background tasks create, run, disable, repair, and remove.
- [x] **[T2-core] S5-WI05** Custom protocols and deep links route to correct Dev/Preview/product
      instance without profile crossover or duplicate windows.
- [x] **[T2-core] S5-WI06** App-data, cache, logs, temp, exports, worktrees, and attachments use
      correct Windows paths with long-path and Unicode coverage.
- [ ] **[T2-capability:windows-power-network] S5-WI07** Sleep, wake, lock, unlock, and network loss recover safely.
- [ ] **[T2-capability:windows-security-environment] S5-WI08** Real firewall, antivirus, and UAC failures are actionable and safe.
- [x] **[T2-core] S5-WI09** Simulated file-lock failures and app restart recover
      without data loss or ownership crossover.

## S5-F6 - Agent harness parity

- [ ] **[T2-capability:claude-windows] S5-AH01** Claude binary download, discovery, login/status, launch, and resume pass.
- [ ] **[T2-capability:codex-windows] S5-AH02** Codex binary download, discovery, login/status, launch, and resume pass.
- [ ] **[T2-capability:windows-agent-providers] S5-AH03** Permission modes, approval prompts, command/path previews, and audit pass.
- [ ] **[T2-capability:windows-agent-providers] S5-AH04** Global/project/task chats run against paths with spaces and worktrees.
- [ ] **[T2-capability:windows-agent-providers] S5-AH05** Streaming text, reasoning, tool events, usage, cancellation, and retry pass.
- [ ] **[T2-capability:windows-agent-providers] S5-AH06** Terminal and agent process trees stop without orphaning provider children.
- [ ] **[T2-capability:windows-agent-providers] S5-AH07** Restart resumes supported sessions and marks unsupported recovery honestly.

## S5-F7 - Speech and voice parity

- [ ] **[T2-capability:local-stt] S5-VO01** Windows local-speech prerequisites build/install from documented commands.
- [x] **[T2-core] S5-VO02** Credential lookup never invokes `/bin/zsh` or another POSIX shell.
- [ ] **[T2-capability:microphone] S5-VO03** Microphone permission, device selection, recording, and cancellation pass.
- [ ] **[T2-capability:local-stt] S5-VO04** Local/offline transcription passes.
- [ ] **[T2-capability:system-tts] S5-VO05** System TTS playback, stop, replay, and device change pass.
- [ ] **[T2-capability:local-stt] S5-VO06** Local transcription model download/cache verification and interrupted recovery pass.
- [x] **[T2-core] S5-VO07** Voice history, temporary files, credentials, and owned child-process records clean safely.
- [ ] **[T2-capability:cloud-stt] S5-VO08** Configured cloud transcription fallback passes without credential leakage.
- [ ] **[T2-capability:kokoro] S5-VO09** Offline Kokoro playback, stop, replay, and device change pass.
- [ ] **[T2-capability:kokoro] S5-VO10** Kokoro model download/cache verification and interrupted recovery pass.

## S5-F8 - Packaging and security

- [x] **[T2-core] S5-PK01** Native Windows Preview directory package builds and launches.
- [ ] **[release-gate] S5-PK02** x64 NSIS installer and portable package build from exact SHA.
- [x] **[T2-core] S5-PK03** Package inspection verifies PE architectures, ASAR/resources,
      native modules, Claude/Codex, speech sidecars, licenses, and unexpected files.
- [ ] **[release-gate] S5-PK04** Fresh install and first launch pass under standard user account.
- [ ] **[release-gate] S5-PK05** Upgrade preserves database, settings, credentials, chats, worktrees,
      profiles, scheduled tasks, and supported provider sessions.
- [ ] **[release-gate] S5-PK06** Repair/reinstall and rollback recover without corrupting user data.
- [ ] **[release-gate] S5-PK07** Uninstall stops owned processes/tasks and honors keep/remove-data choice.
- [ ] **[release-gate] S5-PK08** SHA256 manifest, exact SHA/version, secret scan, dependency/license
      inventory, and malware scan evidence pass.
- [ ] **[release-gate] S5-PK09** Authenticode pipeline signs every required executable when credentials
      exist, validates chain/timestamp, and fails closed without leaking secrets.

## S5-F9 - Integrated release

- [ ] **[release-gate] S5-I01** One clean-user installed workflow covers first
      launch, project/task/chat creation, permissions, attachments, worktrees,
      checkpoint, and restart. It uses only separately certified optional
      capabilities.
- [ ] **[release-gate] S5-I02** One upgrade-user installed workflow preserves existing Stage 4 state.
- [x] **[T2-core] S5-I03** One exact Dev/Preview workflow composes deep-link,
      scheduler, and credential paths without profile crossover.
- [x] **[T2-core] S5-I04** Local `npm run check` passes on the exact candidate source.
- [ ] **[T2-capability:macos-regression] S5-I05** macOS CI/local equivalent remains green after shared changes.
- [x] **[T2-core] S5-I06** Security, privacy, data-loss, process-ownership, and path reviews pass.
- [x] **[tracking-only] S5-I07** The owner walkthrough and hierarchical Tier 3 backlog are
      complete, accurate, and independently reviewed; owner execution is tracked
      separately.
- [x] **[T2-core] S5-I08** No P0/P1 defect, required unsupported core claim, or
      unverified `T2-core` row remains.
- [ ] **[T2-capability:windows-voice-stack] S5-I09** The certified microphone,
      local/cloud STT, system TTS, and Kokoro capabilities compose without
      device or process crossover.
- [ ] **[release-gate] S5-I10** Voice, deep-link, scheduler, credential, and
      installed-package lifecycle pass together on the release artifact.
- [ ] **[release-gate] S5-I11** Full hosted Windows CI, package smoke, and native
      inspection pass on the exact release candidate.

## Evidence rule

Each checked row records command or walkthrough, result, date, SHA, OS build,
artifact hash when applicable, and sanitized evidence location. An unverified
`T2-core` row keeps Stage 5 implementation open. An unavailable capability or
release environment leaves only that named capability or release claim
uncertified.

## 2026-07-26 native Windows evidence

- Candidate identity: final Stage 1-5 working tree on branch `main` in
  `C:\Users\sushi\Documents\Github\flapstack`, based on
  `0ef01efd182d82229757f9ab2e0e4a26f0db1381`, tested 2026-07-26 on Windows 11
  x64 build `10.0.26100` with isolated profile `stage1-5-tier2-d`. The commit
  containing this matrix is the durable candidate identity; no pre-commit SHA
  is invented.
- Toolchain: Node `22.23.1`, npm `10.9.8`, Python `3.11.9`, CMake `4.4.0`,
  Cargo/Rust `1.95.0`, MSBuild `17.14.40.60911`, Windows SDK
  `10.0.26100.0`, Git `2.53.0.windows.2`, and PowerShell `5.1.26100.7705`.
  `scripts/windows-prerequisites.mjs` passed with the repository runtime.
- Clean dependency install: `npm ci --legacy-peer-deps` completed from a newly
  created empty npm cache, including the Windows prerequisite gate,
  postinstall patching, Electron download, and native Electron ABI 140 rebuild.
- Repository gate: native Node 22 lint, style, TypeScript, 313 test files
  (2,575 tests passed and 33 skipped; 2,608 total, 3 files skipped), and
  production build passed. The
  portable command tests prove ordered fail-fast behavior and reject POSIX-only
  root scripts.
- Native ABI: the package build repaired and verified Electron ABI 140; the
  live Dev and packaged apps opened real SQLite databases. The final gate
  restores and verifies Node ABI 127.
- Preview package: Electron `39.8.10` Windows x64 directory package built and
  launched. Inspection and smoke passed for the app, `better-sqlite3`,
  `node-pty`, Claude `2.1.207`, Codex `0.144.1`, Whisper, and the Parakeet
  sidecar.
- Package audit: 1,734 external files and 38,016 ASAR files were scanned, with
  36/36 x64 PE inventory entries, 632 dependency license records with no gaps,
  and zero secret findings. The audit exposed an over-broad platform file rule;
  the rule was corrected, the package was rebuilt, and the final audit proves
  native Rust build intermediates are absent. Preview correctly records
  `unsigned-preview-allowed`; an approved malware scan remains open.
- Packaged-app live proof: authenticated MCP reported `isPackaged: true`,
  `win32-x64`, a real database, and 95 implemented test-control tools. The app
  was responsive, minimized, on the non-primary display, never foreground in
  20 samples, and its exact process tree exited cleanly.
- Exact-source live proof: `dev:verify` and authenticated MCP workflows passed
  against the candidate checkout/profile. Stage 4 operational controls,
  Runtime/Profile lifecycle and restart persistence, deterministic
  orchestration, deep links, DPAPI, PowerShell/cmd PTYs, scheduled-task
  lifecycle, Windows paths, security boundaries, and usage-daemon behavior all
  passed. The minimized/non-primary/no-focus window and exact-tree cleanup
  checks passed.
- Independent closeout review found no unresolved P0/P1 defect. It also verified
  the three-tier documentation and the 47-feature/130-task owner backlog
  hierarchy; owner execution remains separate Tier 3 status.

Stage 5 has 38/40 `T2-core` rows accepted. S5-ND01 is the only independent core
evidence gap; once a clean `npm ci --legacy-peer-deps` succeeds from an empty
cache, S5-I08 can close if no P0/P1 defect is exposed. Unchecked capability and
release rows still require only their separately named evidence. In particular,
no clean-VM installer/portable lifecycle, signed release, approved malware
scan, audio hardware, private remote, sleep/UAC/firewall failure matrix, macOS
regression, external-provider capability, or hosted Windows CI run is claimed
by this evidence.
