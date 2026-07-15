# Change: Extend Agent Profiles with reusable personalities

## Why

Stage 4 creates named Agent Profiles, but personality is embedded inside each
profile and profile selection is not yet the universal new-chat/sub-agent path.
Stage 5 should keep one profile concept while making traits reusable.

## What Changes

- Keep Agent Profile as the only complete named launch configuration.
- Remove preset as an agent product noun; built-ins are starter profiles.
- Add versioned Markdown personalities with structured traits and reusable references.
- Add profile selection to every new-chat and sub-agent/worker creation path.
- Add provider-supported speed/fast mode independently from reasoning effort.
- Preserve immutable profile/personality snapshots and authority intersection.

## Impact

- Affected specs: new agent-profile-selection capability extending S4-F12.
- Affected code: profile schema/resolver/storage, Profile Studio, Markdown
  personality files, new-chat/spawn/workflow launch, runtime compatibility,
  import/export/evaluation, migrations, audit, and tests.
