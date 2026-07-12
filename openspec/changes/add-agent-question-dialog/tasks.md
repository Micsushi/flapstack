# Universal Agent Input Implementation Board

## Purpose

Pickup-ready board for provider-independent structured questions. Implement one or two
tasks at a time in dependency order. Every task lists its boundary, expected files,
blocked-by, blocks, and completion evidence.

## Locked Product Decisions

- Flapstack owns one question contract and one renderer experience.
- Provider/model names never appear in renderer decision logic.
- Active chats may open an in-app modal. Background chats notify without stealing focus.
- Single-select uses radios; multi-select uses checkboxes; custom text is always available.
- `Answer in chat` switches to the normal composer and keeps questions reopenable.
- Native same-run resume is preferred. Injected-tool resume is second. A visible normal-
  continuation fallback is allowed only when the harness cannot pause.
- Ordinary assistant prose is never parsed heuristically into a popup.
- Implement per harness family: Claude Agent SDK; Codex ACP; Cursor CLI; OpenCode for
  OpenRouter/NanoGPT; future local/custom adapters through capability registration.

## Dependency Matrix

| Task | Title                                         | Blocked by                                   | Blocks             |
| ---- | --------------------------------------------- | -------------------------------------------- | ------------------ |
| Q0   | Baseline fixtures and current-behavior lock   | Approved proposal                            | Q1, Q4             |
| Q1   | Shared input contract and capability registry | Q0                                           | Q2, Q3, Q4-Q8, Q11 |
| Q2   | Pending-request lifecycle service             | Q1                                           | Q3-Q8, Q9, Q10     |
| Q3   | Shared transport and persistence bridge       | Q1, Q2                                       | Q4-Q8, Q9, Q10     |
| Q4   | Claude migration                              | Q0, Q1, Q2, Q3                               | Q9, Q10, Q12       |
| Q5   | OpenCode adapter: OpenRouter + NanoGPT        | Q1, Q2, Q3                                   | Q9, Q10, Q12       |
| Q6   | Codex ACP adapter                             | Q1, Q2, Q3                                   | Q9, Q10, Q12       |
| Q7   | Cursor adapter                                | Q1, Q2, Q3                                   | Q9, Q10, Q12       |
| Q8   | Future/local/custom harness registration      | Q1, Q2, Q3                                   | Q12                |
| Q9   | Universal question dialog                     | Q2, Q3, one working adapter (Q4 recommended) | Q10-Q12            |
| Q10  | Answer-in-chat and transcript UX              | Q2, Q3, Q9                                   | Q11, Q12           |
| Q11  | Background-chat inbox, badges, notifications  | Q1, Q9, Q10                                  | Q12                |
| Q12  | Automated and live provider matrix            | Q4-Q11                                       | Q13                |
| Q13  | Final gate, docs, and rollout closure         | Q12                                          | Feature exit       |

## Safe Execution Order

1. Q0 → Q1 → Q2 → Q3.
2. Q4 and Q9 together produce the first complete Claude slice.
3. Q5, Q6, Q7, and Q8 are independent after Q3 and may be completed in any order.
4. Q10 → Q11 after the dialog works.
5. Q12 → Q13 close the feature.

Do not start Q5-Q8 by copying Claude UI state into each adapter. They produce the same
shared contract. Do not mark a provider complete from mocks alone; Q12 owns live proof.

## Tasks

### Q0. Baseline fixtures and current-behavior lock

- Blocked by: approved OpenSpec proposal. Blocks: Q1, Q4.
- Scope:
  - Capture Claude's existing `AskUserQuestion` chunk, pending atom, answer mutation,
    timeout, skip, custom-composer, transcript, and notification behavior in focused tests.
  - Record current gaps for Codex ACP, Cursor CLI, and OpenCode adapters as explicit
    negative capability fixtures.
  - Confirm current question result shapes used by stored assistant tool parts.
- Expected files:
  - `tests/agent-input-baseline.test.ts` (new)
  - existing Claude transport/router test helpers where reusable
- Not included: behavior changes or new UI.
- Done when:
  - Tests prove the existing Claude same-run pause/answer path.
  - Tests prove no current shared bridge exists for the other harness families.
  - Fixture data contains no credentials, hidden reasoning, or machine paths.

### Q1. Shared input contract and capability registry

- Blocked by: Q0. Blocks: Q2, Q3, Q4-Q8, Q11.
- Scope:
  - Add provider-neutral types for request, question, option, response, status, origin,
    and completion mode.
  - Capability modes: `native`, `injected-tool`, `continuation`, `unsupported`.
  - Give every request stable `requestId`, `chatId`, `runId`, provider/harness origin,
    question list, timestamps, and capability metadata.
  - Add adapter registration/lookup by harness family. Model IDs remain opaque metadata.
  - Define schema validation and limits: bounded question/option counts and text lengths.
