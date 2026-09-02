## ADDED Requirements

### Requirement: Protected versioned skill distribution

Flapstack SHALL preview, install, update, roll back, and remove immutable skill
bundles across granted local, WSL, SSH, and headless destinations without
executing bundle contents during installation.

#### Scenario: Installed skill has local modifications

- **WHEN** a shared update conflicts with a modified installed skill
- **THEN** Flapstack keeps the local version by default and requires explicit
  review before replacing or preserving both

### Requirement: Revocable artifact publishing

Flapstack SHALL publish only selected bounded artifacts as immutable versions
behind unlisted revocable links with explicit retention and download grants.

#### Scenario: Published artifact link is revoked

- **WHEN** an owner revokes a published link
- **THEN** new preview and download grants fail without revealing whether the
  package existed, while already downloaded copies remain outside Flapstack control

### Requirement: Enforced localization catalogs

Flapstack SHALL render supported product strings through stable locale catalogs
and SHALL detect missing, unsafe, or stale translations before release.

#### Scenario: Selected locale lacks a new string

- **WHEN** a compatible language pack lacks one required key
- **THEN** Flapstack uses the English source string and records a bounded local
  coverage warning without displaying the raw key

### Requirement: Signed channel updates with rollback

Flapstack SHALL install updates only from a valid signed manifest and verified
artifact and SHALL preserve a recoverable previous package and user-data path.

#### Scenario: Updated application fails its health gate

- **WHEN** the new package cannot complete its post-restart health check
- **THEN** Flapstack offers or performs the configured safe rollback without
  discarding user data or retrying the bad package indefinitely

### Requirement: Redacted local crash and support evidence

Flapstack SHALL survive renderer/main crashes where possible and create a
previewable bounded support bundle from allowlisted diagnostic fields.

#### Scenario: Support bundle contains a secret-like value

- **WHEN** redaction detects a credential, private path, prompt, file content,
  share URL, or unsupported field
- **THEN** the value is omitted or irreversibly redacted before export

### Requirement: Separate consent for crash and support upload

Flapstack SHALL require explicit revocable consent before uploading crash or
support evidence and SHALL keep local operation independent of upload services.

#### Scenario: Upload consent is revoked during a request

- **WHEN** the user revokes consent while evidence upload is active
- **THEN** Flapstack aborts the request, retains only the chosen local evidence,
  and sends no later retry without new consent

### Requirement: Truthful system tray and quit behavior

Flapstack SHALL distinguish window close, background availability, application
quit, service shutdown, and retained owned-process behavior on each platform.

#### Scenario: User quits while owned work is active

- **WHEN** the user selects full quit with active runs, PTYs, or relay routes
- **THEN** Flapstack previews the configured stop/preserve effects and exits only
  after owned resources reach a truthful recoverable state
