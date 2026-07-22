## ADDED Requirements

### Requirement: Native Windows repository workflow

Flapstack SHALL support clean install, verification, development, and packaging
from native PowerShell on a supported Windows 11 x64 host without POSIX shell tools.

#### Scenario: Clean Windows development setup

- **WHEN** a developer clones Flapstack into a path containing spaces and Unicode
- **THEN** documented prerequisites, install, binary download, check, dev, and
  dev-verification commands complete without manual source edits

### Requirement: Deterministic Windows native dependencies

Flapstack SHALL build, repair, and verify every required native dependency for
both Node and Electron ABIs before recording a usable installation or package.

#### Scenario: ABI repair

- **WHEN** Node/Electron ABI state is missing, stale, or partially rebuilt
- **THEN** Flapstack invalidates stale markers, rebuilds with supported tools,
  performs real load probes, and leaves actionable retry state on failure

### Requirement: Windows runtime parity

Flapstack SHALL provide native Windows paths, terminals, credentials, scheduled
work, protocols, process ownership, agent harnesses, and voice behavior with
the same safety and persistence contracts as supported macOS behavior.

#### Scenario: Integrated Windows workflow

- **WHEN** a user runs project/task/chat, terminal, Claude/Codex, credential,
  speech, deep-link, restart, and scheduled-work flows
- **THEN** each flow succeeds natively or presents an explicit supported limitation
  without data loss, secret exposure, profile crossover, or orphaned process

### Requirement: Native Windows package lifecycle

Flapstack SHALL produce inspectable Windows Preview, NSIS, and portable artifacts
and prove clean install, upgrade, repair, rollback, and uninstall behavior.

#### Scenario: Installed candidate lifecycle

- **WHEN** a candidate is installed over clean and existing Stage 4 profiles
- **THEN** owned integrations and user state migrate, recover, and uninstall
  according to documented keep-data/remove-data choices

### Requirement: Evidence-bound support

Flapstack SHALL bind every Stage 5 Windows support claim to current native
evidence for one exact source SHA and artifact hash.

#### Scenario: Missing native evidence

- **WHEN** a required Windows matrix row, credentialed flow, or lifecycle test is absent
- **THEN** Stage 5 remains incomplete and documentation does not claim support
