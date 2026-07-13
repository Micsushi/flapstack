# Stage 3 Secure Credential Evidence

Last run: 2026-07-13 PDT

This matrix records only observed evidence. Test values are disposable local
fixtures. No provider credential is recorded here.

## Automated and source evidence

| Area                                                                                        | Status | Evidence                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Encrypted service, atomic write, permissions, corrupt-store rollback, session-only fallback | PASS   | Node 22 focused credential service and migration suites                                                                                                                                                |
| Write-only Settings UI                                                                      | PASS   | Component test proves blank secret fields, fingerprint/backend status, session-only warning, replace confirmation, field clearing, and provider-specific removal                                       |
| Consumer removal                                                                            | PASS   | Codex API-key removal clears app-managed provider sessions without logging out ChatGPT; Voice invalidates adapter state; OpenRouter/NanoGPT use their provider and usage-secret removal paths          |
| Migration acknowledgement                                                                   | PASS   | Settings receives only migrated/retained key names and redacted reasons; automatic migration clears a source only after encrypted acknowledgement, while explicit discard is allowlisted and confirmed |
| Search and ownership                                                                        | PASS   | Credential aliases open exact API Providers rows; Voice and Models route management there and do not own plaintext editors                                                                             |
| Preview executable helper                                                                   | PASS   | Preview inspection reads `CFBundleExecutable`; stale cleanup matches `Flapstack Preview.app/Contents/MacOS/Flapstack Preview`                                                                          |

## Verified development evidence

- `npm run dev` started this worktree with the `Flapstack Dev` profile.
- `npm run dev:verify` passed for
  `/Users/michaelshi/.codex/worktrees/e388/flapstack` and required the renderer
  `--app-path` to match this checkout. The Electron dependency itself resolved
  through the temporary worktree `node_modules` link.
- Visual add, replace, restart, and removal remain unavailable because the Mac
  was locked. No credential was entered through an inaccessible UI.

## macOS Preview evidence

- `npm run package:preview:mac` built the unsigned arm64 Preview directory.
- `npm run package:inspect:preview:mac` verified the arm64 main executable,
  Electron, Claude, Codex, Whisper, Parakeet, `better-sqlite3`, licenses, and
  Electron 39.8.10.
- `npm run package:smoke:preview:mac` executed the bundled Claude 2.1.207,
  Codex 0.144.1, Whisper, and Parakeet probes.
- The exact executable
  `Flapstack Preview.app/Contents/MacOS/Flapstack Preview` launched twice from
  this worktree. Both launches used the separate
  `~/Library/Application Support/Flapstack Preview` profile; its directory mode
  was `0700`.
- Packaged credential entry, encrypted-file inspection, credential restart,
  removal, and restore remain unavailable because the locked UI could not be
  operated. Therefore this run does not claim macOS Keychain-backed credential
  persistence.

## Remaining platform and rollback evidence

- Automated local fixtures prove prior-store preservation on corrupt writes,
  session-only fallback, and safe removal. Packaged restore/re-entry was not
  exercised.
- Windows Credential Manager and Linux Secret Service remain untested.
- No Windows or Linux package claim is inferred from macOS.
