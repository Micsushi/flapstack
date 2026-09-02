# macOS feature readiness

Audited through 2026-08-28 on Apple Silicon with macOS 26.5.2. The audited source
snapshot starts at commit `6ca8b9d7e0d9456afd5b34d1b4836b5ea1b6a75f` and includes the uncommitted
macOS parity changes in `codex/macos-parity`. It is a development snapshot, not
an immutable release candidate.

This audit maps every top-level feature group in
[owner-manual-testing-backlog.md](owner-manual-testing-backlog.md) to current
macOS evidence. It does not close owner, capability, or release checkboxes in
the authoritative matrices.

The execution path for closing every gap is in the
[macOS remediation plan](macos-remediation-plan.md).

## Status meanings

| Status        | Meaning                                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ready         | The macOS implementation passed relevant automated checks and, where needed, a local live or packaged smoke check. Owner experience signoff is still open.                             |
| Conditional   | The implementation is present, but useful operation needs an external provider, credential, service, model, or remote that was not available for complete live proof.                  |
| Not certified | The implementation and deterministic tests exist, but required real hardware, operating-system lifecycle, accessibility, packaged UI, or long-running evidence has not been completed. |
| Not ready     | A known acceptance requirement is missing. Do not claim the corresponding release capability.                                                                                          |
| N/A           | The feature group is specifically a Windows release concern. The macOS equivalent is noted where relevant.                                                                             |

Current totals: **27 Ready, 16 Conditional, 10 Not certified, 1 Not ready,
and 5 N/A**, across 59 feature groups.

## Evidence collected

- `npm run check` passed: 472 files passed, 3 skipped; 3,755 tests passed, 24
  skipped; lint, formatting, TypeScript, native ABI, Stage 6 ledger, and build
  gates passed.
- `CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:preview:mac` produced an
  unsigned Apple Silicon Preview app. Bundled Electron, Claude, Codex, Whisper,
  Parakeet, `better-sqlite3`, and `node-pty` binary smokes passed. The packaged
  native modules also loaded and executed through Electron. Packaging now builds
  the current checkout before replacing the previous output, preventing stale
  renderer assets from entering a Preview or release package.
- The fresh Preview was installed at `/Applications/Flapstack Preview.app`.
  Its final `app.asar` SHA-256 is
  `a8541cbb6030961d7473a6a4a1b931c1ec2c8140348db5c52396d042710585a4`,
  matching the package output. Its renderer loaded from that exact Applications
  path, and macOS Accessibility remained enabled for `Flapstack Preview` after
  replacement. A clean no-debug launch exposed a stale provider-check frame
  after every startup query had completed. The focused renderer reported a
  hidden document, and its animation frame never ran. Disabling Electron
  background throttling for macOS immediately painted the completed Chat UI
  without a reload. The rebuilt Applications package now transitions to the
  full Chat UI during the same background-launch reproduction.
- The packaged macOS usage daemon passed launch, poll, stop, restart, and
  cleanup smoke checks. The smoke harness now retries transient SQLite startup
  locks instead of failing while the daemon owns the database briefly.
- The package security auditor now traverses the whole app bundle, rejects
  escaping symlinks and likely credentials, validates exact source provenance
  and dependency license text, inventories and hashes every Mach-O binary, and
  records the signature and entitlement policy. The unsigned or linker ad-hoc
  beta state is explicit; signed candidates fail closed without strict
  verification, hardened runtime, Developer ID identity, a team identifier,
  and the declared entitlement set.
- A temporary-directory lifecycle harness passes install, upgrade, rollback,
  reinstall, LaunchAgent cleanup, uninstall, and user-profile preservation
  without reading or modifying `/Applications`. This proves the package
  mechanics but does not replace a clean-machine Finder, Gatekeeper, or
  notarization walkthrough.
- A cross-packaged Intel Preview passed exact x64 inspection for Flapstack,
  Electron, Claude, Codex, Whisper, Parakeet, `better-sqlite3`, `node-pty`, and
  the PTY spawn helper. The packaged `better-sqlite3` and `node-pty` modules
  loaded and executed through x64 Electron under Rosetta. Rosetta cannot
  certify the large Intel provider binaries on this M1 because it does not
  expose their expected Intel AVX capabilities, so native Intel smoke remains
  open. The Preview builder now rebuilds native modules per target architecture
  instead of copying host-architecture modules into a cross-package.
- The production dependency audit reports zero vulnerabilities after updating
  DOMPurify, Mermaid, JS-YAML, and NanoID. Release workflow actions are pinned
  to immutable commits, and all new production packages have vetted license
  notices. Electron 39's install-time extractor and Drizzle Kit's legacy
  development loader retain upstream-only dev dependency advisories.
