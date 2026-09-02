## Context

Flapstack already has local skills, task artifacts, encrypted credentials,
consent-gated main-process analytics, cross-platform packaging, and extensive
diagnostics. It intentionally disables hosted update and relay dependencies.
This change adds optional sharing and distribution without making core local
operation depend on Flapstack-operated infrastructure.

## Goals / Non-Goals

- Goals: reviewable skill bundles, revocable artifact links, language packs,
  signed updates with rollback, crash survival, and safe support diagnostics.
- Non-goals: public skill discovery, silent code execution, mandatory accounts,
  mandatory telemetry, mutable published versions, or unsigned auto-update.

## Decisions

### Shared bytes are immutable and reviewable

- Skill and artifact versions are content-addressed and immutable.
- Share links are unlisted capabilities that can be revoked. Revocation prevents
  new grants but cannot remove copies already installed or downloaded.
- Skill installation previews scripts, executables, conflicts, destinations,
  and provider placements. Installation never executes bundle contents.
- Local folders and user-selected self-hosted services remain supported. A
  Flapstack-hosted service is a deployment option, not a desktop requirement.

### Localization is extracted and enforced

- Source strings use stable keys and generated catalogs.
- CI rejects missing default strings, unsafe interpolation, and coverage
  regressions. Language packs declare application-version compatibility.
- Locale changes are live where safe and otherwise request a controlled restart.

### Updates require verifiable release authority

- Manifests bind channel, version, platform, architecture, source revision,
  artifact digest, minimum protocol/database versions, rollout, and signature.
- Download, verification, installation, restart, migration, and rollback are
  separate durable states. Failure never destroys the last working package or
  user data.
- Preview and stable channels remain distinct. No channel is enabled without
  its signing and rollback evidence.

### Support data is local-first and consent-gated

- Crash recovery captures bounded local state before optional upload.
- Support bundles are previewable, redacted, size-bounded, and exclude prompts,
  file contents, credentials, private paths, and share URLs by default.
- Crash/support upload requires explicit consent separate from analytics.
- Windows/Linux tray ownership is singular across windows, updates, and crash
  recovery. Window close and full quit remain separate explicit behaviors, and
  tray status never exposes prompt or file content.

## Migration Plan

1. Add local bundle, artifact, locale, updater, and crash state stores disabled
   by default.
2. Ship local export/install, catalogs, and support bundles before any hosted
   endpoint or update channel.
3. Enable optional services only after protocol, privacy, signing, retention,
   rollback, and operations gates pass.

## Risks / Trade-offs

- Skills contain code. Default to keep-local conflicts and require explicit
  confirmation before replacing modified files.
- Updaters can strand users. Preserve the previous package and migration
  compatibility until the candidate is proven healthy.
- Redaction can miss novel secrets. Use allowlisted schemas rather than broad
  filesystem or log collection.
