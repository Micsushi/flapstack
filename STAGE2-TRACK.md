# Stage 2 — Track D: Cursor Harness (`cursor-agent` CLI)

Branch: `codex/stage2-cursor-support`

Authoritative task board:
`agentsvault/Wiki/Projects/flapstack/stage2-implementation-tasks.md` → **Track D**.

## Tasks

- D0 Verify `cursor-agent` CLI surface + reasoning fixture (prereq) — CLI already
  installed + logged in on dev machine (2026-07-09); commit the fixture
- D1 Harness contract extension (`cursor-agent`), teal chip
- D2 `cursor-agent` adapter (stream-json child process)
- D3 Onboarding + login/token detect
- D4 Permission mapping + honest limitations
- D5 Chips, model catalog, UI wiring
- D-exit Cursor harness tests + manual matrix

Start: D1 (contract) ‖ D0 (fixture) → D2 → D3/D4/D5 → D-exit.

## Progress (scaffolding landed 2026-07-09, autonomous session)

Backend + shared scaffolding is in and green (lint clean, prettier clean,
`tests/cursor-harness.test.ts` 11/11 pass; the 8 full-suite failures are the
known better-sqlite3 native-ABI mismatch / F2, not this work):

- **D0** — fixtures committed: `tests/fixtures/cursor-agent/{README,reasoning-output-run.jsonl,no-reasoning-output-run.jsonl}`.
  Both a with-reasoning-output and a docs-suppressed no-reasoning-output capture, per the D0 tolerance note.
- **D1** — `cursor-agent` added to `AGENT_HARNESSES`; `src/shared/model-catalog.ts`
  gains `CURSOR_MODELS`, `DEFAULT_CURSOR_MODEL_ID="auto"`, `formatCursorModelForCli()`,
  `CursorEffortLevel`, and display-name support; `harness-types.ts` adds the
  `cursor-mode`/`cursor-sandbox`/`cursor-approval` permission controls.
- **D2** — `src/main/lib/cursor/{stream,binary,integration}.ts` +
  `src/main/lib/trpc/routers/cursor.ts` (registered in router index as `cursor`).
  Spawns `cursor-agent -p --output-format stream-json --stream-partial-output`,
  translates the stream via the tolerant `CursorStreamTranslator`, persists run
  records + before/after checkpoints + no-change manifest + assistant message
  exactly like the Codex path, supersedes/cancels stale runs, honest CLI-missing
  - auth-error states.
- **D3** — `cursor.getIntegration` / `isInstalled` / `listModels` / `startLogin`
  / `logout` procedures + `getCursorIntegration()` status parsing (`cursor-agent
status`). Local-token detect from U7 can later back a token-only fallback.
- **D4** — `mapCursorPermissionFlags()` + `buildCursorPermissionApplication()`
  in `permissions.ts` (plan/sandbox/auto-review/force mapping with honest
  `HarnessPermissionLimitation`s).
- **D5** — teal Cursor chip in `agents/constants.ts`
  (`HARNESS_CHIP_META["cursor-agent"]`, color union extended with `teal`),
  `inferHarnessFromModel` handles `auto`/cursor; `CursorChatTransport`
  (`agents/lib/cursor-chat-transport.ts`) mirrors `ACPChatTransport`;
  `subChatCursorModelIdAtomFamily` + `lastSelectedCursorModelIdAtom` atoms;
  `CURSOR_MODELS`/`formatCursorEffortLabel` re-exported from `agents/lib/models.ts`.

## UI wiring completed (2026-07-10)

- Cursor is selectable for empty chats and as a continue-with target for existing
  chats. New chat creation persists `harness: "cursor-agent"`, so `auto` does not
  fall back to Codex during provider inference.
- `active-chat.tsx` now builds `CursorChatTransport` for Cursor sub-chats and
  preserves the selected Cursor model through new/continued sub-chats.
- The shared model selector includes Cursor's live CLI model list (with a safe
  `auto` fallback) and a visible **Connect** action when `cursor-agent` is not
  logged in. It starts the local CLI OAuth flow and never stores a hosted
  Flapstack credential.
- Cursor images remain explicitly unsupported until the CLI gains a verified
  headless image-input contract; the transport rejects them before persistence.

Also still open: T5 (Cursor reasoning-output rendering) finalizes how the
`reasoning`/`reasoning-delta` chunks this adapter emits are displayed.

## PRIORITY CONSTRAINT

**Do not COMPLETE/merge this track before Track E (harness engine).** May build
in parallel, but Cursor finishing first while OpenRouter/NanoGPT are unavailable
leaves provider parity idle. Land Track E first, or together — never D alone
ahead of E.

## Cross-branch coupling

- D2 BLOCKS reasoning-output T5.
- D3 reuses usage-tracking U7's Cursor local-token detect.
- Shared-file hotspots: `src/shared/harness-types.ts`, `model-catalog.ts`,
  chip-color constants (also edited by harness-engine E1); `permissions.ts`
  (also E5, F6).

## Base

