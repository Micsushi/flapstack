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
| Replacement and retained-source retirement                                                  | PASS   | Generic/direct Settings paths durably tombstone accepted replacements; restart fixtures cover Codex, Voice, and custom Claude, including retained failed migrations and encrypted/session-only values  |

## Verified development evidence

- `npm run dev` started
  `/Users/michaelshi/.codex/worktrees/609c/flapstack` on isolated port `6093`
  with the `Flapstack Dev 609c` profile. `npm run dev:verify` matched the exact
  Electron main, renderer `--app-path`, checkout, and profile.
- Authenticated development test-control MCP used disposable NanoGPT and Voice
  values through the production write-only service. Add/status/replace,
  acknowledged legacy migration, fingerprint, redacted status, and removal
  passed without returning plaintext.
- The NanoGPT fixture reported encrypted persistence with the available macOS
  Keychain backend. Its credential store was mode `0600`, contained ciphertext,
  contained no fixture plaintext, and returned to unconfigured after removal.
- Shared-lease accessibility inspection showed blank secure fields after the
  MCP operations plus write-only and provider-specific ownership copy. No
  stored secret was entered, read, or revealed through the renderer.
- This proves the current isolated development profile only. Packaged restart
  consumption and cross-platform secret stores remain open.

## macOS Preview evidence

- Current `609c` code passed `npm run package:preview:mac`, producing the
  unsigned arm64 Preview directory.
- `npm run package:inspect:preview:mac` verified the arm64 main executable,
  Electron, Claude, Codex, Whisper, Parakeet, `better-sqlite3`, licenses, and
  Electron 39.8.10.
- `npm run package:smoke:preview:mac` executed the bundled Claude 2.1.207,
  Codex 0.144.1, Whisper, and Parakeet probes.
- Exact executable launch evidence belongs to an earlier candidate and is
  context only after the current Settings changes. The current lane did not
  launch Preview.
- Packaged credential entry, encrypted-file inspection, credential restart,
  removal, and restore remain unavailable. Therefore this run does not claim
  packaged macOS Keychain-backed credential persistence.

## Remaining platform and rollback evidence

- Automated local fixtures prove prior-store preservation on corrupt writes,
  fail-closed retirement before session-only replacement, restart
  non-resurrection, retained-source tombstones, and safe removal. Focused Node
  22 security round-2 tests pass. Packaged restore/re-entry was not exercised.
- Windows Credential Manager and Linux Secret Service remain untested.
- No Windows or Linux package claim is inferred from macOS.