- Expected files:
  - `src/shared/agent-input/types.ts` (new)
  - `src/shared/agent-input/schema.ts` (new)
  - `src/main/lib/harness/input-capabilities.ts` (new)
  - `src/shared/harness-types.ts`
  - `tests/agent-input-contract.test.ts` (new)
- Not included: pending state, UI, or provider translation.
- Done when:
  - All current harness families register exactly one declared capability mode.
  - Invalid/oversized payloads fail with structured errors.
  - A new harness can register without renderer edits.

### Q2. Pending-request lifecycle service

- Blocked by: Q1. Blocks: Q3-Q10.
- Scope:
  - Main-process owner for create, wait, answer, skip, cancel, expire, and dispose.
  - Replace Claude's fixed 60-second happy-path dependency with cancellation-aware state.
  - Define timeout policy separately for native provider waits and continuation fallback.
  - Enforce one terminal transition per request and idempotent duplicate answers.
  - Handle run stop, chat archive, app shutdown, renderer reload, and provider disconnect.
  - Support multiple simultaneous pending requests across chats; serialize within one run.
- Expected files:
  - `src/main/lib/agent-input/service.ts` (new)
  - `src/main/lib/agent-input/errors.ts` (new)
  - app/run lifecycle integration points
  - `tests/agent-input-lifecycle.test.ts` (new)
- Not included: provider mapping or renderer visuals.
- Done when:
  - No request promise leaks after answer, stop, timeout, crash-like disconnect, or shutdown.
  - Duplicate/late answers cannot resume a run twice.
  - Multiple chats can wait independently.

### Q3. Shared transport and persistence bridge

- Blocked by: Q1, Q2. Blocks: Q4-Q10.
- Scope:
  - Define main-to-renderer request/status/result events and renderer-to-main actions.
  - Replace Claude-specific question atoms with shared maps keyed by chat/request.
  - Persist visible question, answer, response mode, capability mode, and final status in
    bounded assistant metadata/tool parts using the existing message/run path.
  - Restore completed transcript cards after reload. Restore active dialogs only when the
    main lifecycle service confirms the request still waits.
  - Add search extraction for question and visible answer text.
- Expected files:
  - `src/main/lib/agent-input/transport.ts` (new)
  - `src/renderer/features/agents/atoms/index.ts`
  - `src/renderer/features/agents/lib/ipc-chat-transport.ts`
  - `src/renderer/features/agents/search/chat-search-utils.ts`
  - message metadata types/persistence helpers
  - `tests/agent-input-transport.test.ts` (new)
- Not included: final modal visuals or provider translation.
- Done when:
  - Request state survives chat switching without phantom dialogs.
  - Completed question/answer history survives reload and is searchable.
  - Active state is never reconstructed solely from stale transcript data.

### Q4. Claude Agent SDK migration

- Blocked by: Q0-Q3. Blocks: Q9, Q10, Q12.
- Scope:
  - Translate native Claude `AskUserQuestion` to/from the shared contract.
  - Remove Claude-specific pending approval ownership after parity is proven.
  - Preserve single/multi-select, custom answers, skip, plan-mode behavior, notification,
    stored tool result, and same-run continuation.
  - Keep `AskUserQuestion` tool enable/disable settings behavior honest.
- Expected files:
  - `src/main/lib/trpc/routers/claude.ts`
  - `src/main/lib/claude/types.ts`
  - Claude transport/renderer compatibility code
  - baseline and adapter tests
- Not included: changing Claude prompts or forcing question use.
- Done when:
  - Q0 behavior passes through the shared system with no parallel legacy owner.
  - A native answer resumes the same Claude tool call exactly once.
  - Skip/cancel produces a readable tool denial/result and the run continues or ends safely.

### Q5. OpenCode adapter for OpenRouter and NanoGPT

- Blocked by: Q1-Q3. Blocks: Q9, Q10, Q12.
- Scope:
  - Inspect the pinned OpenCode server/event/tool surface before choosing native versus
    injected-tool mode; record the exact supported capability.
  - Add one shared OpenCode translation path covering both provider IDs and all their models.
  - If custom tool injection is supported, expose the bounded Flapstack
    `request_user_input` schema and return its result through the same running session.
  - If not supported, implement explicit continuation mode without pretending it is native.
  - Keep permission approvals separate from clarification questions in event and audit data.
