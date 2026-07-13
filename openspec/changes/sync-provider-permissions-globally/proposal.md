# Change: Confirm and Sync Provider Permissions Across Chats

## Why

Changing the permission selector in one chat currently changes only that chat,
with no clear choice between changing one chat and synchronizing every chat.
Project, task, compatibility-conversation, and future-chat defaults may keep
different values. Settings also lacks one place to manage per-chat permissions,
the default, and remembered change behavior, and it has no live keyword search.

Provider adapters expose different permission controls, and the Codex ACP path
currently records the selected mode without selecting the adapter's available
sandbox/approval preset.

Users need one predictable permission choice across chats, with each provider
using the closest control it actually supports and visible warnings wherever
the mapping is not exact.

## What Changes

- **BREAKING behavior**: permission changes made from a chat show a scope
  confirmation before mutation unless the user has remembered a choice.
- Preselect `All chats` in the confirmation, keep `Remember my choice` off by
  default, and support cancelling without changing stored state.
- Persist `Ask every time`, `Always all chats`, or `Always this chat`; Settings
  can change or clear the remembered behavior.
- Synchronize global, project, task, chat, and internal canonical-conversation
  permission values while preserving historical and in-flight run snapshots.
- Add a Permissions settings page for the future-chat default and direct
  per-chat permission management across active and archived chats.
- Define and test the closest provider-native mapping for Claude Code, Codex,
  Cursor, OpenRouter, and NanoGPT.
- Route Codex ACP permission requests through a fail-closed Flapstack bridge;
  never accept the adapter client's first option implicitly.
- Expand pre-run permission previews and degradation detail to every supported
  provider.
- Add instant Settings search that matches labels, descriptions, and curated
  keywords from the first typed character and navigates to the matched control.

## Impact

- Affected specs: `run-permissions`, `settings-navigation`
- Affected code: permission config/service and tRPC router, project/task/chat
  persistence, canonical `sub_chats` compatibility rows, chat input permission
  UI, permission confirmation dialog, Settings sidebar/search/index/Permissions
  page, Claude/Codex/Cursor/OpenCode adapters, provider preview metadata, and
  permission/provider/settings tests.
- Data migration: none. Existing columns remain authoritative and are updated
  when the user next makes an all-chat permission change.
- Historical `agent_runs.permission_mode` values remain immutable audit
  snapshots.

## Approved Decisions

Auto-approved by the user on 2026-07-12:

- Chat permission changes ask for scope unless a choice is remembered.
- The popup preselects `All chats`, covering active chats, archived chats, and
  future-chat defaults.
- `Remember my choice` is unchecked by default. Remembering either scope skips
  later popups until changed back to `Ask every time` in Settings.
- Direct per-chat edits in Settings always change only that named chat so users
  can intentionally maintain different permissions.
- In-flight runs keep their launch-time permission snapshot; subsequent runs
  use the new selection.
- Provider mappings fail closed or degrade conservatively when an exact native
  control is unavailable.
- Settings search filters on every keystroke with no minimum query length or
  network dependency.