- `npm run dev:verify` identified this checkout and the `Flapstack Dev`
  profile.
- A real Codex orchestration run returned the requested response, persisted
  success and usage, and enforced its budget. The Claude live run reached the
  provider but was blocked by the account's monthly spend limit.
- A current authenticated Cursor CLI completed a real Flapstack Chat run on
  macOS. The response, successful run state, session, and input/output token
  counts were persisted. Broader Cursor permissions, tools, resume, and failure
  coverage remains open.
- The exact installed Preview package completed credentialed OpenRouter and
  NanoGPT Chats. OpenRouter DeepSeek V4 Pro returned `OPENROUTER_OK`; NanoGPT
  DeepSeek Latest returned `NANOGPT_OK`. Both runs persisted provider, model,
  success, reasoning activity, and token usage. The first OpenRouter attempt
  exposed 15-20 second sidecar limits that were shorter than real first-project
  initialization on this Mac. The runtime startup and local request limits are
  now 60 seconds, covered by a regression contract and a real pinned-sidecar
  startup/session test. The rebuilt package passed both provider retries. Each
  provider also completed a read-only `package.json` tool call with durable tool
  evidence, and cancellation persisted `cancelled` while cleaning up the
  sidecar. A continuation retry exposed two product defects: hidden Product MCP
  guidance could be echoed into assistant text, and a new isolated sidecar tried
  to fork a session that existed only in the previous sidecar's storage. The
  shared sanitizer now removes the Product MCP envelope, and every sidecar run
  creates a fresh provider session while the router supplies durable Chat
  context. The rebuilt NanoGPT continuation returned exactly
  `NANOGPT_RESUME_FIXED_OK` with no hidden marker in the new persisted message.
  OpenRouter's equivalent project-Chat continuation passed before the sanitizer
  rebuild. The rebuilt exact Preview now also passes the clean retry: a second
  turn returned exactly `OPENROUTER_CONTINUATION_CLEAN_OK`, persisted with
  resumed context, and contained no Product MCP marker. The final installed
  package also sanitizes legacy persisted assistant text and reasoning during
  hydration: the historical NanoGPT transcript rendered `NANOGPT_OK` and
  `NANOGPT_TOOL_OK` without the old Product MCP envelope, while user and tool
  parts remain untouched. A first-run global Chat
  defect was traced to the renderer requiring a project checkout even though
  global Chats intentionally have none. Global Chats now receive an isolated,
  app-owned runtime directory without gaining a project association. The exact
  installed Preview created a global OpenRouter Chat, started and completed its
  run, and returned exactly `OPENROUTER_GLOBAL_OK`. The database preserved a
  null project and Chat worktree, recorded the isolated runtime path on the
  sub-Chat and run, and contained no hidden Product MCP marker. Write/exec
  permission approval and rejection also pass in isolated global runtime
  directories. OpenRouter DeepSeek V4 Pro and NanoGPT GLM Latest each persisted
  one-time edit and shell approvals, exact successful responses, and an explicit
  user-rejected edit. The approved files contained the expected bytes and the
  denied files were absent. NanoGPT DeepSeek Latest did not request a tool in
  two write attempts and returned malformed model output, while the same
  NanoGPT harness completed the full permission lane with GLM Latest.
  Deterministic fault injection now proves transient health polling retries,
  actionable network-loss errors, credential preservation language, run-status
  finalization, and unknown rather than fabricated billing when usage capture
  fails. Live provider interruption and post-recovery billing reconciliation
  remain open.
- Official Ollama 0.33.0 on loopback discovered two installed Qwen models. A
  `qwen3:0.6b` Chat returned the requested text and persisted read-only success
  plus 2,258 tokens without cloud fallback. A `qwen3:1.7b` run executed
  `read_file` against `package.json`, persisted successful tool evidence, and
  recorded 5,560 tokens. The pass found and fixed rejection of Ollama 0.33
  `thinking` stream records. Local reasoning is now marked unavailable and
  disabled until the product contract supports it instead of exposing or
  silently losing provider thinking. With Ollama stopped, Flapstack refused
  the run before creating provider activity and did not fall back to cloud.
  Restarting Ollama and retrying recovered the same local Chat successfully.
  The unsigned Preview package also discovered both models and completed a
  persisted read-only `qwen3:1.7b` Chat with 4,751 recorded tokens. In a
  disposable Git project, development full access completed `write_file` and
  bounded `shell_exec` with durable tool evidence. The packaged Preview passed
  the same write and shell flow through separate Ask before edits approval
  prompts. Temporarily removing only the selected model manifest caused a
  fail-closed catalog error before a run was created; restoring the manifest
  and retrying succeeded in the same Chat.
