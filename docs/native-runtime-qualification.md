# Native runtime qualification

## Windows packaged acceptance

On 2026-09-29 UTC, a hidden Flapstack Preview package passed the owned-profile
qualification with direct Runtimes enabled by the normal release policy. The
package contained Electron 41.10.7, Codex CLI 0.153.4, Claude Code 2.1.284, and
Claude Agent SDK 0.3.207. The binary smoke and Windows package security audit
also passed.

- Codex used `gpt-5.5` with low effort. Claude used `claude-opus-5-5` with
  medium effort.
- Each provider completed an exact bounded reply, continued with a second exact
  reply in the same provider session, and persisted the expected transcript and
  provider identity.
- Each provider started a third turn in that same session that was cancelled
  and durably recorded as cancelled.
- A full app restart preserved both completed replies without replaying a turn.
- The qualification disabled MCP servers, requested read-only authority, and
  observed no tool, command, or patch activity.
- The hidden app exited cleanly, removed copied credentials, deleted its owned
  profile, and left the user's profiles and credentials unchanged.

This evidence qualifies direct Codex and Claude Code for new production
launches on Windows. Runtime probes continue to fail closed when authentication,
the pinned binary, or the supported protocol is unavailable. Other operating
systems retain their platform-specific package qualification requirements.

Evidence captured on 2026-09-20 UTC in isolated Windows worktrees. These checks
used synthetic input and owned databases, not a production Flapstack profile.
Live turns requested no tools and disabled MCP. The production app checks also
verified zero tool, command or patch activity. No user settings or credentials
were changed. This is bounded evidence, not full feature acceptance.

## Actual native transport

- Pinned Codex 0.153.4: authenticated account/model discovery, direct adapter
  session/thread/turn, normalized activity, completion, archive, cleanup and
  fresh-adapter exact-turn reconciliation passed. An archived `notLoaded` thread
  with an authoritative completed turn exposed a recovery defect; the fix and
  regression retain strict thread/turn identity checks. Live interrupted turns
  also reject completion instead of silently succeeding.
- Pinned Claude 2.1.207 with Agent SDK 0.3.207: the tool-free turn returned an
  authoritative failed result and the adapter rejected completion. Fresh
  `claude auth status` reports `loggedIn: false`, `authMethod: none`, and
  `apiProvider: firstParty`. Installed Claude 2.1.261 reports the same state.
  A credential file's presence did not establish authentication. At the time,
  successful native Claude execution and same-session continuation were blocked
  on supported sign-in; neither was claimed from fixture results.

## Actual production app lifecycle

The hidden Windows Electron app built from
`3f88136ca53817fc388012c1b73e4f6117f243b9` used a fresh owned profile and synthetic
Git repository. The production interactive Runtime route and `MainRunLauncher`
persisted `codex-enhanced` as the requested preference and direct `codex` as the
resolved Runtime, adapter `1`, protocol `0.153.4`. Read-only permission and the
owned project's supported extension policy disabled both discovered MCP servers.

- A fresh tool-free nonce turn completed successfully with 41 persisted activity
  events and one provider turn identity.
- The same Chat resumed its archived native thread. Cancellation followed a
  distinct matching `turn-started` event; the production cancellation route
  returned true and persisted `cancelled`, with 20 activity events and one
  distinct provider turn identity. Neither turn produced tool/command/patch
  events.
- The exact assistant nonce rendered after reload and full app restart. Both
  run rows and original messages remained identical, with exactly two runs and
  no replay. No renderer exceptions occurred; the owned app exited cleanly.

Earlier failed preparations remain retained. The production release gate first
refused launch before any turn; the existing
`FLAPSTACK_ENABLE_UNVERIFIED_NATIVE_RUNTIMES=1` qualification flag was then set
only in that historical owned child environment. Discovery incorrectly treated nested MCP
environment tables as server names; the narrow parser correction was verified
with fixtures and the subsequent actual app launch.

A prior successful turn was followed by a 30-second unarchive timeout before a
second turn started. A no-turn inspection restored the exact owned thread in
17.5 seconds, then re-archived it. The
[pinned Codex implementation](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server/src/request_processors/thread_processor.rs)
requires restoration before resuming archived sessions. The adapter now only
restores after the exact archived-session rejection, preserves that error if
restoration fails, and allows 60 seconds specifically for restoration; ordinary
requests retain 30 seconds. The final successful two-turn check above verifies
the integrated correction. Focused adapter/recovery tests passed 48 tests;
the integrated check passed 4,517 tests plus 11 Windows tests and the build.