Off `main` @ 4a2fab7 (== origin/main). Rebase on main before merge.

---

# Stage 2 — Track T: Reasoning Output Parity

Branch: `codex/stage2-agent-reasoning-output`

Authoritative task board:
`agentsvault/Wiki/Projects/flapstack/stage2-implementation-tasks.md` →
**Cross-track — Reasoning Output Parity**.

## Tasks

- T0 Provider behavior matrix + fixture capture
- T1 Shared reasoning-output stream contract + persistence rules
- T2 Incremental Reasoning output UI stream behavior
- T3 Claude reasoning-output stream/backfill verification
- T4 Codex/OpenAI/ACP reasoning handling
- T5 Cursor reasoning-output stream integration
- T6 OpenRouter/NanoGPT/local-model reasoning adapter contract
- T7 Reasoning-output fixtures, tests, and manual matrix

Start: T0 → T1 → T2 → T3/T4/T5/T6 → T7.

## Cross-branch coupling (this track is upstream of others — land contract early)

- T1/T2 BLOCK harness-engine E4. T6 BLOCKS harness-engine E3/E4.
- T5 is BLOCKED BY cursor branch D2 (co-evolve the shared contract).
- Shared-file hotspots: renderer Reasoning output UI (`assistant-message-item.tsx`,
  `agent-reasoning-output.tsx`) also touched by cursor (D2) and harness-engine (E4).

## Implemented so far (uncommitted)

The shared contract remains additive. Claude now uses it in the live stream.

- `src/shared/reasoning-output/reasoning-output-contract.ts` — T1 shared contract: `ReasoningOutputEvent`
  (provider/kind/phase/id/text/tokens/opaque), labels,
  `classifyReasoningOutputPersistence` (message vs opaque-metadata vs usage-metadata),
  `isDisplayableReasoningOutput`, and the T2 `ReasoningOutputAccumulator` reducer (incremental
  delta growth, dedup of streamed-then-final, opaque payload exclusion, and token
  metadata producing `tool-ReasoningOutput` parts the existing `AgentReasoningOutput` already
  consumes.
- `src/shared/reasoning-output/reasoning-output-normalizers.ts` — pure per-provider normalizers
  (claude/codex/cursor/openrouter/nanogpt/local) + `normalizeReasoningOutput` dispatcher.
  Defensive: junk/absent reasoning → `[]`.
- `tests/fixtures/reasoning-output/*.json` — T0 fixtures, one file per provider, each case
  declaring raw event + expected normalized output.
- `src/main/lib/claude/transform.ts` — T3 live wiring: Claude `thinking_delta`
  events normalize before becoming incremental `tool-ReasoningOutput` chunks; final blocks
  use the shared ID and cannot duplicate streamed text.
- `agent-reasoning-output.tsx` + search utilities — T2: `Reasoning output`,
  `Reasoning summary`, and `Reasoning tokens` labels render honestly; visible
  completed reasoning output is searchable while other tool input remains excluded.
- `codex-tool-normalizer.ts` — T4 ACP Thought chunks now normalize their visible
  `content`, `thought`, or `summary` value into `input.text`, so the existing
  canonical `tool-ReasoningOutput` renderer does not show an empty row.
- `tests/{reasoning-output-contract,claude-transform-reasoning-output,chat-search-reasoning-output,codex-reasoning-session}.test.ts`
  — fixture, accumulator, live-transform, duplicate-prevention, search, and Codex
  Thought normalization coverage. Full repo gate passes **131 tests**, lint,
  prettier, and production build under Node 24.
  (Worktree has no `node_modules`; ran via symlink to the main checkout's deps.)

## Completed integration status

The contract is the target; these connect real streams to it:

- T4 Codex/OpenAI: ACP Thought chunks are live. A local Codex session capture
  confirms `encrypted_content` and `last_token_usage.reasoning_output_tokens`;
  the router persists the token count in message usage metadata and the message
  usage card labels it `Reasoning tokens`. Visible saved-session summaries now
  stream into the Reasoning output panel and persist without duplicating ACP Thought
  text. Raw encrypted content remains opaque.
- T5 Cursor: D2 is now in the base. Its live `type:"thinking"` events first pass
  through `normalizeCursorReasoningOutput`, then emit the existing incremental
  `reasoning-*` UI chunks. The no-reasoning-output path remains a normal complete reply.
- T6 OpenRouter/NanoGPT/local: concrete adapter contract and fixtures are ready
  for harness-engine E3/E4. It accepts visible reasoning/summary data, keeps
  encrypted/provider-private fields opaque, and does not send reasoning controls
  without model capability metadata.
- T7: fixture coverage runs for every provider and
  `tests/fixtures/reasoning-output/MANUAL_MATRIX.md` records capture-tested versus
  fixture-tested paths. Cursor `auto` passed a fresh live CLI smoke on
  2026-07-10. Final dev-app UI checks remain the user-facing exit gate.

## Base

Rebased onto `main` @ `4a38134` (Cursor harness merge). Reasoning-output work remains
uncommitted pending its own review and merge.
