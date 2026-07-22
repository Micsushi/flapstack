## ADDED Requirements

### Requirement: Evidence-bound platform support

Flapstack SHALL claim support only for exact OS/architecture/package combinations
that pass native install, launch, feature, upgrade, recovery, and uninstall evidence.

#### Scenario: Linux package is only cross-built

- **WHEN** no native execution evidence exists
- **THEN** Linux support remains unpromoted

### Requirement: Signed and notarized macOS distribution

Flapstack SHALL sign, notarize, staple, and Gatekeeper-test public macOS artifacts
with documented credential ownership and recovery.

#### Scenario: Notarization fails

- **WHEN** Apple rejects the artifact
- **THEN** public macOS release blocks and Preview evidence is not substituted

### Requirement: Native Windows and Linux lifecycle

Flapstack SHALL natively verify app, services, secret stores, sidecars, runtimes,
speech, permissions, paths, install/upgrade/uninstall, and cleanup on promoted targets.

Accepted Stage 5 Windows evidence SHALL remain baseline, while every new or
affected Stage 6 feature and production signing/publication path is re-verified
on native Windows before public promotion.

#### Scenario: Background service remains after uninstall

- **WHEN** package uninstall completes
- **THEN** the platform gate fails until owned service state is removed or explicitly retained by choice

### Requirement: Verifiable release artifacts

Flapstack SHALL produce checksums, dependency/SBOM metadata, architecture/content
inspection, malware/security scans, and reproducible release records.

#### Scenario: Packaged binary architecture is wrong

- **WHEN** inspection differs from declared artifact
- **THEN** publication blocks

### Requirement: Honest distribution and recovery documentation

Flapstack SHALL document prerequisites, installation, first launch, permissions,
data location, backup, diagnostics, upgrade boundary, uninstall, and recovery per platform.

#### Scenario: User cannot start after OS security prompt

- **WHEN** documented supported recovery is followed
- **THEN** the user reaches the app without unsafe bypass instructions
