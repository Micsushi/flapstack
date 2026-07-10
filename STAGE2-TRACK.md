# Stage 2 — Track E: Harness Engine (OpenRouter + NanoGPT via OpenCode)

Branch: `codex/stage2-harness-engine`

Authoritative task board:
`agentsvault/Wiki/Projects/flapstack/stage2-implementation-tasks.md` → **Track E**.

## Tasks
- E0  Harness-engine source decision + local repo inventory (OpenCode sidecar)
- E1  OpenCode sidecar harness contract (openrouter purple, nanogpt rose)
- E2  OpenCode sidecar launcher + authenticated client
- E3  Generated OpenCode config for OpenRouter + NanoGPT
- E4  Session/event bridge + thinking normalization
- E5  Permission mapping + approval bridge
- E6  Run persistence, checkpoints, manifests, usage hooks
- E7  Provider onboarding, model catalog, chips, settings
- E8  Native harness spike + defer/continue decision
- E-exit  OpenCode-backed harness tests + manual matrix

Start: E0 → E1 → E2 → E3 → E4/E5 → E6/E7. Blueprint = Vibe Kanban OpenCode
executor (`crates/executors/src/executors/opencode*.rs`). Refs cloned at
`temp/opencode`, `temp/aider`, `vibe-kanban`.

## PRIORITY
**This track's completion is prioritized over Track D (Cursor).** It is the
shared runtime that unlocks OpenRouter + NanoGPT. Finish engine, then land all
three providers.

## Cross-branch coupling (interlocked with usage + thinking)
- E4 BLOCKED BY agent-thinking T1/T2; E3/E4 BLOCKED BY agent-thinking T6.
- E3 BLOCKS usage U8; E4 BLOCKS usage U9; E6 BLOCKS usage U8/U9.
- E7 BLOCKED BY usage U5 → E ↔ B interlock, coordinate both ways.
- Shared-file hotspots: `harness-types.ts`, `model-catalog.ts`, chip colors
  (also D1); `permissions.ts` (also D4, F6); Thinking UI (also T2, D2).

## Base
Off `main` @ 4a2fab7 (== origin/main). Rebase on main before merge.
