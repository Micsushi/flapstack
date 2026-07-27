# Stage 5 Windows Owner Walkthrough

This is the expanded Tier 3 guide. Track owner status in
[`owner-manual-testing-backlog.md`](owner-manual-testing-backlog.md). Running
this guide does not hold Tier 2 implementation checkboxes open unless a check is
explicitly labeled `release-blocking`.

Use one accepted Stage 5 candidate on a clean Windows 11 x64 VM and one upgrade
VM containing preserved Stage 4 user data. Record SHA, artifact hashes, Windows
build, install type, and failures in Stage 5 evidence ledger.

## Prerequisites

- Standard Windows user plus separate administrator approval when installer needs it.
- Node 22, repository npm, Python 3.11, CMake, Rust MSVC, VS 2022 Build Tools
  (Desktop C++ plus x64/x86 Spectre-mitigated libraries), Windows SDK, Git, and
  PowerShell.
- Test accounts for Claude and Codex.
- Working microphone and audio output device.
- Sample repository path containing spaces and Unicode characters.
- Stage 4 profile backup for upgrade/rollback testing.

## Development walkthrough

1. Clone into path containing spaces and Unicode.
   Expected: checkout and scripts resolve exact path without quoting failure.
2. Run install, binary downloads, `npm run check`, and `npm run dev` from PowerShell.
   Expected: no POSIX shell dependency or manual source patch.
3. Run `npm run dev:verify`.
   Expected: exact checkout and Dev profile pass; conflicting package instance fails clearly.
4. Create project, task, chat, and worktree; open file/folder from app.
   Expected: Windows-native paths and open actions target correct locations.
5. Open PowerShell terminal, run UTF-8 output, resize, cancel command, and close terminal.
   Expected: cwd/output/resize/exit pass; no orphaned process remains.
6. Log in to Claude and Codex, run one tool-using task in each, approve/deny actions,
   cancel, restart app, and resume supported sessions.
   Expected: native binaries, streaming, permissions, audit, cancellation, and recovery pass.
7. Save/reload provider credential and exercise scheduled/background operation.
   Expected: DPAPI survives restart; task can disable/remove without stale process.
8. Record speech, transcribe locally, use configured fallback, play system/offline TTS,
   stop playback, change device, and restart.
   Expected: no `/bin/zsh`; audio/models/temp files recover and clean safely.
9. Open Dev deep link, lock/unlock Windows, sleep/wake, disconnect/reconnect network.
   Expected: correct profile/window routes and owned services recover.

## Packaged walkthrough

1. Build and inspect Preview, NSIS, and portable artifacts.
   Expected: exact SHA/version, x64 architecture, required binaries/modules, hashes,
   licenses, and secret scan pass. Run `npm run package:audit:preview:win` for
   Preview and `npm run package:audit:release:win` for the signed candidate.
2. Install NSIS artifact as standard user and launch from Start menu/protocol.
   Expected: expected UAC/security prompts only; one product instance and correct data path.
3. Repeat core project, terminal, Claude, Codex, credentials, voice, and deep-link flows.
   Expected: packaged behavior matches verified Dev or shows documented limitation.
4. Install newer candidate over existing version.
   Expected: chats, projects, tasks, worktrees, settings, credentials, and history persist.
5. Repair/reinstall and rehearse supported rollback with backup.
   Expected: application recovers without schema or data corruption.
6. Uninstall while keeping data, reinstall, and verify restoration.
   Expected: owned processes/tasks removed; user data returns after reinstall.
7. Uninstall while removing data.
   Run the installed `Uninstall Flapstack.exe` with `--delete-app-data`.
   Expected: owned app data, tasks, protocols, and processes removed; unrelated
   data untouched. A normal uninstall without this flag remains the keep-data path.
8. When signing credentials are authorized, inspect Authenticode chain and timestamp.
   Confirm the real certificate subject and SHA-1 thumbprint match the checked-in
   `build/windows-release-security-policy.json`, clear its explicit release
   block, and run the signed release audit.
   Expected: Flapstack-owned executables and both release artifacts validate as
   the pinned publisher; every vendor executable has a valid timestamped
   signature and recorded publisher; DLLs and Node native modules match their
   report inventory; credentials never appear in repo/logs; and Defender
   evidence is bound to the unchanged package hash.

## Edge cases

- Offline install/download recovery and interrupted model/binary download.
- Antivirus quarantine, locked file, read-only folder, long path, Unicode path.
- Multiple terminals/agent runs, cancellation race, crash during shutdown.
- Missing microphone/audio device, changed default device, denied permission.
- Stale scheduled task, stale lock, conflicting Dev/Preview/product instance.

## Feedback

Report failed step, expected/actual behavior, screenshot or sanitized log, artifact
hash, Windows build, account type, and whether issue reproduces after clean restart.
