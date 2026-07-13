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
- Claude provider-live work is blocked by the saved OAuth credential returning
  401 until S3-F10 restores a valid credential path.
- Codex, OpenRouter, NanoGPT, and remaining Cursor provider/UI/reload rows stay
  gated by S3-F15 provider closeout and applicable S3-F10 credentials.
- Dev-test-control MCP tasks 2.5 and 3.4 are complete. S3-F16-T3 still needs a
  visual disclosure smoke. On 2026-07-13, `dev:verify` passed for this checkout
  and the freshly restarted app returned persisted completed timer state for
  Codex, Cursor, OpenRouter, and NanoGPT through `get_reasoning_timer_state`.
  macOS was locked, so visual disclosure/reopen evidence was not claimed.
