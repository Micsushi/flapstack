# Stage 3 Usage exit matrix

Frozen: 2026-07-13. Authority: `harden-usage-exit` S3-F14-T1 through T5.

This is the executable evidence map for migrated Usage rows U1 through U11. It
contains no completion checkboxes and is not a second task board. The OpenSpec
`tasks.md` file alone owns completion. Evidence runs use PASS, FAIL, BLOCKED,
UNAVAILABLE, or UNSUPPORTED and never infer one platform or credential from
another.

Run `npm run check:usage-exit-matrix` to prove every migrated row and every
`usage-exit-hardening` scenario remains mapped.

## Frozen rules

- Required: must pass on the Stage 3 SHA in the named local environment.
- Conditional: must be attempted only when the named credential, account, OS,
  or provider capability exists. Otherwise record BLOCKED or UNAVAILABLE with
  the exact missing prerequisite.
- Unsupported: valid only when the tested target has no declared adapter or the
  provider exposes no applicable API. It must include the product's visible
  limitation. No migrated row is permanently waived as unsupported.
- PASS requires the exact observation and sanitized artifact named below. A
  fixture cannot pass a live, package, credential, or OS row.
- FAIL means the prerequisite existed and the observed behavior violated the
  row. BLOCKED means another Stage 3 task is incomplete. UNAVAILABLE means the
  external credential/account/OS was not available. UNSUPPORTED means the
  product or provider explicitly reports that target as unsupported.
- Secrets use disposable or low-value accounts. Never place a credential or
  webhook in argv, logs, screenshots, SQLite raw payloads, shell history, or
  committed files. Record presence, service/account labels, and redacted hashes
  only.
- Destructive tests use a unique profile, database, service label/task/unit,
  Keychain/Credential Manager/Secret Service account, and Discord webhook. The
  evidence run must record cleanup.
- Artifact root: `.artifacts/stage3/usage-exit/<run-id>/`. This path is local and
  sanitized; committed evidence records may name files but must not contain
  secret values or raw provider payloads.

## Contract keys

- DUC: Deterministic Usage Collection
- DUP: Durable Usage Provenance
- SDL: Safe Closed-App Daemon Lifecycle
- RBA: Reliable Background Alerts
- TUE: Truthful Usage Exit Evidence

## Scenario coverage

| ID    | Scenario                              | Contract | Evidence rows                  |
| ----- | ------------------------------------- | -------- | ------------------------------ |
| SC-01 | App and daemon overlap                | DUC      | U1-02, U2-01, U3-01            |
| SC-02 | One provider hangs or fails           | DUC      | U2-02, U11-05                  |
| SC-03 | App restarts after a collection gap   | DUC      | U5-01                          |
| SC-04 | Strong and weak cost data collide     | DUP      | U1-03, U8-02                   |
| SC-05 | Exact provider cost is unavailable    | DUP      | U1-02, U8-03, U9-01            |
| SC-06 | Shared database is busy or corrupt    | DUP      | U4-01, U11-05                  |
| SC-07 | Daemon collects while app is closed   | SDL      | U3-01                          |
| SC-08 | Credential persistence is unavailable | SDL      | U3-01, U3-04, U11-02           |
| SC-09 | Daemon is disabled or uninstalled     | SDL      | U3-02, U3-03                   |
| SC-10 | Delivery fails then recovers          | RBA      | U10-02, U10-03                 |
| SC-11 | Per-run spend crosses a threshold     | RBA      | U10-04                         |
| SC-12 | User inspects Usage                   | TUE      | U11-01, U11-03, U11-05         |
| SC-13 | Evidence is unavailable               | TUE      | all conditional rows and U3-03 |
| SC-14 | Usage exit is declared complete       | TUE      | final S3-F14 evidence run      |

## Migrated row map