- Real Obsidian 1.13.7 opened both an app-managed vault and a project-owned
  vault. In each mode, an Obsidian edit was detected and adopted by Flapstack,
  a Wikilink and tag were indexed, and Flapstack's write-back appeared in
  Obsidian. An external project-owned note rename preserved its stable identity
  and automatically refreshed the open Flapstack custom-note list. The pass
  found and fixed a missing renderer invalidation after watcher graph rebuilds.
  External note moves and selected-note renames now keep the same identity and
  live selection. A native macOS file chooser uploaded a verified PNG, then
  rename, move, recoverable removal, restore, Obsidian indexing, and restart
  recovery all passed with the same SHA-256. The pass found and fixed a
  MIME-only Finder filter that disabled the Open button for valid images.
  Concurrent Flapstack and Obsidian edits preserved both versions, exposed the
  exact diff, created a distinct stable-ID local copy through Keep both, and
  adopted the external version explicitly. The same draft protection now
  applies across Flapstack windows and survives panel navigation while the app
  remains open. External deletion removed the selected note from the live tree;
  restoring the same stable-ID file restored the selection and its unsaved
  Flapstack draft. The disposable note was then moved to recoverable vault
  trash. A note authored through real Obsidian also indexed its Unicode heading,
  YAML alias and tag, inline tag, aliased heading Wikilink, relative Markdown
  link, block link, and safe raster embed candidate without source rewriting.
  Its three note targets resolved exactly; the raster attachment remained a
  non-note target. The fixture was moved to macOS Trash, the attachment was
  retained, and the project-owned vault remained locally ignored with an empty
  Git status. Deleting this disposable project's derived graph state exposed
  the expected recovery screen. Flapstack rebuilt 8 notes and 2 edges from
  Markdown with the exact prior source fingerprint; SQLite `quick_check` and
  foreign-key checks passed afterward. An isolated native macOS fixture also
  rebuilt the declared 10,000-note limit with 9,999 resolved links, exact alias
  search, integrity, and foreign-key checks in an 11.89-second test body.
- A separate installed-Preview profile rebuilt and rendered 10,000 Markdown
  notes with 9,998 resolved edges. The UI exposed the exact generation
  `068971cf-7679-482c-82cb-714acf002e12` and fingerprint
  `2890bddfeb05c25df59ab01027742638edc4bf2edf5d20b462edbf4feee28e6a`.
  Filtering for the final note stayed responsive, SQLite integrity and foreign
  keys remained clean, and the main and renderer processes used about 99 MB and
  93 MB RSS after loading the graph.
- Corrupting the isolated profile's database reproduced a silent packaged exit.
  Startup now shows a native, secret-safe recovery dialog with the exact
  database path and preserves the damaged file unchanged. Restoring the
  retained backup reopened the same 10,000-note generation and fingerprint.
- The installed Preview package enabled Project Memory through its real Settings
  UI, created an app-managed vault, built its graph, created and edited a custom
  note, saved the exact Markdown, and refreshed the graph from two to three
  nodes. The disposable project and Chat were archived afterward. The external
  project-owned files remained unchanged and Git-clean.
- A second installed-Preview fixture created a project-owned vault and opened
  that exact folder in real Obsidian 1.13.7. Obsidian created a tagged note with
  a Wikilink to `index.md`; Preview rebuilt it as 3 nodes and 1 resolved edge.
  A later Obsidian edit automatically produced a new generation with both tags.
  The `.flapstack` tree stayed locally ignored, SQLite integrity remained clean,
  the Obsidian test window was closed, and the fixture was archived.
- Real macOS microphone access started and stopped Flapstack dictation in both
  Dev and the exact Preview package without an operating-system or runtime
  error. Both silent samples truthfully returned `No speech detected`; device
  switching and recognition quality remain open.
- Kokoro Offline and Native OS Voice both produced real message playback in the
  exact Preview package with progress and rate controls. The original Kokoro
  selection was restored.
- Disposable exact-Preview profiles completed Focused, Standard, and Complete
  onboarding; skip, cancel-without-change, interrupted restart/resume, rerun,
  main tutorial, preset reversal, and upgrade-preserved behavior all passed.
- Real macOS Screen Recording access enumerated the display and application
  windows. A Flapstack-window capture was redacted, previewed, confirmed with
  dimensions, provenance, retention, and SHA-256, and added from history to the
  composer. A renderer `fetch(data:)` defect found in this pass was replaced
  with local data-URL decoding and passed a live retry plus regression tests.
