# Change: Close provider harnesses

## Why

Cursor, OpenRouter, and NanoGPT are implemented as first-class harnesses, but
former Stage 2 tasks `3.6`, `4.9`, and `4.11` remain open. Stage 3 needs one
provider-harness closeout that proves current CLI/API compatibility, safe auth,
real chat lifecycle, exact permission claims, persistence, cancellation,
recovery, and a chat-capable NanoGPT default.

## What Changes

- Promote former Stage 2 Cursor exit `3.6`, OpenCode-backed exit `4.9`, and
  NanoGPT default/live test `4.11` into S3-F15 tasks.
- Reconcile current Cursor CLI and OpenCode/provider surfaces before preserving
  old assumptions.
- Replace stale or non-chat-capable defaults and prove selected provider-native
  model IDs through persisted chats and runs.
- Close auth recovery, tool approval, cancellation, concurrent stream,
  persistence, usage, and package-path regressions.
- Publish one live evidence matrix for Cursor, OpenRouter, and NanoGPT without
  treating fixtures as provider-live proof.

## Impact

- Affected specs: new `provider-harness-closeout` capability.
- Affected code: Cursor adapter; OpenCode sidecar; provider credentials,
  catalogs, models, permissions, run persistence, usage hooks, renderer
  transports, tests, package resources, and provider evidence docs.
- Dependencies: S3-F10 secure credentials, S3-F12 permission mode closeout,
  production MCP approval/audit closeout where tool decisions are exercised,
  and completed dev-test-control MCP support for headless provider smoke.

## Migration of Existing Task Authority

- Former Stage 2 `3.6` maps to S3-F15-T1, T2, and T5.
- Former Stage 2 `4.9` maps to S3-F15-T1, T3, T4, and T5.
- Former Stage 2 `4.11` maps to S3-F15-T3 and T5.
- S3-F15 `tasks.md` is the sole completion authority for these open rows.