| Row    | Class and owner                                 | Contract      | Evidence method and exact observation                                                                                                           | Prerequisite and isolation boundary                               | Sanitized artifact                                               |
| ------ | ----------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| U1-01  | Required; T2                                    | DUC, TUE      | Node 22 migration test; all Usage tables query and seeded pre-Stage-2 data remains                                                              | Disposable SQLite copies only                                     | `automated/migrations.txt`                                       |
| U1-02  | Required; T2                                    | DUC, DUP      | focused store test; app/daemon overlap yields one stable row and unknown-price tokens retain null cost                                          | in-memory or disposable SQLite                                    | `automated/store-dedupe.txt`                                     |
| U1-03  | Required; T2                                    | DUP           | focused store tests; weaker or metadata-only collisions preserve stronger cost, run link, tokens, model, and redacted raw fields                | synthetic payloads with sentinel secrets                          | `automated/provenance.txt`                                       |
| U2-01  | Required; T2                                    | DUC           | engine fixtures in app and daemon modes produce equivalent normalized samples and explicit provider states                                      | fake providers; no network                                        | `automated/engine-modes.txt`                                     |
| U2-02  | Required; T2                                    | DUC, TUE      | request and body deadlines fail visibly; later providers still store samples                                                                    | fake endpoints only                                               | `automated/provider-deadlines.txt`                               |
| U3-01  | Required macOS; T3                              | SDL           | installed isolated LaunchAgent writes one heartbeat and sample while app is closed; reopening reads it; forced secure-store failure is rejected | blocked by S3-F10-T4; unique profile/service/DB/credential        | `macos/closed-app/`                                              |
| U3-02  | Required macOS; T3                              | SDL           | disable/uninstall stops heartbeat and `launchctl print` confirms no job or process remains                                                      | isolated service only; record before/after process inventory      | `macos/uninstall/`                                               |
| U3-03  | Conditional Windows/Linux; T3                   | SDL, TUE      | native target installs, polls closed-app, disables, and proves no task/unit/wrapper/process remains                                             | actual Windows and Linux hosts plus native secret stores          | `windows/daemon/`, `linux/daemon/`                               |
| U3-04  | Required macOS Electron; T3                     | SDL           | no-TTY probe writes via stdin, reads, and deletes one unique Keychain item; secret absent from argv and output                                  | blocked by S3-F10-T4; never touch real Flapstack/provider entries | `macos/keychain-probe/`                                          |
| U4-01  | Required; T2                                    | DUP, TUE      | WAL/busy retry succeeds after transient locks; exhausted lock/corruption rejects and surfaces an error                                          | disposable SQLite and forced faults                               | `automated/sqlite-faults.txt`                                    |
| U5-01  | Required; T2 then T4                            | DUC, TUE      | tests prove persisted generation backoff/terminal/reset; verified dev gap refresh shows historical recovery and limited-provider gap text       | disposable profile; no invented history                           | `automated/reconciliation.txt`, `dev/gap-refresh/`               |
| U6-03  | Conditional personal OAuth; T4                  | DUP, TUE      | Codex and Claude quota windows remain distinct with opaque account tags and private-source labels                                               | existing test login; no OAuth token capture                       | `providers/personal-oauth/`                                      |
| U7-01  | Conditional Cursor login; T4                    | DUC, TUE      | default-account card/state agree; `internal` remains provenance, not account identity                                                           | disposable Cursor profile if possible                             | `providers/cursor-internal/`                                     |
| U7-02  | Conditional Cursor login/token; T4              | DUP, TUE      | plan, grants, balance, requests/models, refresh, and manual fallback match sanitized source evidence                                            | never expose local Cursor token                                   | `providers/cursor-sources/`                                      |
| U8-01  | Conditional OpenRouter key; T4                  | DUP, TUE      | key balance and per-token model prices produce nonzero per-million estimates; UI says run usage plus balance                                    | low-limit key                                                     | `providers/openrouter-balance/`                                  |
| U8-02  | Conditional OpenRouter run; T4                  | DUC, DUP      | every official generation ID persists; exact reconciliation upgrades only its matching run sample                                               | cheapest tested model; cap spend                                  | `providers/openrouter-generation/`                               |
| U8-03  | Required; T2                                    | DUC, DUP      | focused reconciliation test; 404 is terminal, transient/malformed responses back off, later generations continue, reset re-enables retry        | fake endpoint only                                                | `automated/openrouter-reconcile.txt`                             |
| U8-04  | Required; T2 then T4                            | TUE           | formatter test and verified dev card show USD values, never stored micro-dollar integers                                                        | synthetic key-limit sample                                        | `automated/quota-format.txt`, `dev/openrouter-card/`             |
| U9-01  | Conditional NanoGPT key; T4                     | DUP, TUE      | live model prices use per-million units; one run estimate matches displayed rates and remains estimated absent exact cost                       | cheapest tested model; cap spend                                  | `providers/nanogpt-run/`                                         |
| U9-02  | Required; T2 then T4                            | TUE           | capability fixture and live copy state run-usage-only unless a verified history API exists                                                      | no credential needed for fixture                                  | `automated/nanogpt-capability.txt`, `dev/nanogpt-copy/`          |
| U10-01 | Required macOS; T3                              | RBA, SDL      | closed-app threshold crossing produces one Discord event and persisted delivery visible after reopen                                            | disposable webhook and isolated daemon profile                    | `macos/closed-app-alert/`                                        |
| U10-02 | Required; T2                                    | RBA           | focused evaluator/store test; falling below band re-arms and one later crossing sends once                                                      | fake webhook                                                      | `automated/alert-rearm.txt`                                      |
| U10-03 | Required; T2                                    | RBA           | fake Discord 500 persists failed delivery, stays armed, retries, then sends exactly once                                                        | fake webhook; sentinel URL redaction                              | `automated/alert-retry.txt`                                      |
| U10-04 | Conditional OpenRouter/NanoGPT; T4              | RBA, DUP      | completed provider run routes one exact/estimated aggregate through shared alert runner with quality label                                      | low-value key plus disposable webhook                             | `providers/run-spend-alert/`                                     |
| U11-01 | Required verified dev; T4                       | TUE           | cards, filters, paging, states, cost quality, samples/cycles/alerts all match SQLite                                                            | `npm run dev:verify`; disposable profile/DB                       | `dev/dashboard-overview/`                                        |
| U11-02 | Required verified dev; T4                       | SDL, TUE      | cadence, toggles, thresholds, write-only credentials, webhook, daemon state, and Refresh work without file edits                                | blocked credential persistence subpaths wait for S3-F10-T4        | `dev/usage-settings/`                                            |
| U11-03 | Required verified dev; T4                       | TUE           | quota/cost/token charts follow filters and omit missing buckets rather than drawing zero                                                        | seeded disposable history                                         | `dev/history-charts/`                                            |
| U11-04 | Required fixture plus target observation; T2/T4 | SDL, TUE      | unsupported-platform fixture and visible UI disable/explanation occur before install                                                            | no service mutation on unsupported target                         | `automated/platform-capability.txt`, `dev/unsupported-platform/` |
| U11-05 | Required; T2 then T4                            | DUC, DUP, TUE | forced query/provider/refresh faults show error/limited states distinct from empty/zero; later healthy data remains usable                      | fake providers and disposable/corrupt DB copy                     | `automated/error-states.txt`, `dev/fault-visibility/`            |