This historical check proved the bounded development-app lifecycle, not
installed-package acceptance or every native event variant. At that point,
production defaults remained gated and authenticated Claude behavior had not
been established. The later packaged acceptance above closes those Windows
release gates.

## Actual native delegation target

The existing `CrossProviderDelegationService` used an owned SQLite database with
a synthetic Claude source chat and the real pinned Codex adapter as its target.
The launch port connected the broker to the adapter; this was not an Electron
or production `MainRunLauncher` walkthrough.

- Exact preview confirmation created a distinct child with source lineage.
- Repeating the same request reused its child/run: one adapter launch occurred.
- The real target produced session, thread and turn identity, 28 normalized
  events, authoritative adapter completion and a successful broker result.
- The persisted target was native `codex`, adapter version `1`, protocol
  `0.153.4`. Reopening the broker retained the successful result and parent
  lineage with zero provider calls.

The source was a fixture, not a live Claude session. This proves one authorized
native target path; it does not prove bidirectional live provider execution,
production activity persistence, structured-output barriers, live cancellation,
or source-deletion behavior. Those broader boundaries have fixture coverage.

## Remaining acceptance by source task

The later production delegation check used a labeled synthetic Claude source and
one real read-only Codex Enhanced target, with GPT-5.5 and discovered MCP servers
disabled through the owned project policy. Its successful broker result and exact
run identity survived a full restart without replay. This does not establish a
live authenticated Claude source or reverse delegation.

That check exposed an empty child transcript: the broker persisted the prompt in
the run and output in activity, but neither in child messages. The repair writes
the approved prompt at creation and accepted completed public text after the
successful result barrier, using the existing assistant-history persistence.
Stream fragments, private/redacted output and rejected results are excluded from
that assistant projection. Already-terminal children created before this repair
are not backfilled; their broker result remains available.

Actual-app verification of the repair passed at
`807b046af9da5441325fe1d6a84a721b44b956c2`. Exactly one fresh production delegation
turn completed with 45 persisted activity events, GPT-5.5, requested Codex
Enhanced resolved to Codex, read-only authority, two discovered MCP servers
disabled, and no tool activity. The child displayed the approved prompt and exact
accepted reply before and after a full owned-profile restart. Its two persisted
messages retained the exact prompt/run linkage; source history, parent/project
lineage, successful result and single-run/single-attempt counts stayed unchanged.
There were no page errors or replay, and the hidden app closed cleanly. The
historical qualification used the existing child-only unverified-runtime flag;
it did not change release defaults or establish installed-package acceptance.

| Source task | Evidence and remaining boundary                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S4-F11-T4   | Actual pinned adapter and production-app completion, same-session continuation, cancellation, persisted identity and restart above; Windows packaged qualification now passes. Every possible live event variant remains outside this bounded check.          |
| S4-F11-T5   | SDK fixtures and truthful historical failure verified. Packaged authenticated Claude completion, same-session continuation, cancellation and restart now pass on Windows; fork remains covered by deterministic tests rather than this packaged flow.         |
| S4-F11-T6   | Existing Native compatibility/history fixtures verified. No claim that a direct Codex probe proves the separate ACP or legacy Claude transport path.                                                                                                          |
| S4-F11-T7   | Existing timeline/activity fixtures verified. Actual multi-window/native UI comparison and recorded 10k rendering acceptance are not established by transport checks.                                                                                         |
| S4-F11-T8   | Resolver/selection/continuation fixtures verified. Independent actual Board/Plan/worktree replay preserved original idle context, provider/Runtime selection, one linked Chat and zero runs through full restart. Started-chat continuation remains separate. |
| S4-F11-T9   | Existing registry/main-launcher/orchestration fixtures and actual interactive native launch above. Broker proof still uses a scoped launch port; not every production launch entrypoint was exercised live.                                                   |
| S6-F7-T2    | Actual native Codex target, exact preview, persisted versions and one-owner/idempotency proof above. Actual Claude target remains auth-blocked.                                                                                                               |
| S6-F7-T3    | Actual child/result persistence and broker reopening above; both-direction live execution and native navigation remain unverified.                                                                                                                            |
| S6-F7-T6    | One authorized native target path and truthful restart verified; affected cancellation/recovery/preview fixture coverage is retained. No translated-provider or multi-platform package claim.                                                                 |

Runtime regression evidence: 29 files / 462 tests passed before the final
interruption correction; the final affected slice passed 3 files / 54 tests.
Scoped lint, formatting and TypeScript checks passed for the runtime fix.
Sanitized live-probe summaries remain in the qualification worktree's ignored
`.local-evidence` directory; provider IDs and private raw logs are not committed.
