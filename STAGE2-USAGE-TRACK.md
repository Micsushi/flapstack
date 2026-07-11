# Stage 2 — Track B: Usage Tracking (replace onWatch)

Branch: `codex/stage2-usage-tracking`

Repo-local implementation scope: **Track B**.

## Tasks

- U1 Shared usage schema + provider adapter interface
- U2 Shared usage engine + scheduler
- U3 Background usage daemon lifecycle (works while app closed)
- U4 Shared SQLite store + app/daemon locking
- U5 App startup catch-up + manual refresh
- U6 Codex + Anthropic/Claude general usage providers
- U7 Cursor usage provider (port onWatch client, source-1 local token)
- U8 OpenRouter usage provider (needs harness-engine E3)
- U9 NanoGPT usage provider (needs harness-engine E4)
- U10 Threshold alerts + Discord webhook notifications
- U11 Usage dashboard + settings + daemon status
- U-exit Usage track tests + manual matrix

Start: U1 → U2 → U3/U4/U5/U6/U7 → U8/U9 (gated on E) → U10 → U11 → U-exit.
Reuse source: `onWatch` (Go → port to TS). Ships S2.0 provider set only.

## Cross-branch coupling

- U8 BLOCKED BY harness-engine E3; U9 BLOCKED BY harness-engine E4; both also fed
  by E6 run usage hooks. E7 BLOCKED BY U5 → E ↔ B interlock, coordinate both ways.
- U7 token detect is reused by cursor branch D3.
- Implementation-time research (not a blocker): confirm whether NanoGPT exposes
  account-wide historical usage; if not, label `run-usage only` + estimates.

## Base

Originally off `main` @ 4a2fab7. Rebased onto `main` @ 4a38134 on 2026-07-10.

## Recovery note

This file preserves the Usage track note that previously used the shared
`STAGE2-TRACK.md` name. That path now belongs to the Cursor track on `main`.