- Real VoiceOver exposed labelled Flapstack controls, Chat transcript groups,
  messages, links, menus, and the composer. The prior `Control+Option` voice
  shortcut conflicted with the VoiceOver modifier and started dictation; the
  macOS default is now `Control+Shift+Space`, and repeated VoiceOver commands
  left dictation stopped. The exact installed package completed 160 real Tab
  actions across 42 distinct control descriptions, including sidebar, search,
  project, Settings, usage, groups, all four panes, pane menus, messages,
  composers, model/tuning controls, dictation, and splitters. At about 200%
  zoom, its 658 by 419 CSS-pixel viewport collapsed responsively to one active
  pane without horizontal overflow and restored all four panes after reset.
  Flapstack Light and Dark both rendered with the expected color scheme and no
  overflow. Emulated Reduce Motion remained usable, and all temporary settings
  were restored.
- Native macOS exact-process Electron probes passed cold startup, 200-message
  rendering, 200-message search, four-pane input, renderer identity, and
  isolated process/profile cleanup.
- The minimum-supported Stage 6 performance run measured all 46 budgets with
  zero omissions and zero failed budget IDs. Its report is marked untrusted
  only because this audit intentionally tests a dirty development snapshot.
- A real `node-pty` stress pass completed 500 shell launches. Open descriptors
  changed from 12 to 13 after cleanup, with no batch failure or growing leak.
- The installed Preview package also passed a four-pane product probe. It
  measured a 301.7 ms input-response observer interval, captured the exact
  installed `app.asar` hash and renderer PID, exposed four named Chat panes and
  four visible composers through Chromium Accessibility, and restored the same
  four-pane layout after restart.
- The packaged multi-window pass found and fixed stale Chat ownership after a
  presentation closed. The rebuilt installed package released the Chat from
  the main window, opened it in native `window-2`, exposed separate main and
  auxiliary renderer URLs plus an accessible auxiliary composer, and restored
  both windows with the same ownership after a clean restart.
- Private sync passed against the user-owned private GitHub repository
  `Micsushi/flapstack-macos-private-sync-proof-20260826`. Flapstack linked the
  `main` branch with only `scopes/settings/config.json`, produced a secret-safe
  commit preview, committed and pushed, pulled an independently pushed second
  version at OID `3157c3ae71a4fa4f166c3616a5e1352869774640`, verified the
  content, and unlinked its local metadata. The remote remained private and had
  zero Actions runs.
- Database migration repair, profile starter versioning, `quick_check`, and
  foreign-key checks passed on the macOS development profile.

## Stage 1

| ID   | Feature group                                         | Status | macOS evidence or gap                                                                                                     |
| ---- | ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| S1-A | Local workspace object model                          | Ready  | Database, migration, project, task, Chat, permission, archive, and search suites passed.                                  |
| S1-B | Agent run path and evidence                           | Ready  | Run, worktree, checkpoint, manifest, stop, and persistence tests passed. A real Codex run also passed.                    |
| S1-C | Workspace navigation and Chat shell                   | Ready  | Renderer suites, live development startup, and exact-package keyboard traversal passed. Owner visual review remains open. |
| S1-D | Attachments, lifecycle actions, and search navigation | Ready  | Persistence, promotion, undo, archive, restore, and result-navigation tests passed.                                       |

## Stage 2

| ID   | Feature group                            | Status        | macOS evidence or gap                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ---------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S2-C | MVP carryover and deep-count UX          | Ready         | Branch, terminal, permission, worktree, search, attachment, run-history, and movement regressions passed.                                                                                                                                                                                                                                                                                                        |
| S2-A | Voice input and playback                 | Not certified | Packaged speech binaries and deterministic flows passed. Real microphone record/stop and honest no-speech handling passed in Dev and Preview; packaged Kokoro and Native OS Voice playback passed. Device switching, recognition quality, cloud STT, voice selection, and cache recovery remain open.                                                                                                            |
| S2-B | Usage, limits, and background collection | Conditional   | Native daemon lifecycle and packaged smoke passed. Complete provider truth, catch-up, alert, and webhook behavior still needs configured live providers and endpoints.                                                                                                                                                                                                                                           |
| S2-D | Cursor harness                           | Conditional   | Adapter and UI tests passed. A current authenticated Cursor CLI completed a real Flapstack Chat run and persisted its response, session, status, and token counts. The broader permissions, tools, resume, and failure matrix remains open.                                                                                                                                                                      |
| S2-E | OpenRouter and NanoGPT harnesses         | Conditional   | Exact-Preview text, reasoning, read-tool, cancellation, global OpenRouter first-run and clean continuation, NanoGPT continuation/recovery, and OpenRouter plus NanoGPT GLM write/shell approval and rejection pass. Hidden Product MCP echo, isolated-sidecar continuation, and repo-free global runtime defects are fixed. NanoGPT DeepSeek write-tool compliance, network-loss, and billing lanes remain open. |
| S2-T | Reasoning-output parity                  | Conditional   | Disclosure, persistence, search, stop, and deterministic no-fabrication checks passed. Live reasoning activity now passes for OpenRouter and NanoGPT; full Claude, Cursor, stop, reload, and failure parity remains open.                                                                                                                                                                                        |

