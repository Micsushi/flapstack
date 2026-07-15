# Change: Add cross-platform public distribution

## Why

Stage 3/4 development and Preview evidence is not public distribution. Stage 5
must produce truthful signed/notarized macOS and natively tested Windows/Linux
packages with installation, security, recovery, and support evidence.

## What Changes

- Define support/release channels and artifact ownership.
- Sign, notarize, staple, and Gatekeeper-test macOS artifacts.
- Build and test native Windows and Linux packages/services/secret stores.
- Add artifact integrity, dependency/SBOM, malware, provenance, and recovery checks.
- Publish installation/support documentation without enabling hosted app services.

## Impact

- Affected specs: new platform-distribution capability.
- Affected code: electron-builder configs, native dependencies/sidecars, service
  installers, signing/notarization, artifact checks, release docs, and tests.