## Evidence run record

Append one record per automated, dev, daemon, package, provider, or platform run.
The final S3-F14-T5 record references the final commit and all earlier artifacts.

```text
Run ID:
Date and time:
Commit:
OS and architecture:
Node and Electron version:
Dev or package:
Executable and profile:
Database:
Row IDs:
Result per row:
Blocked, unavailable, or unsupported reason:
Provider and CLI versions:
Sanitized artifacts:
Cleanup:
Notes:
```

## Current dependency truth

S3-F14-T1 and deterministic S3-F14-T2 are complete. S3-F10 credential code is
integrated, but S3-F10-T4 remains formally open. This lane passed an isolated
macOS no-TTY Keychain write/read/delete probe and a packaged LaunchAgent
lifecycle smoke, but it did not prove a credentialed closed-app provider sample
or the Windows/Linux secret stores. Those rows and locked-UI credential rows
remain blocked rather than inferred. Windows and Linux remain UNAVAILABLE until
observed on those targets. OpenAI and Anthropic Admin usage validation is
deferred to `docs/future-release-considerations.md` and is not a Stage 3 row.

## 2026-07-13 safe headless and package evidence

- Base: `5297ed7`; isolated branch/worktree `codex/s3-f14-usage-exit` at
  `/Users/michaelshi/.codex/worktrees/e899/flapstack`. The final commit is
  reported at handoff after verification.
- Automated: 107 focused Usage/credential tests passed. Matrix coverage passed
  with 29 rows and 14 scenarios. Production build passed. The daemon smoke
  proved singleton ownership, duplicate rejection, forced-crash stale-lock
  recovery, restart, clean stop, cleared PID, and temporary-profile cleanup.
  Node 22 `npm run check` passed with 102 test files, 745 tests passed, and 3
  credential-conditional tests skipped.
