## Context

Flapstack stores one provider-neutral permission mode across a hierarchy:

- global default in `permissions.json`
- project and task defaults in SQLite
- chat permission in SQLite
- one internal canonical `sub_chats` compatibility row used by provider runs
- immutable permission snapshots on `agent_runs`

The current shipped contract is copy-on-create: later parent changes do not
alter existing children. The requested behavior adds an explicit scope choice
for chat permission changes, with `All chats` preselected, plus remembered
behavior and direct per-chat management in Settings. The adapters also differ
materially:

- Claude Code exposes SDK permission modes and a host `canUseTool` callback.
- Codex ACP exposes `read-only`, workspace-write `agent`, and
  `agent-full-access` session modes. The current AI-provider wrapper defaults an
  unanswered ACP permission request to the first option, which is normally an
  allow option.
- Cursor exposes plan, sandbox, auto-review, and force flags, but no exact
  project-only write policy.
- OpenRouter and NanoGPT both use Flapstack's OpenCode sidecar, so their tool
  permissions are identical even though their model APIs differ.

Current upstream behavior is documented by the provider runtimes used by this
checkout:

- Codex sandbox and approval controls:
  <https://learn.chatgpt.com/docs/agent-approvals-security>
- Cursor auto-review:
  <https://cursor.com/changelog/auto-review>
- OpenCode permission rules:
  <https://opencode.ai/docs/permissions/>
- Claude Agent SDK options are pinned in
  `@anthropic-ai/claude-agent-sdk` and expose `permissionMode`, `canUseTool`,
  inline permission settings, and sandbox settings.

## Goals / Non-Goals

### Goals

- Keep all-chat synchronization as the preselected scope and make its impact
  visible.
- Ask before applying a chat permission change unless the user remembered a
  scope, with `All chats` preselected.
- Let Settings clear the remembered behavior, change the future-chat default,
  and directly manage different chat permissions.
- Apply one canonical selection to the closest safe provider-native controls.
- Fail closed when an approval bridge is missing or a provider capability is
  unknown.
- Keep provider limitations visible before launch and in run metadata.
- Make Settings searchable from the first typed character using labels,
  descriptions, and curated keywords.

### Non-Goals

- Do not rewrite historical run permission snapshots.
- Do not change permissions in the middle of an active run.
- Do not claim exact enforcement for provider controls that remain
  best-effort.
- Do not add a new database schema or duplicate provider-specific permission
  state.
- Do not complete the existing custom-toggle scaffold in this change. Until
  those toggles are real, `custom` remains conservative and visibly degraded.

## Decisions

### 1. Persist one permission-change behavior

Add `changeBehavior: "ask" | "all-chats" | "current-chat"` to
`permissions.json`. Missing or invalid values resolve to `ask`.

When behavior is `ask`, selecting a different mode opens a modal before any
mutation. The modal shows the old and new modes, preselects `All chats`, and
leaves `Remember my choice` unchecked. `Cancel` leaves renderer and persistent
state unchanged. `Apply` uses the selected scope. If remember is checked,
`Apply` also stores `all-chats` or `current-chat`; otherwise behavior remains
`ask`.

When behavior is remembered, the chat selector applies that scope directly and
reports whether one chat or all chats changed. Settings exposes the three
behaviors as `Ask every time`, `Always all chats`, and `Always this chat`.
Choosing `Ask every time` clears the remembered choice.

### 2. Synchronize every live default and conversation row

For `all-chats`, one service operation updates:

- global default in `permissions.json`
- `projects.default_permission_mode`
- `tasks.default_permission_mode`
- `chats.permission_mode`, including archived chats
- `sub_chats.permission_mode`, including the internal canonical row for every
  chat

The SQLite updates occur in one transaction. The service preserves the prior
file config and restores it if the database transaction fails. Renderer query
invalidation is global, not limited to the initiating chat.

For `current-chat`, update only the selected `chats` row and all internal
`sub_chats` rows owned by it. Parent defaults and other chats do not change.

`agent_runs.permission_mode` never changes. Active runs continue with their
captured launch configuration. Any run started after the mutation resolves the
new stored mode.

### 3. Add one Permissions settings page

Move permission management out of the general Preferences card into a dedicated
`Permissions` Settings tab. It contains:

- `Default permission for new chats`, which updates the global future-chat
  default without rewriting existing chats
- `When changing permission in a chat`, with `Ask every time`, `Always all
chats`, and `Always this chat`
- an active/archived chat list showing chat name, project/task context, status,
  and effective stored mode
- a local chat-name/project/task filter for finding one conversation quickly
- a per-chat mode selector whose mutation is always explicitly
  `current-chat`, independent of remembered chat-selector behavior

This separation prevents a user who is repairing one chat override in Settings
from accidentally changing every chat. The list reuses existing chat identity
and archive state; no new database schema is required.

### 4. Keep one canonical mode; map only at launch

Flapstack continues to store one of:

- `read-only`
- `ask-before-edits`
- `auto-edit-project-only`
- `full-access`
- `custom`

Provider-native values are derived at launch and recorded in
`HarnessPermissionApplication`. No provider-specific mode is persisted as a
second source of truth.

### 5. Provider mapping matrix

