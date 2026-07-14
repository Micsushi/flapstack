# S3-F16 reasoning capability and evidence matrix

This matrix freezes request support, observable output classes, and evidence
grades for S3-F16. A fixture, recorded capture, CLI-live run, provider-live run,
UI-live run, and persisted reload are separate grades. Fixture success never
overrides a live failure. Never request or save hidden chain-of-thought.

## Evidence grades

| Grade         | Meaning                                                           |
| ------------- | ----------------------------------------------------------------- |
| Fixture       | Sanitized deterministic input is normalized in Vitest.            |
| Capture       | Sanitized output from a prior real invocation is replayed.        |
| CLI live      | Current installed harness emitted the shape outside Flapstack UI. |
| Provider live | Current credentialed provider completed the request.              |
| UI live       | The same live run rendered in verified Flapstack Dev.             |
| Reload        | The same live run reloaded from persisted message/run state.      |

## Frozen provider matrix

| Harness path                | Pinned/observed version                                                                 | Model cell                                                                               | Native request support                                                                                                             | Expected observable classes                                                                      | Current evidence                  | Live close condition                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Claude Agent SDK            | SDK `0.3.207`; bundled Claude Code `2.1.207`                                            | Exact live model must be recorded                                                        | Toggle: adaptive summarized thinking on/off. Effort is a separate SDK field.                                                       | Visible text or visible summary; absent is valid.                                                | Fixture                           | Provider live + UI live + reload on one Stage 3 SHA. Saved OAuth currently returns 401.                             |
| Codex ACP/App Server        | `@agentclientprotocol/codex-acp` `1.1.2`; ACP provider `0.3.3`; bundled Codex `0.144.1` | Exact selected catalog model and effort must be recorded                                 | Toggle and catalog-declared effort. Unsupported depth must map or omit with limitation.                                            | Thought chunks, visible summary, token-only, opaque/private, or absent.                          | Fixture + sanitized local capture | Provider live + UI live + reload after F10 credential and F15 harness gates.                                        |
| Cursor CLI                  | `cursor-agent` `2026.07.09-a3815c0`                                                     | `auto` capture; exact live model must be recorded                                        | No verified CLI reasoning toggle/effort flag. Flapstack may suppress display but must not claim provider computation was disabled. | Visible text deltas/final or absent.                                                             | Fixture + CLI live capture        | UI live + reload with current account/model; unavailable named reasoning models remain limitations.                 |
| OpenRouter through OpenCode | OpenCode `1.17.18`                                                                      | Exact provider-native model; catalog `supportsReasoning` required before fields are sent | Toggle/effort only for catalog-declared reasoning models. Unknown/unsupported models omit fields and record limitation.            | Visible text, visible summary, token-only, opaque/private, or absent.                            | Fixture                           | Provider live + UI live + reload after F10/F15; record request resolution and generation/model IDs without secrets. |
| NanoGPT through OpenCode    | OpenCode `1.17.18`                                                                      | Exact provider-native model; catalog `supportsReasoning` required before fields are sent | Same OpenCode control resolver as OpenRouter.                                                                                      | Current `reasoning`, legacy `reasoning_content`, summary, token-only, opaque/private, or absent. | Fixture                           | Provider live + UI live + reload after F10/F15.                                                                     |
| Local/custom                | Adapter-declared                                                                        | Exact adapter/model                                                                      | Unknown adapters default unsupported. A future adapter must declare toggle/effort capability.                                      | Visible text or absent; private state never inferred.                                            | Fixture                           | Conditional only; unavailable adapters remain explicitly blocked.                                                   |

## Stable scenario-to-test map

| Spec scenario                                                                              | Stable verification                                                                                            |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Visible, summary, token-only, opaque/private, absent, malformed, and legacy classification | `reasoning-output-contract.test.ts` plus provider JSON fixtures                                                |
| Delta, cumulative/final replay, and independent later parts                                | `reasoning-output-contract.test.ts` accumulator cases                                                          |
| Supported, mapped, and unsupported reasoning controls                                      | `reasoning-output-contract.test.ts`; `opencode-sidecar.test.ts`                                                |
| Provider errors remain errors                                                              | provider router/sidecar focused suites                                                                         |
| Authoritative live/completed timer and remount                                             | `reasoning-duration.test.ts`                                                                                   |
| Completed disclosure, label, keyboard reachability, and token-only no-fabrication          | `agent-reasoning-output.test.tsx`                                                                              |
| Standard/legacy search, persisted reload, and private-input exclusion                      | `chat-search-reasoning-output.test.ts` and Stage 1 database search tests                                       |
| Tools/plans interleave without reasoning duplication                                       | accumulator, Cursor, Codex, and OpenCode focused suites                                                        |
| Provider/UI/reload parity                                                                  | Credentialed manual rows bound to exact SHA, run ID, model/version, database part, and screenshot/log evidence |

