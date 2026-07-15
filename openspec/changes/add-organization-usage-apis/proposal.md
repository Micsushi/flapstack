# Change: Add organization usage APIs

## Why

Personal quota and run usage are already supported, but optional OpenAI and
Anthropic organization usage/cost surfaces remain unverified and cannot be
presented as accurate without explicit organization identity and provenance.

## What Changes

- Add secure optional OpenAI Admin and Anthropic Admin organization adapters.
- Add organization/account identity, scopes, cursors, rate limits, and diagnostics.
- Reconcile organization totals with existing provider/run samples without double counting.
- Add organization dashboards, budgets, alerts, and sanitized live evidence.

## Impact

- Affected specs: new organization-usage capability.
- Affected code: credentials, usage providers/store/rollups, daemon, Settings,
  dashboard, budgets/alerts, diagnostics, fixtures, and tests.
