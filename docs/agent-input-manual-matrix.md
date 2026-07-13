# Agent Input Evidence Matrix

This matrix records the structured question capability implemented by the shared
agent-input lifecycle. A provider row is not complete from fixtures alone. Live
evidence must record the Flapstack commit, harness and model versions, request ID,
run ID, visible capability mode, terminal status, and a sanitized transcript or
database comparison. Never save credentials, hidden reasoning, or machine-local
paths in evidence.

## Capability baseline

| Harness                                              | Current declared mode | Same run | Evidence                                                         | Current limitation                                                                     |
| ---------------------------------------------------- | --------------------- | -------: | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Claude Agent SDK 0.3.207 / Claude Code 2.1.207       | native                |      yes | Shared contract, lifecycle, renderer, and migration tests        | Provider-live reload proof remains required.                                           |
| Codex ACP 1.1.2 / ACP provider 0.3.3 / Codex 0.144.1 | continuation          |       no | Registry and fallback tests                                      | Installed ACP surface has no verified pausable structured-input request.               |
| Cursor CLI 2026.07.09-a3815c0                        | continuation          |       no | Registry and fallback tests                                      | Current stream-json fixtures expose no verified structured-input request.              |
| OpenCode 1.17.18 with OpenRouter                     | continuation          |       no | Registry, sidecar contract, and permission-separation inspection | Pinned HTTP/SSE client exposes permission replies, not a verified question reply path. |
| OpenCode 1.17.18 with NanoGPT                        | continuation          |       no | Registry, sidecar contract, and permission-separation inspection | Same shared OpenCode limitation as OpenRouter.                                         |
| local                                                | unsupported           |       no | Registry test                                                    | No local agent loop is registered.                                                     |
| custom / unknown                                     | unsupported           |       no | Registration and fallback tests                                  | A custom adapter must declare and prove its capability.                                |

Continuation means the visible answer is sent as a normal user turn linked to the
request; it must not be described as resuming the paused provider tool call.
Permission approvals remain a separate event and audit path.

## Automated lifecycle coverage

| Scenario                                                                                                                   | Evidence                                                      | Status                                          |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| Bounded schema, stable IDs, malformed and oversized rejection                                                              | `tests/agent-input-contract.test.ts`                          | PASS                                            |
| Multiple chats, per-run serialization, answer, skip, cancel, interrupt, expiry, abort, duplicate and late answers, dispose | `tests/agent-input-lifecycle.test.ts`                         | PASS                                            |
| Single-select, multi-select, custom input, validation, submit, skip, and answer-in-chat dialog semantics                   | `tests/agent-input-dialog.test.tsx`                           | PASS                                            |
| Visible question and answer search without arbitrary tool input                                                            | `tests/chat-search-reasoning-output.test.ts`                  | PASS                                            |
| Claude shared request/status transport and same-run result delivery                                                        | Claude router and renderer tests plus focused TypeScript/lint | PASS (automated)                                |
| Background chat does not auto-open the active modal                                                                        | Active-chat request selection logic                           | PASS (automated); live navigation proof pending |
| Reload restores completed visible history without recreating stale active waits                                            | Shared status metadata and lifecycle ownership                | PARTIAL; live reload proof pending              |
| Codex, Cursor, OpenRouter, and NanoGPT capability fallback                                                                 | `tests/agent-input-contract.test.ts`                          | PASS (declaration only)                         |
| Claude, Codex, Cursor, OpenRouter, and NanoGPT request/status translation through one renderer handler                     | `tests/agent-input-transport.test.ts`                         | PASS (automated)                                |
| Stable question IDs, duplicate visible question text, custom-answer policy, and single-select cardinality                  | dialog and lifecycle focused tests                            | PASS                                            |
| Authenticated test-control owner/list/reply and redacted renderer-state inspection                                         | `tests/mcp-test-control.test.ts`                              | PASS (automated); live row below                |

## Proof-source boundary

- Authenticated test-control MCP owns functional setup and assertions: exact
  checkout/profile, project/chat creation, canonical chat selection, question
  injection, pending ownership, terminal reply, cleanup, provider status, and
  renderer-owned request/dialog state.
- Real UI evidence is limited to pixels/layout, accessibility semantics, actual
  focus, clipboard, microphone, native dialogs, and real keyboard delivery.
- UI clicking is not a substitute for a missing functional endpoint. Clean-profile
  project bootstrap, chat selection, and renderer question state now have bounded
  dev-test controls.