## Stage 3

| ID     | Feature group                            | Status        | macOS evidence or gap                                                                                                                                                                                                                                             |
| ------ | ---------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S3-F1  | TypeScript and engineering foundation    | Ready         | Lint, formatting, TypeScript, build, and full automated gates passed on macOS.                                                                                                                                                                                    |
| S3-F2  | Product MCP implementation               | Ready         | Connection, exposure, read, mutation, approval, interruption, and recovery suites passed.                                                                                                                                                                         |
| S3-F3  | Permissions and approvals                | Ready         | Self-reference, inheritance, provider/product gate, approval lifecycle, and execution suites passed.                                                                                                                                                              |
| S3-F4  | MCP audit history                        | Ready         | Durable history, filtering, and viewer data tests passed.                                                                                                                                                                                                         |
| S3-F5  | Cross-agent spawning and orchestration   | Conditional   | Real Codex fork and budget enforcement passed. Bidirectional and mixed-provider orchestration is not certified because Claude live use is quota-blocked.                                                                                                          |
| S3-F6  | MCP management and safety UI             | Ready         | Exposure, connection, approval, audit, and renderer-refresh suites passed.                                                                                                                                                                                        |
| S3-F7  | Honest Settings surface                  | Ready         | Visibility and hidden-surface tests passed.                                                                                                                                                                                                                       |
| S3-F8  | Keyboard shortcuts                       | Ready         | Binding, conflict, persistence, reset, and runtime tests passed. The macOS voice shortcut no longer conflicts with the VoiceOver modifier, and the exact package passed a full 160-step Tab traversal. Owner signoff remains open.                                |
| S3-F9  | Voice Settings and streaming dictation   | Not certified | Streaming, immutable draft, history, settings, restart, and package tests passed. Real microphone record/stop and honest silent-input handling passed in Dev and Preview; device switching, recognition quality, cloud-engine coverage, and recovery remain open. |
| S3-F10 | Secure credentials                       | Ready         | The macOS Keychain implementation, migration, management, fail-closed, and provider-consumption tests passed. No plaintext fallback was found.                                                                                                                    |
| S3-F11 | Provider-scoped extensions               | Conditional   | Discovery, inventory, supported mutation, and isolation tests passed. Live provider extension loading is not certified for every supported runtime.                                                                                                               |
| S3-F12 | Permission mode promotion                | Ready         | Durable hierarchy, custom policy, project-only scope, restart, and enforcement tests passed.                                                                                                                                                                      |
| S3-F13 | Copy, navigation, and search consistency | Ready         | Product terminology, destination, copy, and search regressions passed.                                                                                                                                                                                            |
| S3-F14 | Usage hardening and exit                 | Conditional   | Secure macOS daemon lifecycle passed, including package smoke. Complete live provider attribution and dashboard truth remains credential-dependent.                                                                                                               |
| S3-F15 | Provider harness closeout                | Conditional   | Deterministic suites plus Codex, basic Cursor, and exact-Preview OpenRouter and NanoGPT text runs passed. Broader permissions, tools, resume, recovery, billing, and Claude live closeout remain open.                                                            |
| S3-F16 | Reasoning parity and evidence            | Conditional   | UI, persistence, timer, reload, search, deterministic failures, and credentialed OpenRouter/NanoGPT reasoning activity passed. Full Claude/Cursor and provider interruption/recovery evidence remains open.                                                       |
| S3-F17 | Integrated Stage 3 release               | Not certified | Full automated regression and live development startup passed. The exact Preview completed representative onboarding, provider, knowledge, voice, capture, keyboard, and multi-window flows; the single end-to-end promoted-candidate walkthrough remains open.   |

## Stage 4

