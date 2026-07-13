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

## Live provider matrix

| Provider   | Question pause    | Answer delivery         | Stop/cancel | Reload  | Status                                                |
| ---------- | ----------------- | ----------------------- | ----------- | ------- | ----------------------------------------------------- |
| Claude     | native expected   | same tool call expected | pending     | pending | BLOCKED: fresh credentialed live capture required     |
| Codex      | continuation only | normal linked user turn | pending     | pending | BLOCKED: adapter/live evidence required               |
| Cursor     | continuation only | normal linked user turn | pending     | pending | BLOCKED: adapter/live evidence required               |
| OpenRouter | continuation only | normal linked user turn | pending     | pending | BLOCKED: credentialed OpenCode live evidence required |
| NanoGPT    | continuation only | normal linked user turn | pending     | pending | BLOCKED: credentialed OpenCode live evidence required |

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

The shared lifecycle and Claude migration are implemented. Q12 and Q13 remain
open until every required live row is either passed or its continuation limitation
is explicitly accepted for release, and the Node 22 full gate passes on the final
commit.
