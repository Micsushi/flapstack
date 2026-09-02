# Change: Add sharing, distribution, and support parity

## Why

After local, connected, remote, and native workflows are complete, Flapstack
still lacks Orca's versioned skill sharing, artifact publishing, localization,
signed update lifecycle, and user-facing crash/support tools.

## What Changes

- Add protected cross-host skill installation and optional revocable share links.
- Add bounded content-addressed artifact publishing with revocation.
- Add extracted localization catalogs and initial language packs.
- Add signed update channels, staged rollout, rollback, and platform evidence.
- Add crash-survival state, redacted support bundles, and consent-gated reporting.
- Add Windows/Linux system tray continuity with explicit window-close and full
  quit semantics.

## Impact

- Affected specs: new `sharing-distribution-support` capability.
- Affected code: skills, artifacts, credentials, optional services, i18n,
  settings, updater, packaging, crash recovery, diagnostics, analytics, mobile,
  CLI, tray/window lifecycle, migrations, release workflows, and tests.