## Live provider matrix

| Provider   | Question pause    | Answer delivery         | Stop/cancel | Reload  | Status                                                |
| ---------- | ----------------- | ----------------------- | ----------- | ------- | ----------------------------------------------------- |
| Claude     | native expected   | same tool call expected | pending     | pending | BLOCKED: fresh credentialed live capture required     |
| Codex      | continuation only | normal linked user turn | pending     | pending | BLOCKED: adapter/live evidence required               |
| Cursor     | continuation only | normal linked user turn | pending     | pending | BLOCKED: adapter/live evidence required               |
| OpenRouter | continuation only | normal linked user turn | pending     | pending | BLOCKED: credentialed OpenCode live evidence required |
| NanoGPT    | continuation only | normal linked user turn | pending     | pending | BLOCKED: credentialed OpenCode live evidence required |

## 2026-07-13 closeout evidence

Authenticated MCP functional proof on the isolated `acbf` Dev profile:

- `dev:verify` passed for the assigned checkout, profile, and Electron main.
- Clean-profile controls registered/restored the active checkout, opened the
  canonical test conversation, and required no UI navigation.
- Native injected request `...9b3a` was owner-pending, renderer-pending,
  hydrated, and dialog-open under the same request ID. MCP submitted both
  question answers once; owner and renderer pending state then cleared.
- Injected Codex, Cursor, OpenRouter, and NanoGPT capability rows each reported
  honest `continuation`/`sameRun: false`, reached owner-pending and
  renderer-dialog-open, and accepted one MCP terminal reply. This proves shared
  adapter/UI conformance only; it is not provider-live evidence.
- Timeout request `...56d0` left no owner or renderer-pending state and moved
  the same ID into the explicit expired-continuation list. The dialog remained
  available for a normal user turn without holding a paused run.
- Pending provider approvals stayed empty and distinct throughout. Cleanup
  archived the fixture chat and project and left no pending request or approval.

Real UI proof, with the shared UI lease held:

- The native dialog exposed a heading, labeled radio buttons, `Answer in chat`,
  `Skip all`, previous/next controls, and the close action in the macOS
  accessibility tree.
- The first option received modal focus. Real Tab moved to the second radio and
  Shift-Tab returned to the first, proving keyboard delivery and focus order.
- The continuation dialog retained radio semantics and visible continuation
  capability. No UI click performed functional setup, navigation, answer, or
  cleanup; those actions used the authenticated MCP.

The unsigned macOS arm64 Preview package, binary inspection, and bundled
Claude/Codex/Whisper/Parakeet smoke passed. Credentialed
Claude/Codex/Cursor/OpenRouter/NanoGPT provider-live rows, signed and packaged
functional proof, Windows, and Linux remain open. No platform or provider proof
is inferred from injected test-control requests.

## Live evidence template

- Date and Flapstack commit:
- Provider, harness version, model ID:
- Sanitized chat, run, and request IDs:
- Declared and displayed capability mode:
- Question shape: single / multi / custom:
- Terminal path: answer / answer-in-chat / skip / cancel / stop / timeout:
- Exact delivery: same tool call or linked continuation:
- Permission approval separation checked:
- Transcript after chat switch and app reload:
- Database metadata comparison:
- Result: PASS / BLOCKED with exact limitation:

## Release truth

The shared lifecycle, provider-neutral transports, Claude migration, clean-profile
controls, and injected renderer conformance are implemented. Q12 and Q13 remain
open until every required provider-live row is either passed or its continuation
limitation is explicitly accepted for release, and the Node 22 full gate passes
on the final commit. The current lane gate passed 117 test files with 869 tests
passed and 3 skipped, plus lint, formatting, TypeScript, and production build.

## 2026-07-13 integrated-candidate continuation

From integration candidate `03ef5bf`, authenticated MCP repeated the complete
injected lifecycle for Claude, Codex, Cursor, OpenRouter, and NanoGPT. Claude
reported `native`/`sameRun: true`; the other four reported their honest
`continuation`/`sameRun: false` limitation. Each request reached the same owner,
renderer, and dialog state, accepted one terminal reply, and cleared without a
pending approval. This is adapter/UI contract proof only. The isolated profile
had no credentialed OpenRouter or NanoGPT provider and no app-scoped Claude
token, so Q12 and Q13 remain open.