| Flapstack mode           | Claude Code                                                                                                 | Codex ACP                                                                                                  | Cursor                                                                                              | OpenRouter / NanoGPT through OpenCode                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `read-only`              | `dontAsk` plus host denial of mutating built-ins and conservative MCP denial; plan input remains SDK `plan` | ACP `read-only`; reject every escalation/permission request                                                | `--mode plan --sandbox enabled`                                                                     | allow read/search; deny edit, shell, network, external-directory, subagent, and unknown/MCP actions    |
| `ask-before-edits`       | SDK `default`; route permission requests to Flapstack                                                       | ACP `read-only`; route requests to Flapstack because this is the only preset that asks before file changes | `--sandbox enabled --auto-review`, with a warning that the classifier may auto-approve safe actions | allow read/search; ask for edit, shell, network, external-directory, subagent, and unknown/MCP actions |
| `auto-edit-project-only` | SDK `acceptEdits` in the selected cwd; warn that cwd is not a complete filesystem sandbox                   | ACP `agent` workspace-write mode; bridge outside-workspace/network requests                                | `--sandbox enabled --auto-review`; warn that exact project-only auto-edit is unavailable            | allow project edits; ask for shell, network, external-directory, subagent, and unknown/MCP actions     |
| `full-access`            | SDK `bypassPermissions` with the required explicit dangerous opt-in                                         | ACP `agent-full-access`                                                                                    | `--force --sandbox disabled`                                                                        | allow all provider actions                                                                             |
| `custom`                 | conservative SDK `default` plus visible unsupported-toggle limitations                                      | conservative ACP `read-only` plus bridged requests                                                         | sandbox plus auto-review and visible unsupported-toggle limitations                                 | ask for mutating and unknown actions; visible unsupported-toggle limitations                           |

If a provider changes its native surface, focused capability tests must fail
before Flapstack silently falls back to a more permissive mapping.

### 6. Codex ACP must not auto-approve unanswered requests

Pass the derived ACP mode ID into the language model/session. Add a narrow,
packaging-safe adapter boundary that accepts a Flapstack permission callback.
The callback behavior is:

- `read-only`: choose a reject option automatically.
- `ask-before-edits` and conservative `custom`: emit a pending approval, wait
  for the user, and reject on timeout, cancellation, disconnect, or missing UI.
- `auto-edit-project-only`: the ACP workspace sandbox handles in-workspace
  actions; escalation requests use the same pending-approval bridge.
- `full-access`: select the full-access mode; if ACP unexpectedly still asks,
  explicitly select a one-time allow option rather than silently rejecting the
  action or persisting a broader rule.

Any missing callback or unrecognized option list selects a reject option or
returns a cancelled response. It must never select `options[0]` by default.

### 7. OpenCode rules start with a conservative catch-all

OpenCode permissions are ordered so unknown and MCP tool names cannot inherit
OpenCode's permissive defaults. The rules begin with a mode-appropriate `*`
catch-all, then explicitly allow safe read/search/question operations and set
edit, shell, web, external-directory, and task/subagent behavior.

OpenRouter and NanoGPT share this exact rule builder. Provider API choice does
not alter local tool authority.

### 8. Preview every provider honestly

`permissions.previewHarness` accepts all supported harnesses and returns:

- requested Flapstack mode
- actual native mode/flags/rules
- applied controls
- limitations and degradation state
- a short reason suitable for the pre-run warning UI

The warning copy names the selected provider. It does not collapse every
non-Claude provider into Claude semantics.

### 9. Search Settings locally on every keystroke

Add a small static search registry containing one entry per visible Settings
page and major control. Each entry owns a stable ID, tab ID, label, short
description, and curated keywords/aliases. Dynamic provider names such as
Claude, Codex, Cursor, OpenRouter, and NanoGPT are keywords for their relevant
pages; hidden development settings are indexed only when visible.

Normalize case, accents, and punctuation, then split the query into tokens. All
query tokens must match a label, description, or keyword. Rank exact label or
alias matches first, then label prefixes, keyword prefixes, and finally
substrings. Keep deterministic registry order for ties.

Search runs in memory on every `onChange`, including a one-character query. It
has no debounce, minimum length, network call, or new search dependency.
Selecting a result activates its tab, scrolls the stable target into view,
focuses it when possible, and briefly highlights it. `Cmd/Ctrl+F` focuses the
Settings search. Arrow keys and Enter navigate results. Escape clears a query
before it closes Settings.

## Risks / Trade-offs

- A global full-access selection has a larger blast radius. The confirmation
  must show `All chats`, name the affected scope, and keep cancellation safe.
- Updating archived chats means restored chats inherit the user's latest global
  choice. This is intentional whenever an all-chat change is confirmed or
  remembered.
- Cursor auto-review is a classifier, not a deterministic security boundary.
  Flapstack must keep that limitation visible.
- `auto-edit-project-only` remains best-effort for Claude and Cursor until their
  adapters expose a provable project-only boundary that Flapstack can control.
- A packaging patch or wrapper around the ACP AI-provider dependency must be
  verified in dev and packaged builds; otherwise Codex could regress to its
  unsafe default request handling.

## Rollback

Set `changeBehavior` to `ask` or `current-chat` to stop automatic all-chat
changes without a data migration. Reverting the feature code leaves synchronized
stored values as ordinary valid permission values; it does not require database
rollback.
