# Stage 5 Windows Compatibility Test Matrix

This matrix is Stage 5 acceptance authority. Checkboxes require current evidence
from one exact source SHA on native Windows 11 x64. Cross-built artifacts,
headless mocks, or another operating system do not close Windows rows.

## Candidate and environment

- [ ] **S5-A01** Candidate SHA, branch, checkout path, timestamp, Windows build,
      machine/VM identity, and clean/upgrade profile identities recorded.
- [ ] **S5-A02** Node 22, repository npm, Python 3.11, CMake, Rust MSVC, Visual
      Studio Build Tools, Windows SDK, Git, and PowerShell versions recorded.
- [ ] **S5-A03** Stage task/spec/router crosswalk passes strict OpenSpec validation.
- [ ] **S5-A04** No WSL, Git Bash, Unix compatibility layer, source patch, or
      undocumented global PATH mutation is required.

## S5-F1 - Supported toolchain

- [ ] **S5-TC01** Prerequisite checker identifies every missing or unsupported tool.
- [ ] **S5-TC02** Version pins reject Node 25 and Python 3.13 with useful repair text.
- [ ] **S5-TC03** Clean bootstrap succeeds with paths containing spaces and Unicode.
- [ ] **S5-TC04** README and Windows setup guide reproduce a clean environment.
- [ ] **S5-TC05** Toolchain diagnostics redact usernames, tokens, and private paths.

## S5-F2 - Portable scripts

- [ ] **S5-PS01** `npm run check` works without `sh` and preserves fail-fast order.
- [ ] **S5-PS02** Build environment variables use cross-platform process APIs.
- [ ] **S5-PS03** npm, npx, node, Python, CMake, Cargo, and helper resolution works
      through Windows `.cmd`/`.exe` shims with spaces in installation paths.
- [ ] **S5-PS04** Heavy-job locks serialize lint, style, check, and build correctly.
- [ ] **S5-PS05** Child-process quoting preserves arguments containing spaces,
      Unicode, ampersands, parentheses, and percent signs.
- [ ] **S5-PS06** Failure exit codes and Ctrl+C cancellation propagate correctly.
- [ ] **S5-PS07** Shared script tests pass on both Windows and macOS.

## S5-F3 - Native dependency install

- [ ] **S5-ND01** Clean `npm ci --legacy-peer-deps` succeeds from an empty cache.
- [ ] **S5-ND02** Postinstall ordering prepares required binaries before consumers.
- [ ] **S5-ND03** better-sqlite3 loads under required Node and Electron ABIs.
- [ ] **S5-ND04** node-pty starts a real PowerShell terminal under Electron.
- [ ] **S5-ND05** ABI marker invalidation, repair, verification, and recovery pass.
- [ ] **S5-ND06** Claude/Codex Windows binaries download, validate, and package.
- [ ] **S5-ND07** Offline/cache-miss/partial-download failures leave repairable state.

## S5-F4 - Windows CI and development lifecycle

- [ ] **S5-CI01** Windows CI installs, checks, tests, and builds from clean checkout.
- [ ] **S5-CI02** Windows CI prepares and inspects Preview/package artifacts.
- [ ] **S5-CI03** CI uploads bounded, secret-safe logs and failure evidence.
- [ ] **S5-DV01** Root dev command starts all owned processes from one checkout.
- [ ] **S5-DV02** `dev:verify` proves exact checkout, Dev data profile, renderer,
      main process, helper state, and absence of conflicting package instance.
- [ ] **S5-DV03** Restart and cleanup stop stale process trees without killing
      unrelated Node, PowerShell, terminal, Claude, or Codex processes.
- [ ] **S5-DV04** Crash/stale-lock recovery returns to one healthy Dev instance.

## S5-F5 - Windows OS integration

- [ ] **S5-WI01** Open-file/open-folder/open-URL actions use Windows-native APIs.
- [ ] **S5-WI02** PowerShell, cmd, and configured terminal profiles preserve cwd,
      environment, resize, UTF-8, input, output, exit, and cancellation.
