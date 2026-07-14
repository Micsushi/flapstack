# Change: Harden usage exit

## Why

The Usage engine, daemon, providers, alerts, and dashboard exist, but the former
Stage 2 exit item `2.12` still lacks one authoritative reliability and manual
evidence gate. Stage 3 must prove closed-app collection, safe credential use,
cost provenance, failure visibility, and truthful cross-platform limitations
before Usage can be treated as release-ready.

## What Changes

- Promote former Stage 2 task `2.12 U-exit usage tests + manual matrix` into
  pickup-ready S3-F14 tasks.
- Harden overlap, retry, timeout, locking, reconciliation, alert, and provenance
  behavior found by the exit matrix.
- Prove daemon install/disable/restart and secure credential consumption without
  exposing secrets.
- Prove live provider and dashboard behavior with exact, estimated, unknown,
  limited, and failure states kept distinct.
- Publish one commit-bound Usage exit record; unavailable platform or credential
  evidence remains explicitly open.

## Impact

- Affected specs: new `usage-exit-hardening` capability.
- Affected code: usage engine/store/providers, daemon lifecycle, secrets,
  alerts, dashboard/settings, tests, package probes, and Usage evidence docs.
- Dependencies: S3-F10 secure credential closeout for persisted provider and
  daemon secrets; S3-F17 consumes the completed Usage exit record.

## Migration of Existing Task Authority

- Former Stage 2 `2.12` is fully owned by S3-F14-T1 through S3-F14-T5.
- Existing completed Stage 2 Usage implementation rows remain historical
  evidence, not a second active checklist.
- The existing full-feature matrix may be used as input, but S3-F14 `tasks.md`
  is the sole completion authority for this feature.