| ID     | Feature group                    | Status      | macOS evidence or gap                                                                                                                                                                                                                                 |
| ------ | -------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S4-F1  | Unified skills and hooks manager | Ready       | Discovery, scope, enablement, sharing, safety, and manager UI suites passed.                                                                                                                                                                          |
| S4-F2  | Project knowledge vaults         | Ready       | Browser, editor, search, run context, approved operations, recovery, and graph-index regressions passed.                                                                                                                                              |
| S4-F3  | Multi-agent operations           | Conditional | Fleet, lineage, messaging, control, workflows, recovery, and runtime activity tests passed. Complete Claude/Codex and mixed-runtime live coverage is open.                                                                                            |
| S4-F4  | Saved workspaces                 | Ready       | Lifecycle, recovery, layout, pane, transfer, pop-out, and orchestration ownership tests passed.                                                                                                                                                       |
| S4-F5  | Automation and scheduler         | Ready       | Triggers, approval, retry, budgets, kill, history, inbox, and management suites passed on macOS.                                                                                                                                                      |
| S4-F6  | Local models                     | Ready       | Real Ollama 0.33.0 catalog, persisted streaming and usage, read/write/shell tools, full-access and Ask before edits permissions, no-cloud-fallback, service-loss and selected-model-loss refusal, recovery retries, and packaged Preview Chat passed. |
| S4-F7  | Advanced usage and limits        | Conditional | Provenance, rollup, forecast, budget, alert, explorer, and export tests passed. Complete forecasts still depend on live provider data.                                                                                                                |
| S4-F8  | Import, export, and private sync | Ready       | Secret-safe export and transactional import/recovery tests passed. A real user-owned private GitHub remote passed scoped link, preview, commit, push, independent update, pull, content verification, and unlink without Actions or excluded data.    |
| S4-F9  | Plan and Kanban views            | Ready       | Plan, task-card, promotion, proposal, provenance, divergence, and cross-window suites passed.                                                                                                                                                         |
| S4-F11 | Agent runtimes                   | Conditional | Runtime adapters, settings, timeline, controls, privacy, and continuation tests passed. Codex live proof passed; Claude, OpenCode/native, and mixed-runtime capability rows remain open.                                                              |
| S4-F12 | Agent profiles and personalities | Ready       | Lifecycle, Profile Studio, immutable resolution, workflow, launch, evaluation, migration repair, and live Codex profile resolution passed.                                                                                                            |

## Stage 5

Stage 5 is the native Windows compatibility stage. Windows-only acceptance is
not a macOS blocker. Shared and equivalent macOS behavior is still checked
below.

| ID    | Feature group                        | Status        | macOS evidence or gap                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S5-F1 | Supported Windows toolchain          | N/A           | Windows support diagnostics do not define macOS readiness. This audit used the repository's supported Node 22 macOS toolchain.                                                                                                                                                |
| S5-F2 | Portable build scripts               | Ready         | Shared script, lock, quoting, cancellation, and logging tests passed on macOS.                                                                                                                                                                                                |
| S5-F3 | Native dependency install            | Ready         | Install, repair, download, ABI, `node-pty`, and `better-sqlite3` checks passed on Apple Silicon.                                                                                                                                                                              |
| S5-F4 | Windows CI and development lifecycle | N/A           | Windows CI is unrelated. The macOS development lifecycle passed locally, but the gated hosted macOS CI lane has not run for this snapshot.                                                                                                                                    |
| S5-F5 | Windows OS integration               | N/A           | DPAPI, PowerShell, Task Scheduler, and Windows process rules do not apply. macOS Keychain, shell, Finder/open actions, terminal, deep links, menu/history, and capture-permission adapters have automated coverage.                                                           |
| S5-F6 | Agent harness parity                 | Conditional   | Bundled provider resolution, Product MCP defaults, permissions, sessions, and cleanup passed. Full live provider and packaged UI parity remains open.                                                                                                                         |
| S5-F7 | Speech and voice parity              | Not certified | macOS packaged speech dependencies, Preview dictation, honest no-speech handling, Kokoro playback, and Native OS Voice playback passed. Device switching, recognition quality, full cloud-engine/voice selection, cache recovery, and broader lifecycle evidence remain open. |
| S5-F8 | Windows packaging and security       | N/A           | NSIS, portable EXE, Authenticode, and Defender are Windows-only. macOS distribution readiness is tracked under S6-F10.                                                                                                                                                        |
| S5-F9 | Integrated Windows release           | N/A           | Windows VM, upgrade, recovery, uninstall, and owner walkthroughs do not define macOS readiness.                                                                                                                                                                               |

## Stage 6