- [ ] **S5-WI03** DPAPI credential create/read/update/delete/restart paths pass.
- [ ] **S5-WI04** Scheduled/background tasks create, run, disable, repair, and remove.
- [ ] **S5-WI05** Custom protocols and deep links route to correct Dev/Preview/product
      instance without profile crossover or duplicate windows.
- [ ] **S5-WI06** App-data, cache, logs, temp, exports, worktrees, and attachments use
      correct Windows paths with long-path and Unicode coverage.
- [ ] **S5-WI07** Sleep, wake, lock, unlock, network loss, and app restart recover.
- [ ] **S5-WI08** Firewall, antivirus, UAC, and file-lock failures are actionable and safe.

## S5-F6 - Agent harness parity

- [ ] **S5-AH01** Claude binary download, discovery, login/status, launch, and resume pass.
- [ ] **S5-AH02** Codex binary download, discovery, login/status, launch, and resume pass.
- [ ] **S5-AH03** Permission modes, approval prompts, command/path previews, and audit pass.
- [ ] **S5-AH04** Global/project/task chats run against paths with spaces and worktrees.
- [ ] **S5-AH05** Streaming text, reasoning, tool events, usage, cancellation, and retry pass.
- [ ] **S5-AH06** Terminal and agent process trees stop without orphaning provider children.
- [ ] **S5-AH07** Restart resumes supported sessions and marks unsupported recovery honestly.

## S5-F7 - Speech and voice parity

- [ ] **S5-VO01** Windows speech prerequisites build/install from documented commands.
- [ ] **S5-VO02** Credential lookup never invokes `/bin/zsh` or another POSIX shell.
- [ ] **S5-VO03** Microphone permission, device selection, recording, and cancellation pass.
- [ ] **S5-VO04** Local/offline transcription and configured cloud fallback pass.
- [ ] **S5-VO05** System TTS and offline Kokoro playback, stop, replay, and device change pass.
- [ ] **S5-VO06** Model download/cache verification and interrupted recovery pass.
- [ ] **S5-VO07** Voice history, temporary files, credentials, and child processes clean safely.

## S5-F8 - Packaging and security

- [ ] **S5-PK01** Native Windows Preview directory package builds and launches.
- [ ] **S5-PK02** x64 NSIS installer and portable package build from exact SHA.
- [ ] **S5-PK03** Package inspection verifies PE architectures, ASAR/resources,
      native modules, Claude/Codex, speech sidecars, licenses, and unexpected files.
- [ ] **S5-PK04** Fresh install and first launch pass under standard user account.
- [ ] **S5-PK05** Upgrade preserves database, settings, credentials, chats, worktrees,
      profiles, scheduled tasks, and supported provider sessions.
- [ ] **S5-PK06** Repair/reinstall and rollback recover without corrupting user data.
- [ ] **S5-PK07** Uninstall stops owned processes/tasks and honors keep/remove-data choice.
- [ ] **S5-PK08** SHA256 manifest, exact SHA/version, secret scan, dependency/license
      inventory, and malware scan evidence pass.
- [ ] **S5-PK09** Authenticode pipeline signs every required executable when credentials
      exist, validates chain/timestamp, and fails closed without leaking secrets.

## S5-F9 - Integrated release

- [ ] **S5-I01** One clean-user workflow covers project/task/chat creation, terminal,
      Claude, Codex, permissions, attachments, worktrees, checkpoint, and restart.
- [ ] **S5-I02** One upgrade-user workflow preserves existing Stage 4 state.
- [ ] **S5-I03** Voice, deep link, scheduler, credential, and package lifecycle pass together.
- [ ] **S5-I04** Full Windows CI, local `npm run check`, package smoke, and native
      inspection pass on candidate SHA.
- [ ] **S5-I05** macOS CI/local equivalent remains green after shared changes.
- [ ] **S5-I06** Security, privacy, data-loss, process-ownership, and path reviews pass.
- [ ] **S5-I07** User completes `docs/stage5-windows-manual-test.md` and accepts result.
- [ ] **S5-I08** No P0/P1 defect, required unsupported claim, or unverified row remains.

## Evidence rule

Each checked row records command or walkthrough, result, date, SHA, OS build,
artifact hash when applicable, and sanitized evidence location. If any required
check cannot run, leave row open and report Stage 5 blocked.