- Expected files:
  - `src/main/lib/harness/opencode-sidecar/contract.ts`
  - `events.ts`, `session.ts`, `chunks.ts`, `persistence.ts`
  - `src/main/lib/trpc/routers/opencode.ts`
  - `tests/opencode-sidecar.test.ts`
  - `tests/agent-input-opencode.test.ts` (new if separation is clearer)
- Not included: provider-specific renderer branches.
- Done when:
  - One adapter test matrix passes for both `openrouter` and `nanogpt`.
  - At least one live model per provider is verified in Q12.
  - A model switch underneath OpenCode requires no question UI change.

### Q6. Codex ACP adapter

- Blocked by: Q1-Q3. Blocks: Q9, Q10, Q12.
- Scope:
  - Inspect the installed `@zed-industries/codex-acp` event/request capabilities and lock
    findings in a fixture/test before implementing.
  - Map a native ACP input request when available; otherwise register the Flapstack tool if
    ACP exposes custom tools; otherwise use continuation mode.
  - Preserve Codex session/run identity and cancellation behavior.
  - Keep Codex command approvals distinct from clarification questions.
- Expected files:
  - `src/main/lib/trpc/routers/codex.ts`
  - `src/main/lib/codex/` adapter helpers
  - `src/main/lib/codex/mcp-stdio.ts` only if the approved approach uses MCP tool exposure
  - `tests/agent-input-codex.test.ts` (new)
- Not included: protocol patching or unsupported capability claims.
- Done when:
  - Capability detection is version-aware and tested.
  - Native/injected mode resumes once, or continuation mode is visibly labeled.
  - Live proof is recorded in Q12.

### Q7. Cursor CLI adapter

- Blocked by: Q1-Q3. Blocks: Q9, Q10, Q12.
- Scope:
  - Inspect current `cursor-agent` stream-json tool events for a native/custom question path.
  - Translate supported events or implement continuation fallback.
  - Preserve Cursor session ID, Stop/resume behavior, errors, and permission limitations.
  - Add malformed/unknown event fixtures without crashing the stream translator.
- Expected files:
  - `src/main/lib/cursor/stream.ts`
  - `src/main/lib/cursor/integration.ts`
  - `src/main/lib/trpc/routers/cursor.ts`
  - `tests/cursor-harness.test.ts`
  - `tests/agent-input-cursor.test.ts` (new if useful)
- Not included: parsing plain Cursor prose as a question request.
- Done when:
  - Supported request events use the common contract.
  - Unsupported versions fall back or fail honestly, never hang.
  - Live proof is recorded in Q12.

### Q8. Future, local, and custom harness registration

- Blocked by: Q1-Q3. Blocks: Q12.
- Scope:
  - Document and test the adapter interface a future harness implements.
  - Add `local` and `custom` default registrations without building their future agent loops.
  - Require explicit capability declaration; unknown harnesses default to `unsupported`,
    never silent native support.
  - Provide a reusable adapter conformance test helper.
- Expected files:
  - shared harness/agent-input types
  - adapter registry
  - `tests/agent-input-adapter-conformance.test.ts` (new)
  - developer-facing comments or repo documentation where human value exists
- Not included: Ollama/local model agent-loop implementation.
- Done when:
  - A fixture harness can pass the conformance suite without renderer edits.
  - Unknown/local/custom capabilities are visible and safe.

### Q9. Universal question dialog

- Blocked by: Q2, Q3, and one working adapter; Q4 recommended. Blocks: Q10-Q12.
- Scope:
  - Replace the inline active answering surface with an accessible in-app modal.
  - Radio semantics for single-select; checkbox semantics for multi-select.
  - Per-question custom answer, validation, progress, previous/next, submit, skip, cancel.
  - Keyboard and screen-reader behavior: focus trap, labels/descriptions, Escape policy,
    Enter policy, option shortcuts without stealing typing focus.
  - Preserve selections while moving between questions and reopening the dialog.
  - Auto-open only for the currently active chat and only once per request.
- Expected files:
  - `src/renderer/features/agents/ui/agent-input-dialog.tsx` (new)
  - refactor/reuse `agent-user-question.tsx`
  - shared UI primitives only where necessary
  - component/logic tests
- Not included: OS-level second windows or prose detection.
- Done when:
  - Full flow works with mouse, keyboard, and screen reader semantics.
  - Single-select/custom exclusivity and multi-select rules are deterministic.
  - Closing/reopening never loses answers or submits accidentally.

### Q10. Answer-in-chat and transcript UX

