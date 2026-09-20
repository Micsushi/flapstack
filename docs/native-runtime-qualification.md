# Native runtime qualification

Evidence captured on 2026-09-20 UTC in isolated Windows worktrees. These checks
used synthetic input and owned databases, not a production Flapstack profile.
Provider tools and MCP were disabled for the live turns. No user settings or
credentials were changed. This is bounded evidence, not full feature acceptance.

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

| Source task | Evidence and remaining boundary                                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S4-F11-T4   | Actual pinned Codex lifecycle/restart above; fixture event, drift, permission and cancellation coverage. Full native app/package walkthrough and every live event variant are not established. |
| S4-F11-T5   | SDK fixtures and truthful actual failure verified. Successful native Claude/resume/fork and native app comparison require authenticated Claude.                                                |
| S4-F11-T6   | Existing Native compatibility/history fixtures verified. No claim that a direct Codex probe proves the separate ACP or legacy Claude transport path.                                           |
| S4-F11-T7   | Existing timeline/activity fixtures verified. Actual multi-window/native UI comparison and recorded 10k rendering acceptance are not established by transport checks.                          |
| S4-F11-T8   | Existing resolver/selection/continuation fixtures verified. Native app Settings/continuation walkthrough remains separate from the broker probe.                                               |
| S4-F11-T9   | Existing registry/main-launcher/orchestration fixtures verified. Broker proof uses a scoped launch port and does not imply every production launch entrypoint was exercised live.              |
| S6-F7-T2    | Actual native Codex target, exact preview, persisted versions and one-owner/idempotency proof above. Actual Claude target remains auth-blocked.                                                |
| S6-F7-T3    | Actual child/result persistence and broker reopening above; both-direction live execution and native navigation remain unverified.                                                             |
| S6-F7-T6    | One authorized native target path and truthful restart verified; affected cancellation/recovery/preview fixture coverage is retained. No translated-provider or multi-platform package claim.  |

Runtime regression evidence: 29 files / 462 tests passed before the final
interruption correction; the final affected slice passed 3 files / 54 tests.
Scoped lint, formatting and TypeScript checks passed for the runtime fix.
Sanitized live-probe summaries remain in the qualification worktree's ignored
`.local-evidence` directory; provider IDs and private raw logs are not committed.