- Provider truth: read-only local personal OAuth probes returned one Codex and
  two Claude provider-reported quota samples. Cursor was `not-logged-in`;
  OpenRouter and NanoGPT were `not-configured`. No paid generation ran and no
  credential value was printed or persisted in evidence.
- Verified dev: port 5173 was owned by another worktree and the launcher failed
  closed without killing it. Port 5174 with `FLAPSTACK_DEV_INSTANCE=e899`
  passed `dev:verify` for this checkout and the isolated `Flapstack Dev e899`
  profile, applied 20 migrations, exposed the Usage tables, and shut down
  cleanly. The auth callback port was occupied on the first run; the final
  restart listened successfully.
- Preview: unsigned macOS arm64 Preview build, binary inspection, bundled
  Claude 2.1.207, Codex 0.144.1, Whisper, and Parakeet smoke passed. The exact
  bundle process launched, and its packaged main bundle contains the new daemon
  singleton guard. The locked Mac prevented main initialization: the process
  never opened or migrated the Preview database, whose pre-existing profile
  remained at 19 migrations versus the final dev profile's 20. Cleanup left no
  Preview process or product Usage LaunchAgent.
- Still open: visual dashboard/history/alerts/filter/paging/fault evidence on
  the locked Mac; persisted Keychain credential plus real LaunchAgent
  closed-app cadence and Discord delivery; packaged Preview main initialization
  and migration; credentialed Cursor/OpenRouter/NanoGPT rows;
  Windows/Linux service, secret-store, and package evidence; final commit-bound
  rerun.

## 2026-07-13 integrated-candidate continuation

Authenticated MCP read the bounded live Usage surface and production store. The
isolated profile reported 50 current local samples, zero provider-state rows,
unknown daemon state, and no OpenAI, Anthropic, Cursor, OpenRouter, or NanoGPT
credential. Returned samples excluded `rawPayload` and dedupe material. No
credentialed refresh, Keychain, real LaunchAgent, visual dashboard, alert,
Discord, Windows, or Linux claim is added; S3-F14-T3 through S3-F14-T5 stay open.

## 2026-07-13 c100 Usage closeout evidence

- Base: `821c9cd`; branch `codex/stage3-usage-exit-closeout`; worktree
  `/Users/michaelshi/.codex/worktrees/c100/flapstack`. The final commit is
  reported at handoff.
- macOS Keychain: a random unique value used service namespace
  `dev.flapstack.usage.usage-exit-c100`; the no-TTY write/read/delete probe
  passed, the value was absent from argv/output, and cleanup confirmed no item.
- Packaged daemon: the exact arm64 `Flapstack Preview.app` daemon bundle passed
  LaunchAgent closed-app start, heartbeat/poll, stop, new-PID restart, and exact
  job/plist/PID cleanup under the isolated
  `flapstack-preview-usage-exit-smoke` service. This proves U3-02 and the
  non-credentialed portion of U3-01 on macOS; it does not invent a provider
  sample or close S3-F10-T4.
- Provider truth: a fresh read-only probe returned one Codex `five_hour` and two
  Claude `five_hour`/`seven_day` personal-OAuth quota samples. All used
  provider-reported quality, private-source tags, and opaque account tags; no
  token or raw payload was printed.
- Verified dev: port 5175 with `FLAPSTACK_DEV_INSTANCE=c100` passed
  `dev:verify` for this checkout and the `Flapstack Dev c100` profile. Main
  initialized its database and migrations, then shut down cleanly. The Mac was
  locked during that dev run, so U11 visual/settings/history/fault comparisons
  remain BLOCKED.
- Preview startup: the exact arm64 Preview executable initialized the exact
  `Flapstack Preview` profile, applied 23 migrations, exposed the main window,
  and shut down cleanly. The window was inspectable, but clean no-project
  onboarding made Usage Settings unreachable; this is package startup PASS, not
  a U11 UI PASS. Cleanup found no exact Preview process, Usage job/plist, project
  row, or Usage sample.
- Final headless gates: Node 22 `npm run check` passed lint, Prettier,
  TypeScript, 125 test files with 931 passed and 3 credential-conditional
  skipped, and production build. Daemon smoke, packaged binary/sidecar smoke,
  packaged LaunchAgent lifecycle smoke, the 29-row/14-scenario matrix check,
  strict OpenSpec validation, and `git diff --check` passed.