- Blocked by: Q2, Q3, Q9. Blocks: Q11, Q12.
- Scope:
  - Add `Answer in chat` action that closes the modal and shows a numbered, readable
    question context attached to the normal composer.
  - Keep `Reopen questions` on the pending transcript card.
  - Define submit behavior:
    - Native/injected request still waiting: submit composer response through the pending
      request using an explicit free-text result.
    - Expired/continuation capability: send a normal user continuation linked to request ID.
  - Show pending, submitting, answered, skipped, cancelled, expired, interrupted, and
    continuation-fallback states in transcript history.
- Expected files:
  - `src/renderer/features/agents/main/active-chat.tsx`
  - `agent-ask-user-question-tool.tsx` refactor/rename to shared component
  - chat input/context components
  - search/persistence integration tests
- Not included: silently inserting text into a user's unsent draft.
- Done when:
  - Switching modes is reversible until submission.
  - Existing composer drafts are preserved.
  - Every terminal state has visible, durable wording.

### Q11. Background-chat inbox, badges, and notifications

- Blocked by: Q1, Q9, Q10. Blocks: Q12.
- Scope:
  - Reuse current needs-input desktop notification with shared request metadata.
  - Add pending badges/counts to active navigation surfaces without reviving the parked
    vertical sub-chat sidebar.
  - Clicking notification/badge focuses the correct workspace/chat and opens the request.
  - Queue multiple requests deterministically; active chat shows one modal at a time.
  - Clear indicators only on terminal lifecycle events, not merely on navigation.
- Expected files:
  - active chat and current top-tab/quick-switch navigation
  - shared notification helper
  - shared pending atoms/selectors
  - focused navigation tests
- Not included: a new global inbox product or mobile push.
- Done when:
  - Background requests never steal focus.
  - Notification navigation opens the exact live request.
  - Multiple-chat counts remain correct through answer, cancel, stop, and reload.

### Q12. Automated and live provider matrix

- Blocked by: Q4-Q11. Blocks: Q13.
- Scope:
  - Automated cases for every adapter: single, multi, custom, answer-in-chat, skip, cancel,
    timeout/expiry, stop, disconnect, duplicate answer, reload, background chat, persistence,
    malformed payload, oversized payload, and capability fallback.
  - Live matrix: Claude, Codex, Cursor, one OpenRouter model, one NanoGPT model.
  - Verify question pause, visible capability mode, exact answer delivery, same-session
    continuation when promised, and no deadlock.
  - Verify provider permission approvals remain separate and functional.
  - Record model/version/date and sanitized evidence; never credentials.
- Expected files:
  - focused adapter/lifecycle/UI tests
  - `docs/agent-input-manual-matrix.md` (new)
  - existing Stage 2 matrix links where relevant; do not duplicate unrelated rows
- Not included: claiming arbitrary untested models comply with tool-use instructions.
- Done when:
  - Automated matrix passes on Node 22.
  - Every live row is PASS or carries a precise capability limitation accepted for release.
  - No provider can leave the UI or run indefinitely deadlocked after user action.

### Q13. Final gate, docs, and rollout closure

- Blocked by: Q12. Blocks: feature exit.
- Scope:
  - Remove dead Claude-specific state/components only after parity proof.
  - Update user-facing help/settings/tool descriptions and architecture documentation.
  - Reconcile OpenSpec checklist with actual evidence; no aspirational checkmarks.
  - Run strict OpenSpec validation, focused tests, and the Node 22 `npm run check`
    gate, which includes strict TypeScript.
  - Update the Flapstack vault router, feature todo, current handoff, and test evidence.
- Expected files: final implementation diff, docs, OpenSpec files, vault status.
- Done when:
  - `npm run check` passes on Node 22.
  - Strict OpenSpec validation passes.
  - Manual matrix is complete or release limitations are explicitly accepted.
  - No duplicate legacy question pipeline remains.
  - Proposal can move to archive only after implementation and evidence are complete.

## Feature Exit Checklist

- [ ] One shared contract, lifecycle owner, transport, persistence path, and renderer UI.
- [ ] Claude native path passes.
- [ ] Codex declared capability path passes.
- [ ] Cursor declared capability path passes.
- [ ] OpenRouter and NanoGPT pass through one OpenCode adapter.
- [ ] Future adapter conformance path passes.
- [ ] Structured and answer-in-chat modes both work without losing drafts or requests.
- [ ] Background requests notify without stealing focus.
- [ ] Stop, cancel, timeout, disconnect, reload, and duplicate answers cannot deadlock.
- [ ] Permission approvals remain distinct from clarification questions.
- [ ] Transcript/search history is durable, bounded, and contains no hidden reasoning.
- [ ] Automated matrix, live matrix, strict OpenSpec, and repo gate pass.
