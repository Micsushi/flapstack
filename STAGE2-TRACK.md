# Stage 2 — Track D: Cursor Harness (`cursor-agent` CLI)

Branch: `codex/stage2-cursor-support`

Repo-local implementation scope: **Track D**.

## Tasks
- D0  Verify `cursor-agent` CLI surface + reasoning fixture (prereq) — CLI already
      installed + logged in on dev machine (2026-07-09); commit the fixture
- D1  Harness contract extension (`cursor-agent`), teal chip
- D2  `cursor-agent` adapter (stream-json child process)
- D3  Onboarding + login/token detect
- D4  Permission mapping + honest limitations
- D5  Chips, model catalog, UI wiring
- D-exit  Cursor harness tests + manual matrix

Start: D1 (contract) ‖ D0 (fixture) → D2 → D3/D4/D5 → D-exit.

## Progress (scaffolding landed 2026-07-09, autonomous session)

Backend + shared scaffolding is in and green (lint clean, prettier clean,
`tests/cursor-harness.test.ts` 11/11 pass; the 8 full-suite failures are the
known better-sqlite3 native-ABI mismatch / F2, not this work):

- **D0** — fixtures committed: `tests/fixtures/cursor-agent/{README,thinking-run.jsonl,no-thinking-run.jsonl}`.
  Both a with-thinking and a docs-suppressed no-thinking capture, per the D0 tolerance note.
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
  + auth-error states.
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

Also still open: T5 (Cursor thinking rendering) finalizes how the
`reasoning`/`reasoning-delta` chunks this adapter emits are displayed.

## PRIORITY CONSTRAINT
**Do not COMPLETE/merge this track before Track E (harness engine).** May build
in parallel, but Cursor finishing first while OpenRouter/NanoGPT are unavailable
leaves provider parity idle. Land Track E first, or together — never D alone
ahead of E.

## Cross-branch coupling
- D2 BLOCKS agent-thinking T5.
- D3 reuses usage-tracking U7's Cursor local-token detect.
- Shared-file hotspots: `src/shared/harness-types.ts`, `model-catalog.ts`,
  chip-color constants (also edited by harness-engine E1); `permissions.ts`
  (also E5, F6).

## Base
Off `main` @ 4a2fab7 (== origin/main). Rebase on main before merge.
