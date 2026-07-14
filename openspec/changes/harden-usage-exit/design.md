## Context

Usage spans two processes, shared SQLite, OS credential stores, provider APIs,
provider-run telemetry, a Discord webhook, and renderer charts. A green unit
suite alone cannot prove closed-app behavior or provider truthfulness.

## Goals / Non-Goals

- Goals: deterministic process ownership, durable samples, safe secrets,
  bounded provider failures, strong cost provenance, visible limitations, and a
  reproducible exit matrix.
- Non-goals: invent provider APIs, validate deferred organization Admin usage
  credentials, replace the existing Usage architecture, or fabricate
  cross-platform parity.

## Decisions

- Keep one shared normalization/store path for app, daemon, reconciliation, and
  run usage; source tags distinguish origin without changing semantics.
- Use stable sample/generation identities and monotonic provenance precedence:
  provider-reported/exact data cannot be replaced by estimates or unknown cost.
- Treat timeout, lock, corrupt data, unsupported daemon, credential-store
  failure, and provider limitation as visible states, never empty/zero success.
- The background daemon may consume only credentials persisted through an OS
  user secret store usable outside the renderer and app process.
- Run destructive lifecycle checks only against isolated test services,
  profiles, databases, credentials, and webhooks.
- Bind every evidence row to exact SHA, OS/architecture, executable/profile,
  database, provider version, and sanitized artifact paths.

## Verification Strategy

1. Deterministic fixtures cover dedupe, precedence, timeouts, locks, retries,
   gaps, redaction, alerts, filtering, and charts.
2. `npm run smoke:usage-daemon` proves the supported local daemon path.
3. Verified dev runs prove dashboard and provider states.
4. Packaged/platform rows prove service install, closed-app polling, secure
   storage, disable/uninstall, and restart behavior where environments exist.
5. `npm run check` and strict OpenSpec validation close the feature only after
   required evidence rows pass.

## Risks / Trade-offs

- Live provider APIs drift. Preserve sanitized raw payload shape/version and
  fail visibly rather than silently coercing new data.
- Platform services and credential stores are environment-dependent. Missing
  evidence blocks that row; it does not justify a false pass.

## Rollback

Usage hardening must preserve existing samples and settings. Rollback removes
new code paths or test services but does not delete the shared Usage database.
