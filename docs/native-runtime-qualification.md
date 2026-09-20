# Native runtime qualification

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
  A credential file's presence did not establish authentication. Successful
  native Claude execution and same-session continuation remain blocked on
  supported sign-in; neither is claimed from fixture results.

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
only in the owned child environment. Discovery incorrectly treated nested MCP
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

This proves the bounded development-app lifecycle, not installed-package
acceptance or every native event variant. Production defaults remain gated:
the documented pinned-protocol, live, restart and packaged-app requirements
have not all been met. Plain Codex preference and authenticated Claude behavior
are not inferred from the Codex Enhanced check.

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

| Source task | Evidence and remaining boundary                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S4-F11-T4   | Actual pinned adapter and production-app completion, resumed cancellation, persisted identity and restart above; fixture event/drift/permission coverage. Installed-package smoke and every live event variant remain unverified.                             |
| S4-F11-T5   | SDK fixtures and truthful actual failure verified. Successful native Claude/resume/fork and native app comparison require authenticated Claude.                                                                                                               |
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
