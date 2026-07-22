# Change: Add cross-platform public distribution

## Why

Stage 5 native Windows acceptance is not a complete public, multi-platform
distribution release. Stage 6 must produce truthful signed/notarized macOS and
Linux packages, promote accepted Windows artifacts with production credentials,
and repeat Windows evidence for every new or affected Stage 6 feature.

## What Changes

- Define support/release channels and artifact ownership.
- Sign, notarize, staple, and Gatekeeper-test macOS artifacts.
- Promote the Stage 5 Windows package lane with production signing and repeat
  native tests for Stage 6 features; build and test native Linux packages.
- Add artifact integrity, dependency/SBOM, malware, provenance, and recovery checks.
- Publish installation/support documentation without enabling hosted app services.

## Impact

- Affected specs: new platform-distribution capability.
- Affected code: electron-builder configs, native dependencies/sidecars, service
  installers, signing/notarization, artifact checks, release docs, and tests.
