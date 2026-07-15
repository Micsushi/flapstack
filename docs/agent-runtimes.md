# Agent Runtimes

Agent Runtime is the transport and lifecycle used by one agent. It is separate
from the model, permissions, worktree, Agent Profile, and multi-agent
coordination engine.

## Runtime choices

| Harness                                     | Compatible Runtime choices               |
| ------------------------------------------- | ---------------------------------------- |
| Codex                                       | Automatic, Codex, Flapstack Native       |
| Claude Code                                 | Automatic, Claude Code, Flapstack Native |
| Cursor, OpenRouter, NanoGPT, local, generic | Automatic, Flapstack Native              |

Automatic resolves by harness after chat, project, and global overrides. An
explicit unavailable choice blocks before provider intent. Flapstack never
silently changes the stored preference or falls back to another Runtime.

Direct Codex and native Claude Code defaults remain release-gated until their
pinned protocol, credentialed live, restart, and packaged-app checks pass. The
Runtimes Settings page shows the exact unavailable reason. Choose Flapstack
Native explicitly when the native gate is open.

## Select and continue

New Chat exposes the short label **Runtime** beside model controls. Settings →
Runtimes sets global or project-per-harness defaults with optimistic conflict
detection and reset-to-inherited behavior.

Before a provider turn or session exists, changing Runtime updates the same
chat. After work starts, use **Continue with Runtime**. Flapstack atomically
creates one new sidebar chat and internal conversation, preserves source
lineage, starts with no copied provider session identity, imports only visible
history as labeled context, and starts one fresh provider session on the first
new turn. Repeating the same request is idempotent.
The source remains unchanged. An active run blocks the operation.

## Transcript and privacy

Runs with durable Runtime activity use one virtualized timeline for Codex,
Claude Code, and Flapstack Native. It preserves provider identities, ordering,
sections, lifecycle, tool parentage, timestamps, and honest reasoning labels.
Historical Stage 3 messages continue through the legacy projection without
invented durable event or provider identity.

Private or encrypted reasoning is never reconstructed. Copy, search, export,
diagnostics, audit, and continuation context include allowed display content
only. Provider-visible reasoning is labeled as such; summaries stay summaries;
generated activity prose is never labeled reasoning.

## Diagnostics and troubleshooting

Open **Runtime diagnostics** above a Runtime activity timeline or in Settings →
Runtimes. Diagnostics show preference and source, resolved Runtime,
adapter/protocol versions, capability and control snapshots, session identity
class, activity counts, release policy, and a bounded sanitized error. They do
not expose prompts, provider-private content, secrets, or raw session IDs.

- **Adapter disabled:** choose a compatible enabled Runtime or complete the
  native live/package release gates.
- **Protocol unsupported:** install the pinned supported provider version; do
  not bypass the version check.
- **Runtime incompatible:** keep the harness and choose one of its listed
  choices, or create a new chat with the intended harness.
- **Started/active chat:** wait for the run to finish, then Continue with the
  selected Runtime.
- **Uncertain restart:** reconcile the existing provider session; never silently replay
  an uncertain turn or spawn automatically.

## Rollback

Set Codex and Claude Code defaults to Flapstack Native and disable new native
adapter launches. Do not delete Runtime snapshots, activity events, chats,
provider session IDs, checkpoints, usage, or audits. Historical data remains
readable through its immutable snapshot or legacy projection.

## Fixture capture and redaction

Capture against the pinned provider/package version. Replace account, project,
path, repository, prompt, secret, token, session, thread, message, tool, and
user identifiers with stable fixture aliases. Remove encrypted/private
reasoning payloads completely; retain only bounded event type and identity
shape when allowed. Parse the sanitized fixture, compare event counts and
ordering with the source capture, and record provenance plus any unexplained
loss in `tests/fixtures/agent-runtime/README.md`.
