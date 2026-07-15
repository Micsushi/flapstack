## Context

Public distribution introduces external credentials, native hosts, OS security
prompts, packaging, and support claims. It does not authorize hosted sign-in,
sync, auto-update, or telemetry.

## Goals / Non-Goals

- Goals: reproducible artifacts, native installation, honest support, signing,
  notarization, secret-store/service parity, artifact security, and recovery docs.
- Non-goals: hosted backend, silent auto-update, unsupported architecture claims,
  or checking acceptance from cross-compiled artifacts alone.

## Decisions

- Support is promoted per OS/architecture only after native observed matrix.
- macOS public artifact requires Developer ID, hardened runtime where applicable,
  notarization, staple, and clean-profile Gatekeeper proof.
- Windows and Linux require native runners/hosts for package, service, native
  module, permissions, speech, Runtime, and uninstall evidence.
- Release artifacts include checksums and generated dependency/SBOM metadata.
- Signing credentials remain external secrets; tests use presence checks and
  sanitized evidence, never store credentials.
- Update/distribution channel is decided in T1; hosted Flapstack services remain excluded.

## Migration Plan

Packaging config changes are additive by platform. Preview channel remains
available. Rollback withdraws affected artifact/support claim without touching user data.
