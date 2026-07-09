# Stage 2 Tasks

Full per-task detail (files, scope, done-when, blockers) lives in the vault board
`Wiki/Projects/flapstack/stage2-implementation-tasks.md`. This checklist mirrors
it for OpenSpec tracking.

## 0. Prerequisite

- [ ] 0.1 F2: native-module ABI toggle removal so `npm run check` runs cleanly
- [ ] 0.2 D0: install `cursor-agent` + verify its CLI flags and stream-json schema

## 1. Voice (Track A)

- [ ] 1.1 V1 Speech adapter interfaces + settings (fill scaffold)
- [ ] 1.2 V2 STT: whisper.cpp `base` local + cloud hardening
- [ ] 1.3 V3 TTS: system voice (macOS)
- [ ] 1.4 V4 TTS: system voice (Windows)
- [ ] 1.5 V5 TTS: offline Kokoro engine
- [ ] 1.6 V6 Spoken/Displayed pipeline (harness skill + extract + non-LLM fallback)
- [ ] 1.7 V7 Voice UX: mic capture + read-aloud controls
- [ ] 1.8 V8 Voice settings tab
- [ ] 1.9 V9 OS mic permissions + honest failure states
- [ ] 1.10 V-exit voice tests + manual matrix

## 2. Usage (Track B)

- [ ] 2.1 U1 Usage schema + provider adapter interface (TS)
- [ ] 2.2 U2 Provider pollers ported (Anthropic, Codex); main-process 5-min scheduler
- [ ] 2.3 U3 Threshold alerts + notifications
- [ ] 2.4 U4 Usage dashboard (top-level tab)
- [ ] 2.5 U5 Usage settings + key management
- [ ] 2.6 U6 Cursor usage provider (source 1 full; sources 2/3 stubbed chain)
- [ ] 2.7 U-exit usage tests + manual matrix

## 3. Cursor harness (Track D)

- [ ] 3.1 D1 Harness contract extension (`cursor-agent`, teal chip)
- [ ] 3.2 D2 `cursor-agent` stream-json child-process adapter
- [ ] 3.3 D3 Onboarding + login/token detect
- [ ] 3.4 D4 Permission mapping + honest limitations
- [ ] 3.5 D5 Chips, model catalog, UI wiring
- [ ] 3.6 D-exit cursor harness tests + manual matrix

## 4. Fixes (Track C)

- [ ] 4.1 F1 Strict-TS debt cleanup → promote `ts:check` to gate
- [ ] 4.2 F3 Create-branch dialog
- [ ] 4.3 F4 Terminal actions (open file / tab title / focused pane)
- [ ] 4.4 F5 Sidebar remote-stats decision
- [ ] 4.5 F6 Codex/Claude permission enforcement hardening
- [ ] 4.6 F7 Worktree UX completion: custom path + unknown state
- [ ] 4.7 F8 Scoped-search result navigation + no hidden first-20 cap
- [ ] 4.8 F9 Attachments/artifacts UX completion + no hidden first-six cap
- [ ] 4.9 F10 Run history show-all/pagination
- [ ] 4.10 F11 Cross-scope move discoverability
- [ ] 4.11 F12 Docs consistency pass
- [ ] 4.12 F-exit fixes verified in `npm run check`

(F2 native-module ABI toggle is task 0.1 — the prerequisite done first.)

## 5. Stage exit

- [ ] 5.1 `npm run check` green (lint, style, tests, build)
- [ ] 5.2 OpenSpec change validated and archived
- [ ] 5.3 Handoff + `feature-todo.md` Stage 2 boxes updated with known limitations