## Live evidence record template

For each required provider, record:

1. Stage 3 SHA, verified checkout/profile, provider/harness version, exact model,
   and sanitized run/message IDs.
2. Requested toggle/effort, resolved fields, fallback/limitation, and observed
   event classes.
3. Persisted displayable parts, sanitized token/opaque metadata classification,
   final assistant result, disclosure/timer state, and reload result.
4. `PASS`, `FAIL`, or `BLOCKED` with exact gate. Never quote private reasoning,
   encrypted details, credentials, or hidden tool input.

## Current block truth

- Fixture/classification/control/UI/search work is unblocked and automated.
- Dev-test-control MCP tasks 2.5 and 3.4 are complete. The current F16 tree adds
  explicit disclosure names, remount coverage, and persisted OpenRouter/NanoGPT
  request resolution.
- `dev:verify` passed before and after restart for this checkout and the
  `Flapstack Dev` profile. Authoritative completed timers, persisted message
  identities, visible/absent classes, and sanitized metadata reloaded.
- Fresh OpenRouter and NanoGPT provider-live/headless runs passed on the current
  F16 tree. Prior Claude, Codex, and Cursor provider-live records also reloaded
  correctly, but their source commit was not recorded, so same-SHA live
  recapture remains open.
- An unlocked same-tree Cursor follow-up now has provider-live, UI-live, and
  reload evidence for two clean `auto` turns with one persisted session, exact
  model identity, completed 18-second/2-second disclosures, and visible
  reasoning search. Claude, Codex, OpenRouter, and NanoGPT same-tree UI recapture
  remains open.
- macOS was locked. Visual disclosure, keyboard, screen-reader, search, and
  screenshot rows remain open; headless/runtime proof is not relabeled UI-live.

## 2026-07-13 safe closeout evidence

- Evidence tree: this commit; parent `51444e2`. Environment: macOS arm64,
  verified `Flapstack Dev`, Electron 39.8.10, runtime Node 22.22.1. Provider
  versions remain the pinned versions in the frozen matrix.
- Claude reload: `mriu431y6d964b61`, `claude-opus-4-8`, two visible reasoning
  parts, terminal success, message `484d6f7a...`, persisted 21.969-second
  duration. Absent case `mrilkgqjpng7tm2h` completed with text only.
- Codex reload: `5737cd20...`, `gpt-5.6-sol/high`, visible thought/summary parts,
  terminal success, message `93fb638e...`, persisted 23.467-second duration.
  Absent case `b4360a7d...` completed with text only and restored its
  run-derived 3-second timer without creating a reasoning row.
- Cursor reload: `f645af95...`, `auto`, four ordered visible reasoning parts
  interleaved with tool events, terminal success, message `09363ab6...`,
  persisted 31.584-second duration.
- OpenRouter current provider-live: enabled `51630464...` persisted visible
  reasoning plus text and exact `high` resolution; disabled `1428f4fa...`
  persisted text only and resolved `{enabled:false}`; unsupported
  `openai/gpt-4.1-nano` run `6aada2e7...` omitted both requested fields,
  persisted the two exact limitations, and completed with text only.
- NanoGPT current provider-live: enabled `a20ddc1f...` and disabled
  `7e5415f6...` both completed with text only, preserved exact request
  resolution, and did not fabricate a reasoning row. Prior visible run
  `2da31d4d...` reloaded one reasoning part and its 46.506-second duration.
- Database comparison found no credential-shaped key/value in the selected
  assistant records. No hidden reasoning was captured. Eleven probe chats were
  archived, zero approvals remained pending, and zero isolated sidecar
  directories remained.
- Verification: focused reasoning/provider suites passed 142 tests with 3
  credential-conditional skips; all three related OpenSpec changes passed
  strict validation; Node 22.23.1 `npm run check` passed 101 files, 754 tests,
  3 skips, and production build. Unsigned macOS arm64 Preview package, binary
  inspection, and bundled Claude/Codex/Whisper/Parakeet smoke passed.
- Result: T3 automation/headless persistence and the safe provider subset of T4
  pass. T3/T4/T5 remain unchecked for unlocked visual accessibility/search and
  same-SHA Claude/Codex/Cursor provider plus UI-live recapture.

## 2026-07-13 integrated-candidate continuation

The authenticated dev-test surface now reads bounded reasoning/run-change DOM
state and controls only enumerated disclosure actions; returned datasets contain
labels and state, never reasoning body text. Focused tests cover completed
disclosure state and redaction. During live evidence the exact fixture chat and
sub-chat selection was confirmed, but the synthetic transcript did not mount in
the renderer. That failed observation is not relabeled as visual proof. No
provider, timer, reload, search, accessibility, or screenshot row is promoted;
S3-F16-T3 through S3-F16-T5 remain open.