- Conditional truth: Cursor login, OpenRouter/NanoGPT keys and a disposable
  Discord webhook were unavailable. No paid run or real
  webhook send occurred. Windows/Linux U3-03 remains UNAVAILABLE.

## 2026-07-13 credentialed provider refresh and Discord evidence

This bounded run used `Flapstack Dev stage3-finish` on live commit `0ac08de9`
whose source tree exactly matched lane base `f4c4ad4`. It is credential/path
discovery evidence only; repeat it on the final integration SHA.

- Manual Refresh succeeded for Codex, Anthropic, Cursor, and OpenRouter.
  NanoGPT returned the honest `run-usage-only` state and inserted no fictional
  account-history sample.
- The post-run samples reported Codex personal OAuth `five_hour` at 16%, Claude
  personal OAuth `five_hour` at 16%, Cursor internal `total_usage` at 63%, and
  OpenRouter key limits at 66% / `$0.656436`. NanoGPT retained per-run estimated
  provenance with a persisted run ID.
- OpenRouter account cost moved from `$0.653684` to `$0.656436`. The full
  `$0.002752` shared-account delta is charged conservatively to this lane even
  though the selected model was free and concurrent account use cannot be
  excluded.
- NanoGPT token/pricing arithmetic for the two successful
  `zai-org/glm-4.7-flash` runs is `$0.00110243`. Claude provider-reported run
  costs total `$0.395231`, including the blocked native-question probe. The
  conservative lane total is therefore `$0.39908543`; Cursor and Codex used
  personal quota with no attributable USD value.
- One Discord embed was delivered through the existing namespaced Keychain
  credential with HTTP 204. The webhook stayed on stdin, never appeared in
  argv/output, and was not copied. This proves one real transport delivery, not
  a persisted threshold-crossing alert event or closed-app daemon delivery.
- The Usage daemon remained healthy/running at 300-second cadence. No daemon,
  app, Electron, Preview, or UI-lease action occurred in this lane.

Final-integration rerun:

```text
refresh_usage_state {providerId: "codex"}
refresh_usage_state {providerId: "anthropic"}
refresh_usage_state {providerId: "cursor"}
refresh_usage_state {providerId: "openrouter"}
refresh_usage_state {providerId: "nanogpt"}
get_usage_state {}
```

Record before/after OpenRouter key-limit cost, exact run-linked OpenRouter and
NanoGPT samples, personal-quota percentages, daemon health, and limitations.
For Discord, read `discord.webhook_url` from the final profile's namespaced OS
credential store via stdin, post one bounded embed, emit only `{ok,status}`, and
expect HTTP 204. Never place or print the webhook in argv, environment, logs, or
evidence. U10 threshold/daemon persistence and Windows/Linux rows remain open.

## 2026-07-14 exact integration Usage rerun

Candidate `0a3d1af16777332dcbbe60134a4927c8dcff368b` passed
`npm run dev:verify` with `Flapstack Dev stage3-finish`.

- Manual refresh PASS: Codex inserted 1 sample, Anthropic 2, Cursor 2, and
  OpenRouter 2. NanoGPT inserted 0 and truthfully remained
  `run-usage-only`.
- Manual UI PASS before lock: Usage Settings rendered Codex, Claude, Cursor,
  and OpenRouter cards; Settings search for `usage` returned Usage and Share
  usage analytics.
- Discord transport PASS: one bounded embed returned HTTP 204. The namespaced
  Keychain value was read only in memory and did not appear in argv,
  environment, output, or tracked evidence.
- Exact unsigned arm64 Preview build, package inspection, clean-HOME bundled
  runtime smoke, startup, 23 migrations, main-window creation, clean shutdown,
  and cleanup PASS.
- Exact packaged Preview Usage LaunchAgent polling remained BLOCKED after the
  Mac locked. The launchd job started with the correct executable, arguments,
  and environment, but the locked GUI session never produced the daemon status
  row. Earlier unlocked lane evidence remains historical, not exact-SHA proof.
- Cleanup PASS: no exact Dev/Preview process, Usage job/plist, disposable
  profile, test project, Usage sample, or temporary sidecar remained.

Windows/Linux are deferred to the end of Stage 4. Admin usage keys and Apple
distribution signing/notarization are future considerations, not Stage 3 rows.
