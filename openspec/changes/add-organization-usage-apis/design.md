## Context

Organization APIs use stronger credentials and different aggregation windows
than personal quota sources. Exact, provider-reported, estimated, and unknown
provenance must remain distinct.

## Goals / Non-Goals

- Goals: optional secure organization polling, exact identity, resilient cursors,
  reconciliation, budgets, alerts, and honest live evidence.
- Non-goals: requiring Admin keys, guessing missing totals, mixing organizations,
  exposing credentials, or claiming provider parity.

## Decisions

- Organization adapters are disabled until a credential passes local validation.
- Credential storage remains write-only main-process safe storage.
- Every sample carries provider, organization/account, source endpoint, window,
  retrieval time, provenance, currency, and coverage.
- Provider totals and Flapstack run samples remain separate datasets with
  explicit comparison; no subtraction-based invented attribution.
- Cursor/rate-limit errors preserve last-known values with freshness warnings.
- Live acceptance uses low-value organization credentials and sanitized evidence.

## Migration Plan

Add organization identities and samples additively. Existing personal/run usage
remains unchanged. Removing credentials stops polling and preserves history.