| ID     | Feature group                                        | Status        | macOS evidence or gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ---------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S6-F1  | Product polish and feature visibility                | Not certified | Deterministic coverage passed. Real VoiceOver semantics, the fixed VoiceOver/voice-hotkey conflict, a full 160-step exact-package Tab traversal, light/dark themes, Reduce Motion, 200% responsive zoom, and layout restoration passed. Formal contrast measurements, the full layout/device matrix, and owner visual review remain open.                                                                                                                                                                                                                                                                                                                                                                   |
| S6-F2  | Guided onboarding                                    | Ready         | Automated coverage passed. Disposable exact-Preview profiles passed Focused, Standard, Complete, skip, cancel, interrupted restart/resume, rerun, tutorial, preset reversal, and upgrade-preserved paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| S6-F3  | Agent Profiles and reusable personalities            | Ready         | Authoring, import/export, resolution, scope, snapshots, starter versioning, and real Codex profile selection passed. Optional Claude comparison is externally blocked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| S6-F4  | Cross-agent mobile companion                         | Not certified | Pairing, replay, revocation, event-gap, network, session, and accessibility logic tests passed. Real iOS and Android-class devices on a private LAN were not tested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S6-F5  | Visual context and screenshot capture                | Not certified | Real macOS Screen Recording, source enumeration, window capture, redaction, confirmed hash/provenance/retention, history, and composer attachment passed. Deterministic cancellation, export, missing-byte, and tamper refusal tests passed. Multi-display, protected surfaces, and the standalone packaged helper remain open.                                                                                                                                                                                                                                                                                                                                                                             |
| S6-F6  | Multi-pane Chat and swarm workspaces                 | Not certified | Layout, transfer, window budget, persistence, recovery, group, and control suites passed. The exact installed package rendered four accessible Chat panes, passed keyboard traversal and real input, restored its layout, released a closed Chat into native `window-2`, and restored separate main/auxiliary ownership after restart. Native drag and cross-window transfer, the four-window/display/crash matrix, and owner review remain open.                                                                                                                                                                                                                                                           |
| S6-F7  | Runtime and cross-provider orchestration composition | Conditional   | Runtime resolution, retry, budget, stop, and Codex live orchestration passed. Bidirectional Claude/Codex and packaged-target evidence remains open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| S6-F8  | Organization usage APIs                              | Conditional   | Credential storage, adapter, dashboard, daemon, and failure-path tests passed. Live organization Admin credentials were not available.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| S6-F9  | Performance and scale                                | Not certified | All 46 minimum-supported budgets, macOS product adapters, native exact-process Electron probes, an exact-package four-pane input sample, and a 10,000-note packaged UI load passed. Real sleep/wake recovery and a 24-hour soak remain open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| S6-F10 | Cross-platform public distribution                   | Not ready     | Apple Silicon Preview and x64 cross-package inspection pass, including packaged native modules under Rosetta. The app remains unsigned, not notarized or stapled, and has not passed Gatekeeper, clean install/upgrade/rollback/uninstall, native Intel provider smoke, hosted exact-candidate CI, or final owner release review.                                                                                                                                                                                                                                                                                                                                                                           |
| S6-F11 | Integrated Stage 6 owner satisfaction                | Not certified | Automated integrated gates passed. The independent exact-candidate journey across package, devices, providers, capture, and knowledge graph has not been performed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| S6-F12 | Obsidian-compatible project knowledge graph          | Conditional   | Automated coverage passed. Real Obsidian completed app-managed and project-owned edit/adopt/link/tag/write-back, an authored Unicode/frontmatter/Wikilink/heading/block/embed/relative-link fixture, external rename/move/delete with stable selection and draft restoration, verified PNG upload/rename/move/trash/restore, exact conflict diff/Keep both/adopt, restart recovery, and exact derived-index deletion/rebuild. Native and installed-Preview 10,000-note lanes passed, including exact UI generation/fingerprint proof, responsive final-note filtering, integrity checks, and corrupt-profile recovery without destructive reset. Only the exact promoted-artifact walkthrough remains open. |

## Not-ready and not-certified register

These are the macOS claims that must not be presented as complete today:

1. **Public distribution, S6-F10:** not ready against the Stage 6 stable public
   distribution contract. The intentionally unsigned `0.1.0` beta described in
   [releasing-macos.md](releasing-macos.md) can still be built and distributed
   with its explicit warning, but it is not signed, notarized, or stable-release
   certified.
