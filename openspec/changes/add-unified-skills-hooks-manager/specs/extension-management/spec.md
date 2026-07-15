## ADDED Requirements

### Requirement: Honest unified extension inventory

Flapstack SHALL list supported harness extensions with their harness, kind,
source, scope, native path, support level, enabled policy, and runtime-consumption
state without implying unsupported parity.

#### Scenario: Mixed provider inventory

- **WHEN** Claude and Codex expose different extension kinds or scopes
- **THEN** the manager shows each native capability and labels missing or
  unsupported mappings explicitly

### Requirement: Safe native extension mutation

Flapstack SHALL validate registered roots, preview exact changes, create a
recoverable backup, and write atomically before changing a native extension.

#### Scenario: Mutation escapes an allowed root

- **WHEN** an edit, symlink, or imported path resolves outside its allowed user
  or registered project root
- **THEN** Flapstack rejects the mutation without changing any file

### Requirement: Explicit cross-harness sharing

Flapstack SHALL preserve the source and preview an adapter result before copying
an extension between harnesses.

#### Scenario: Conversion is incomplete

- **WHEN** a source field has no target-harness equivalent
- **THEN** the preview identifies the unsupported field and requires an explicit
  user decision before any target file is written

### Requirement: Scoped enablement policy

Flapstack SHALL resolve extension enablement from user default to project to task
while exposing unsupported scopes honestly.

#### Scenario: Task override

- **WHEN** a task disables an extension enabled at project scope
- **THEN** the next supported run for that task excludes it and the UI shows the
  resolved source of the decision

#### Scenario: Native discovery cannot be suppressed

- **WHEN** a disabled extension targets a harness without a supported native
  discovery filter or isolation contract
- **THEN** Flapstack exposes the policy as unsupported or blocked and refuses to
  launch the run instead of relying on prompt instructions

### Requirement: Hook validation and explicit enablement

Flapstack SHALL keep imported hooks disabled until schema validation, exact
command review, dry-run, and explicit enablement succeed.

#### Scenario: Imported executable hook

- **WHEN** a user imports a hook that can execute a command
- **THEN** Flapstack shows the command and scope, leaves it disabled, and records
  validation and dry-run results before offering enablement