2. **Packaged UI journeys, S3-F17, S5-F6, S6-F6, S6-F7, S6-F11:** binary and
   daemon smoke passed, and the exact Preview app passed representative
   onboarding, provider, knowledge, voice, capture, and four-pane workflows.
   Native auxiliary-window creation and restart restoration now pass after a
   stale ownership defect was fixed. The complete integrated workflow, native
   drag/cross-window transfer, and full window-limit/display/crash matrix remain
   open.
3. **Voice, S2-A, S3-F9, S5-F7:** microphone permission, record/stop, honest
   silent-input handling, Kokoro playback, and Native OS Voice playback now
   pass in the exact Preview package. Input-device switching, transcription
   quality, cloud-engine and voice selection, cache recovery, and broader
   lifecycle recovery are not certified.
4. **Accessibility and UI experience, S1-C, S3-F8, S6-F1, S6-F6:** basic real
   VoiceOver semantics, VoiceOver-safe dictation shortcuts, a full exact-package
   Tab traversal, light/dark themes, Reduce Motion, 200% responsive zoom, and a
   native auxiliary window with restart restoration now pass. Formal contrast,
   the full layout/device/window matrix, native drag/transfer, and owner checks
   remain open.
5. **Mobile, S6-F4:** no real iOS or Android-class device proof exists.
6. **Visual capture, S6-F5:** real Screen Recording, one-display source
   enumeration, redaction, persistence, history, and composer attachment now
   pass. Deterministic cancellation, export, missing-byte, and tamper refusal
   also pass. Multi-display, protected-content, and the standalone helper's
   native package/lifecycle proof are open; no helper executable is currently
   present in the installed app.
7. **Performance and lifecycle, S6-F9:** native exact-process macOS orchestration
   now passes. Sleep/wake, lock/unlock, network recovery, and a 24-hour soak
   remain open.
8. **External providers, S2-B, S2-D, S2-E, S2-T, S3-F5, S3-F11, S3-F14,
   S3-F15, S3-F16, S4-F3, S4-F7, S4-F11, S6-F7:** Codex has live macOS proof.
   Claude is blocked by the account spend limit. Cursor now has a basic live
   Flapstack Chat proof, but its full matrix remains open. Exact-Preview
   OpenRouter and NanoGPT text/reasoning, read-tool, and cancellation runs now
   pass after widening first-run sidecar deadlines. NanoGPT continuation and
   recovery pass after removing impossible cross-sidecar session forks, and the
   shared sanitizer now strips hidden Product MCP envelopes. The exact Preview
   also completes a newly created global OpenRouter Chat through an isolated
   app-owned runtime directory while keeping its project and Chat worktree
   null. OpenRouter DeepSeek V4 Pro and NanoGPT GLM Latest also pass isolated
   write and shell allow-once prompts plus explicit edit rejection, with durable
   decisions and correct file outcomes. NanoGPT DeepSeek Latest returned
   malformed model output without a tool call in two write attempts, so that
   model-specific lane remains open. A clean global OpenRouter continuation now
   returns the exact requested text with resumed context and no Product MCP
   marker. Network recovery, billing, OpenCode/native composition, and
   mixed-provider flows lack complete proof.
9. **External services and remotes, S6-F8, S6-F12:** private sync now passes a
   real user-owned private GitHub link/push/pull/unlink flow without Actions or
   excluded data. Organization Admin usage is not certified. Obsidian has live proof in
   both storage modes, real authored Markdown-subset coverage, external
   rename/move/delete, attachment handling, conflict recovery, automatic
   Flapstack refresh, restart, and derived-index deletion/rebuild.
   The native index also passed at the declared 10,000-note limit.
   The installed Preview passed app-managed vault creation, graph build,
   custom-note create/edit/save, graph refresh, and a fresh project-owned real
   Obsidian create/link/tag/watch round trip. A separate installed profile
   passed the 10,000-note UI, final-note filtering, exact generation/fingerprint
   persistence, and non-destructive corrupt-profile recovery lanes. Only the
   exact promoted-artifact walkthrough remains open.
10. **Architecture coverage, S5-F3, S6-F10:** Apple Silicon passed. Intel x64
    cross-packaging, exact binary inspection, and packaged native-module smoke
    pass under Rosetta. Native Intel provider and full package smoke remain
    open because Apple Silicon Rosetta does not provide equivalent AVX hardware
    behavior.
11. **Hosted candidate proof, S5-F4, S6-F9, S6-F10:** the gated macOS CI lane
    has not produced and tested this exact snapshot.

No additional known macOS core implementation defect was found by the full
automated gate, live development verification, Codex live run, database checks,
or Apple Silicon Preview smokes. That is narrower than claiming every feature
works: all Conditional and Not certified rows still need the named environment
or owner evidence.
