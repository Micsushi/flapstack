# Owner Manual-Testing Backlog

This is the Tier 3 backlog defined by
[`completion-tiers.md`](completion-tiers.md). These checks record personal
testing and satisfaction; they do not block Tier 2 completion unless explicitly
labeled `release-blocking`.

Use `not tested`, `passed`, `issue found`, `retest required`, or
`accepted with limitation`. Record defects under Notes and link follow-up work.

Stages 1–3 were accepted before this backlog existed. The entries below
reconstruct their owner-observable coverage from the archived task boards and
historical test matrices. They are retrospective Tier 3 checks, not a change to
their Tier 2 acceptance.

## Stage 1 — Workspace Core

- [ ] S1-A — Local workspace object model
  - State: not tested
  - Feature test: Create projects, tasks, and chats at global, project, and task
    scope; change their pin/archive state; restart; and confirm the same local
    structure returns.
  - Prerequisites: Disposable local profile and two sample Git repositories.
  - Expected: scope, ownership, ordering, defaults, and stored state remain
    consistent without a hosted account.
  - [ ] S1-A6/A10/A11 — Project, task, and scoped-chat lifecycle
    - Test instructions:
      1. Create two projects, two tasks in one project, and chats at global,
         project, and task scope.
      2. Rename and reorder the objects, then pin and archive one of each type.
      3. Restart Flapstack, restore the archived objects, and open every chat.
    - Expected: each object returns in the correct scope with its history,
      pin/archive state, and project/task relationship intact.
    - Notes:
  - [ ] S1-A7 — Permission inheritance
    - Test instructions:
      1. Set a project permission default and create a task and chat beneath it.
      2. Override the task or chat, then change the project default.
      3. Create another chat and compare the existing and new resolved modes.
    - Expected: inherited values apply at creation, explicit overrides remain
      stable, and the launch UI states the actual resolved permission.
    - Notes:
  - [ ] S1-A9 — Scoped and archived-aware search
    - Test instructions:
      1. Put a unique phrase in global, project, task, and archived chats.
      2. Search from each scope with archived content excluded and included.
      3. Open each result and verify its breadcrumb.
    - Expected: results obey scope and archive filters and navigate to the
      correct owning object.
    - Notes:

- [ ] S1-B — Agent run path and evidence
  - State: not tested
  - Feature test: Launch equivalent bounded work with Claude and Codex from a
    task chat, inspect the resolved worktree and permission, and review the
    resulting run evidence.
  - Prerequisites: Configured Claude and Codex; disposable Git project.
  - Expected: each provider runs in the selected checkout with truthful
    provider, model, permission, status, checkpoint, and change evidence.
  - [ ] S1-B2 — Worktree resolution
    - Test instructions:
      1. Launch a no-edit run with the project default worktree.
      2. Launch another with the task default or an explicitly selected checkout.
      3. Make the selected checkout unavailable and inspect the next launch.
    - Expected: the recorded cwd and worktree chip match the selected checkout;
      unavailable state is shown honestly instead of silently falling back.
    - Notes:
  - [ ] S1-B3/B4 — Claude and Codex launches
    - Test instructions:
      1. Run the same small read-only prompt once with Claude and once with Codex.
      2. Inspect provider/model/permission chips while streaming and after exit.
      3. Stop one follow-up turn and retry it.
    - Expected: both adapters stream and reach an accurate terminal state;
      cancellation and retry do not duplicate messages or leave a running status.
    - Notes:
  - [ ] S1-B5 — Checkpoints and file-change manifests
    - Test instructions:
      1. Approve a small edit in the disposable project.
      2. Open the run details, before/after checkpoints, and file manifest.
      3. Compare the listed files and counts with the actual checkout diff.
    - Expected: recorded evidence describes the real run changes without
      claiming an automatic revert capability.
    - Notes:

- [ ] S1-C — Workspace navigation and chat shell
  - State: not tested
  - Feature test: Navigate the global/project/task tree, start chats in every
    scope, change run controls, and use the details panel without losing the
    active context.
  - Prerequisites: Stage 1 sample objects and configured Claude or Codex.
  - Expected: navigation, empty states, selectors, chips, and details describe
    the same current chat and run.
  - [ ] S1-C1/C2 — Sidebar tree and scope-aware chat creation
    - Test instructions:
      1. Expand and collapse the global, project, and task sections.
      2. Start a chat from each scope, including an empty project and task.
      3. Switch rapidly among the resulting chats.
    - Expected: new chats inherit the initiating scope, empty states offer the
      correct action, and selection never jumps to an unrelated object.
    - Notes:
  - [ ] S1-C3/C4 — Run selectors and identity chips
    - Test instructions:
      1. Change harness, model, permission, and worktree before launching a turn.
      2. Compare the composer selections with the tab, message, and run chips.
      3. Reopen the chat after restart.
    - Expected: the persisted and displayed identities match what actually ran.
    - Notes:
  - [ ] S1-C5 — Run-history and checkpoint details
    - Test instructions:
      1. Open Details for a chat with successful, failed, and cancelled runs.
      2. Expand each run and follow its checkpoint and manifest links.
      3. Return to the chat using keyboard and pointer navigation.
    - Expected: statuses and evidence remain attributable and navigation does
      not change the selected chat.
    - Notes:
  - [ ] S1-C6 — Local-first onboarding
    - Test instructions:
      1. Start from a disposable empty profile without signing into a hosted
         Flapstack account.
      2. Add a local project and create a chat.
      3. Restart and reopen the same project.
    - Expected: the core workspace is usable and persistent without a hosted
      backend dependency.
    - Notes:

- [ ] S1-D — Attachments, lifecycle actions, and search navigation
  - State: not tested
  - Feature test: Add and promote attachments, archive and restore workspace
    objects with undo, then find the content through scoped search.
  - Prerequisites: Disposable project containing a text file and image.
  - Expected: content remains local, lifecycle actions are reversible, and
    search opens the exact stored target.
  - [ ] S1-D1 — Attachment persistence and promotion
    - Test instructions:
      1. Attach a file, image, and pasted text to a chat.
      2. Promote each item to the owning task and switch to another chat.
      3. Restart and open the stored items from the task.
    - Expected: all attachment types remain attributable and readable; a write
      to the worktree requires an explicit safe target.
    - Notes:
  - [ ] S1-D2 — Pin, archive, restore, and undo
    - Test instructions:
      1. Pin, archive, and immediately undo actions on a chat, task, and project.
      2. Repeat the archive without undo, then restore from the archives view.
      3. Restart and inspect ordering and state.
    - Expected: undo and restore affect only the chosen object and preserve its
      children and history.
    - Notes:
  - [ ] S1-D3 — Search-result navigation
    - Test instructions:
      1. Search a phrase appearing in a message, attachment, project, and task.
      2. Open each actionable result.
      3. Use its breadcrumb to return to the originating scope.
    - Expected: actionable results select and reveal the exact content; labels
      without a navigable chat are not presented as dead actions.
    - Notes:

## Stage 2 — Voice, Usage, Providers, and Carryover UX

- [ ] S2-C — MVP carryover and deep-count UX
  - State: not tested
  - Feature test: Exercise branch, terminal, worktree, permission, search,
    attachment, run-history, and cross-scope move flows in one disposable
    project.
  - Prerequisites: Disposable Git repository with two branches and checkouts;
    configured editor and at least one provider.
  - Expected: all formerly shallow or hidden flows remain discoverable,
    unbounded through paging, and truthful about their scope.
  - [ ] S2-C-F3/F4 — Branch and terminal actions
    - Test instructions:
      1. Create and switch to a valid branch, then submit an invalid branch name.
      2. Print and open relative, absolute, line, and column file links.
      3. Run a command and focus terminals in each available pane.
    - Expected: valid branch state refreshes; invalid or failed creation is
      recoverable; links open the exact target; titles and focused-pane state
      contain no secrets or control characters.
    - Notes:
  - [ ] S2-C-F6/F7 — Permissions and worktrees
    - Test instructions:
      1. Compare every displayed permission mode for Claude and Codex, then ask a
         read-only run to edit a file.
      2. Select project, task, and custom absolute worktrees and launch a turn.
      3. Try a relative path, missing path, file, non-Git directory, and a
         checkout invalidated after selection.
    - Expected: enforcement and limitations are honest; valid cwd selection is
      exact; invalid or stale paths never become a false clean checkout.
    - Notes:
  - [ ] S2-C-F8/F9 — Search and attachments beyond preview limits
    - Test instructions:
      1. Create more than 20 search results and more than 6 attachments.
      2. Page through every result/item while retaining scope and archive filters.
      3. Open a deep message/reasoning match and promote/view/write each attachment
         type, including a denied traversal or overwrite.
    - Expected: all items remain reachable; search reveals the exact message;
      unsafe writes fail and missing content produces an explicit error.
    - Notes:
  - [ ] S2-C-F10/F11 — Full run history and cross-scope movement
    - Test instructions:
      1. Produce more than five runs, expand all history, then collapse it.
      2. Move a chat global → project → task → another project's task → global.
      3. Inspect history, archive/pin state, scope metadata, and worktree defaults.
    - Expected: no hidden ceiling remains and every move preserves history while
      clearing stale source ownership.
    - Notes:
  - [ ] S2-C-F5 — Remote-change summary
    - Test instructions:
      1. Open a remote sandbox chat with server-reported file-change totals.
      2. Inspect Details before local content is available.
      3. Use Open locally and inspect the imported changes.
    - Expected: remote state shows summary-only totals without false diff/commit
      actions; local import restores the normal inspect surface.
    - Notes:

- [ ] S2-A — Voice input and playback
  - State: not tested
  - Feature test: Dictate into a chat, review before sending, play an existing
    response with multiple speech engines, stop it, and inspect Voice settings.
  - Prerequisites: Microphone and audio output; local speech model; supported OS
    voice; optional Kokoro resources.
  - Expected: recording and playback ownership are visible, local/cloud
    boundaries are explicit, and cancellation leaves no stale audio or draft.
  - [ ] S2-A-V2/V9 — Dictation and failure states
    - Test instructions:
      1. Record a short phrase with local STT and confirm the transcript is
         inserted for review rather than sent.
      2. Make the local engine/model unavailable and confirm there is no silent
         cloud fallback.
      3. Deny microphone access, remove the device, and release the voice hotkey
         while startup is pending.
    - Expected: audio resolves to the intended 16 kHz local path; failures give
      actionable recovery; late startup cannot leave the microphone active.
    - Notes:
  - [ ] S2-A-V3/V4/V5 — Native and offline speech engines
    - Test instructions:
      1. Preview a native system voice at the selected rate and stop it.
      2. Synthesize with an offline Kokoro voice, then force Kokoro failure.
      3. Switch back to Native and repeat playback.
    - Expected: Stop is immediate; offline speech needs no API key; fallback
      remaps incompatible provider voices instead of passing them to the OS.
    - Notes:
  - [ ] S2-A-V6/V7 — Read-aloud extraction and lifecycle
    - Test instructions:
      1. Play responses with and without a `Spoken:` block across available
         providers.
      2. Start a second utterance or run while audio plays, then press Stop.
      3. Replay after restart and compare stored speech metadata.
    - Expected: only intended speech is read, deterministic fallback requires no
      extra model call, and stale synthesis cannot play or duplicate history.
    - Notes:
  - [ ] S2-A-V8/V10 — Voice settings and model state
    - Test instructions:
      1. Switch among available local models and inspect independent download
         and readiness state.
      2. Change playback voice, speed, and provider-specific choices.
      3. Restart and play a prior message.
    - Expected: Settings and runtime agree; downloaded models are retained and
      provider-specific voices do not leak across engines.
    - Notes:

- [ ] S2-B — Usage, limits, and background collection
  - State: not tested
  - Feature test: Configure providers and thresholds, collect usage with the app
    open and closed, reconcile a run, and inspect dashboard history and alerts.
  - Prerequisites: Disposable low-value provider credentials and Discord
    webhook; supported background-service platform.
  - Expected: samples, cost provenance, account scope, daemon state, and alerts
    agree without exposing credentials or fabricating missing data.
  - [ ] S2-B-U3/U5 — Daemon lifecycle and catch-up
    - Test instructions:
      1. Enable the background collector, close Flapstack, and wait one cadence.
      2. Reopen, verify one fresh heartbeat/sample, then stop and uninstall it.
      3. Create a collection gap and use Refresh now.
    - Expected: exactly one owned service runs; uninstall leaves no orphan;
      recoverable history catches up and unrecoverable gaps stay labeled.
    - Notes:
  - [ ] S2-B-U6/U7/U8/U9 — Provider truthfulness
    - Test instructions:
      1. Poll each configured personal/provider account and note its account and
         source labels.
      2. Complete one provider run and compare tokens/cost with persisted usage.
      3. Force an unavailable generation or metric and retry it explicitly.
    - Expected: exact, estimated, and unknown values remain distinct; provider
      limitations are honest; stronger cost data is never overwritten by weaker.
    - Notes:
  - [ ] S2-B-U10 — Threshold and webhook alerts
    - Test instructions:
      1. Cross a threshold while the app is closed.
      2. Return below it and cross again.
      3. Force a webhook failure, recover it, and inspect delivery history.
    - Expected: one event is delivered per armed crossing, retries are visible,
      and the alert re-arms only after recovery below threshold.
    - Notes:
  - [ ] S2-B-U11 — Usage dashboard and settings
    - Test instructions:
      1. Filter summary cards, charts, samples, cycles, and alerts by provider
         and account.
      2. Change cadence, toggles, thresholds, and configured credentials.
      3. Exercise loading, empty, limited, and failure states plus show-all paging.
    - Expected: views reconcile with stored data, secret values are never echoed,
      and missing history is not rendered as zero.
    - Notes:

- [ ] S2-D — Cursor harness
  - State: not tested
  - Feature test: Connect Cursor, select a real model, run and continue a chat,
    cancel one turn, and inspect persisted identity and limitations.
  - Prerequisites: Supported `cursor-agent` CLI and disposable Cursor login or key.
  - Expected: Cursor behaves as a first-class provider with truthful auth,
    permission, reasoning, lifecycle, and unsupported-input states.
  - [ ] S2-D-D1/D3/D5 — Discovery, authentication, and model selection
    - Test instructions:
      1. Inspect disconnected, connecting, and connected states, then record the
         CLI version.
      2. Refresh models, select a valid ID, and create and continue a chat.
      3. Restart and compare the provider/model identity in header and history.
    - Expected: headings are not mistaken for model IDs; secrets stay out of
      argv/config/logs; exact selection and status persist.
    - Notes:
  - [ ] S2-D-D2 — Streaming, reasoning, stop, and resume
    - Test instructions:
      1. Start a read-only Cursor turn and observe text and any reasoning stream.
      2. Stop a second turn, then continue the session.
      3. Trigger a structured provider failure.
    - Expected: output does not duplicate, session/checkpoint/manifest persists,
      Stop reaches cancelled, and structured failure cannot look successful.
    - Notes:
  - [ ] S2-D-D4/D5 — Permissions and unsupported inputs
    - Test instructions:
      1. Compare displayed Cursor permission mappings before launch.
      2. Exercise ask-before-edits, read-only, and full-access warning behavior.
      3. Attempt to attach an unsupported image.
    - Expected: controls state actual limitations before work begins, approvals
      and denials hold, and unsupported input is rejected rather than discarded.
    - Notes:

- [ ] S2-E — OpenRouter and NanoGPT harnesses
  - State: not tested
  - Feature test: Configure each provider securely, run a low-cost chat through
    the OpenCode sidecar, approve and deny a tool, then inspect persistence and
    cleanup.
  - Prerequisites: Low-value OpenRouter and NanoGPT keys; supported OpenCode
    sidecar; chat-capable test models.
  - Expected: isolated runtime state, exact provider/model identity, approvals,
    reasoning, run evidence, and usage remain coherent.
  - [ ] S2-E-E1/E2/E3 — Setup and isolated sidecar lifecycle
    - Test instructions:
      1. Add each key, refresh models, and choose exact catalog models.
      2. Start a chat, then stop it during a pending prompt or approval.
      3. Remove a key or make the sidecar unavailable and retry.
    - Expected: generated config references environment variables only; deadlines
      and Stop clean up the child/config; missing prerequisites fail before a
      misleading provider run is created.
    - Notes:
  - [ ] S2-E-E4/E7 — Live text, reasoning, and catalog state
    - Test instructions:
      1. Complete one minimal turn with each provider.
      2. Observe text and any reasoning lifecycle, then reload the chat.
      3. Refresh models and compare pricing/capability metadata after restart.
    - Expected: visible output and exact model persist without duplicate
      reasoning; supported catalog facts survive cache/reload.
    - Notes:
  - [ ] S2-E-E5/E6 — Tool approvals, run integrity, and usage
    - Test instructions:
      1. Trigger shell or edit work and inspect the exact requested scope.
      2. Deny one request and allow another.
      3. Inspect status, checkpoints, manifest, tool activity, decision, and cost.
    - Expected: no handler defaults to allow; provider work continues correctly;
      cancellation/concurrency cannot corrupt the active run or leave it running.
    - Notes:

- [ ] S2-T — Reasoning-output parity
  - State: not tested
  - Feature test: Request reasoning from each configured provider, observe the
    live disclosure, reload, search it, and compare honest no-reasoning output.
  - Prerequisites: Providers/models that expose visible, summarized, token-only,
    or no reasoning.
  - Expected: provider differences remain explicit and no hidden or encrypted
    reasoning is fabricated or exposed.
  - [ ] S2-T-T1/T2 — Disclosure, persistence, and search
    - Test instructions:
      1. Observe multiple reasoning deltas grow one disclosure before the answer.
      2. Reload after completion and expand it with pointer and keyboard.
      3. Search visible reasoning and compare excluded hidden tool input.
    - Expected: streaming and final events do not duplicate; disclosure and
      accessibility state persist; only intentionally visible content is indexed.
    - Notes:
  - [ ] S2-T-T3/T4/T5/T6 — Live provider behavior
    - Test instructions:
      1. Run a minimal reasoning-enabled turn with each available provider.
      2. Repeat with reasoning disabled or an unsupported control.
      3. Compare visible, summary, token-only, absent, and fallback labels.
    - Expected: each provider's actual output class is represented honestly and
      an absent stream remains a normal answer rather than invented reasoning.
    - Notes:

## Stage 3 — Safe Agent Control

- [ ] S3-F1 — TypeScript and engineering foundation
  - State: not tested
  - Feature test: Launch the accepted build, open a project, run a read-only
    chat, open a terminal, and restart the app as a basic regression smoke.
  - Prerequisites: Supported Node/runtime and a disposable project.
  - Expected: core startup, native storage/terminal loading, and a basic run work
    without an ABI, schema, type-gate, or stale-scaffold symptom.

- [ ] S3-F2 — Product MCP implementation
  - State: not tested
  - Feature test: Compare default product MCP exposure across supported and
    unsupported harnesses, inspect data, perform a mutation, restart during MCP
    work, and disable exposure.
  - Prerequisites: Disposable project/chat, an MCP-capable supported provider
    run, and a local or otherwise unsupported harness.
  - Expected: supported provider chats expose product MCP by default, unsupported
    local chats remain off, operations are bounded and attributable, restart
    recovery is safe, and disabling removes access.
  - [ ] S3-F2-T2/T3 — Connection and read-only tools
    - Test instructions:
      1. Enable MCP and ask the agent to list tools, ping, and describe the server.
      2. Inspect projects, tasks, chats, runs, worktrees, artifacts, and search.
      3. Disable MCP and repeat one call.
    - Expected: responses are paged, scoped, and secret-safe; disconnect is
      clean; disabled access fails closed.
    - Notes:
  - [ ] S3-F2-T4 — Per-chat exposure
    - Test instructions:
      1. Create new Codex, Claude, Cursor, OpenRouter, and NanoGPT chats and
         inspect their product MCP exposure before changing any setting.
      2. Create a local-model or unsupported chat and compare its exposure, then
         restart and inspect every connection state.
      3. Disable one supported chat, start another provider turn, then re-enable
         it.
    - Expected: supported provider chats default on, local or unsupported chats
      default off, state remains chat-specific, and stale provider configuration
      cannot retain disabled access.
    - Notes:
  - [ ] S3-F2-T5 — Structured mutations
    - Test instructions:
      1. Through product MCP, create or rename a disposable chat/task.
      2. Move, pin, archive, and restore it; add an attachment or worktree write.
      3. Repeat an idempotent request and issue one against a stale target.
    - Expected: each allowed mutation appears once in the app; unsafe or stale
      work fails visibly without partial state.
    - Notes:
  - [ ] S3-F2-T7 — Interrupted-run recovery
    - Test instructions:
      1. Start safe MCP-origin work and terminate Flapstack before completion.
      2. Restart and inspect that work plus an ordinary interrupted provider run.
      3. Restart again.
    - Expected: MCP-owned pending work recovers at most once; ordinary interrupted
      work is cancelled and never silently relaunched.
    - Notes:

- [ ] S3-F3 — Permissions and approvals
  - State: not tested
  - Feature test: Exercise a read, an approval-gated write, a Tier 3 action, a
    self-targeting action, denial, timeout, and stale-target change.
  - Prerequisites: Product MCP enabled in a disposable chat.
  - Expected: trusted caller and provider/product permissions combine once,
    every mutation waits for its final decision, and all unsafe cases fail closed.
  - [ ] S3-F3-T2 — Self-reference safety
    - Test instructions:
      1. Ask the running agent to archive or move its own chat/run context.
      2. Ask it to recursively relaunch or spawn into the same lineage.
      3. Try the equivalent safe action against a different disposable target.
    - Expected: self-invalidating or looping work is blocked with a clear reason;
      the safe external target follows the normal gate.
    - Notes:
  - [ ] S3-F3-T3/T4 — Approval lifecycle and execution
    - Test instructions:
      1. Approve one action, deny another, and let a third expire.
      2. Change or delete a target while its approval is pending.
      3. Attempt a duplicate or late decision.
    - Expected: no mutation precedes approval, every request finishes once, and
      timeout/stale/duplicate decisions cannot execute work.
    - Notes:
  - [ ] S3-F3-T5 — Combined provider/product gate
    - Test instructions:
      1. In read-only mode, call a product read, product write, and third-party MCP.
      2. In ask-before-edits or another guarded writable mode, request a Tier 3
         product mutation and approve its fresh prompt.
      3. In full access, request the equivalent Tier 3 product action and inspect
         its audit history.
    - Expected: only the product read passes read-only; ask mode presents one
      fresh decision; full access performs the allowed Tier 3 action without a
      prompt; both paths remain attributable and third-party tools retain their
      separate provider gate.
    - Notes:

- [ ] S3-F4 — MCP audit history
  - State: not tested
  - Feature test: Produce allowed, denied, expired, failed, and completed MCP
    activity, then filter and page through its audit history.
  - Prerequisites: Product MCP enabled and enough sample calls for multiple pages.
  - Expected: each call and decision is correlated, ordered, attributable, and
    redacted without a hidden first-page ceiling.
  - [ ] S3-F4-T3 — Filtered audit viewer data
    - Test instructions:
      1. Filter history by caller, tool, decision, and time.
      2. Page beyond the initial result limit and open a failed write.
      3. Search visible details for credentials, hidden reasoning, and raw payloads.
    - Expected: filters retain their scope, failure differs from success, and no
      secret/private field appears.
    - Notes:

- [ ] S3-F5 — Cross-agent spawning and orchestration
  - State: not tested
  - Feature test: Spawn Claude from Codex and Codex from Claude, then create a
    bounded mixed-provider operation with dependencies and lifecycle controls.
  - Prerequisites: Both providers configured; product MCP enabled; disposable task.
  - Expected: lineage, permissions, worktrees, limits, usage, recovery, and
    aggregate status remain durable and navigable.
  - [ ] S3-F5-T2/T3 — Cross-provider spawn
    - Test instructions:
      1. Approve Codex → Claude creation and launch.
      2. Approve Claude → Codex creation and launch.
      3. Force a launch failure and attempt a forbidden loop.
    - Expected: both valid directions create one attributable child; failure
      leaves honest durable state; loops and bypasses are blocked.
    - Notes:
  - [ ] S3-F5-T4 — Agent task orchestration
    - Test instructions:
      1. Create a named operation with mixed providers and one dependency.
      2. Pause, resume, retry/replace a failed worker, and restart Flapstack.
      3. Inspect lineage, progress, stop reason, usage/cost provenance, and result.
    - Expected: dependencies and parallelism prevent duplicate launches; controls
      survive restart; every worker remains navigable and bounded.
    - Notes:

- [ ] S3-F6 — MCP management and safety UI
  - State: not tested
  - Feature test: Manage MCP exposure, decide an approval without focus theft,
    inspect audit history, and watch a child mutation refresh the open UI.
  - Prerequisites: Product MCP-capable chat and disposable target objects.
  - Expected: controls expose real connection/risk state, remain accessible, and
    update without a manual reload.
  - [ ] S3-F6-T1 — Exposure and connection controls
    - Test instructions:
      1. Enable, inspect, disconnect, and re-enable product MCP for one chat.
      2. Compare its state with another chat and after restart.
      3. Trigger a stale or broken connection.
    - Expected: scope and status are explicit, default-off is preserved, and
      recovery does not broaden exposure.
    - Notes:
  - [ ] S3-F6-T2 — Approval UI
    - Test instructions:
      1. Request an approval while working elsewhere in Flapstack.
      2. Inspect caller, tool, risk, target, and bounded input using keyboard only.
      3. Deny, then repeat and approve.
    - Expected: the dialog does not steal focus unexpectedly, has a safe default,
      and the chosen decision applies to exactly one request.
    - Notes:
  - [ ] S3-F6-T3 — Audit viewer
    - Test instructions:
      1. Open MCP history from management settings.
      2. Filter, page, and open correlated approval/call records.
      3. Navigate back to the originating chat where available.
    - Expected: details are readable and redacted, with stable navigation.
    - Notes:
  - [ ] S3-F6-T5 — Live renderer refresh
    - Test instructions:
      1. Keep lists and the audit view open.
      2. Let an MCP child create or mutate a chat/task and complete a run.
      3. Observe approval, audit, chat, and run state.
    - Expected: current views refresh promptly without duplication or a full reload.
    - Notes:

- [ ] S3-F7 — Honest Settings surface
  - State: not tested
  - Feature test: Navigate and search Settings, including stale direct routes,
    and verify unreleased or unsafe controls remain unreachable while released
    values persist.
  - Prerequisites: Profile containing representative legacy settings data.
  - Expected: hidden tabs, plaintext credentials, retired preferences, and
    ineligible permissions do not leak through navigation, search, or focus.
  - [ ] S3-F7-T1/T2/T4 — Hidden-surface behavior
    - Test instructions:
      1. Search for and directly route to retired or unreleased Settings tabs.
      2. Inspect credential, quick-switch, and permission controls.
      3. Restart and confirm stored compatibility data was not deleted.
    - Expected: unsafe controls remain hidden or redirect safely; released tabs
      stay usable and historical values are preserved without becoming reachable.
    - Notes:

- [ ] S3-F8 — Keyboard shortcuts
  - State: not tested
  - Feature test: Edit, use, conflict, reset, and restart representative global
    and editor-sensitive shortcuts.
  - Prerequisites: Keyboard Settings available on the target platform.
  - Expected: displayed bindings and runtime behavior come from one focus-aware,
    conflict-safe registry.
  - [ ] S3-F8-T2/T3/T4 — Binding lifecycle and runtime
    - Test instructions:
      1. Change a shortcut and use it immediately without restart.
      2. Attempt a conflicting or reserved binding in normal and text-input focus.
      3. Restart, verify persistence, then reset to the platform default.
    - Expected: valid changes run exactly once; conflicts are explained and
      rejected; text editing is not hijacked; reset restores the shown default.
    - Notes:

- [ ] S3-F9 — Voice Settings and streaming dictation
  - State: not tested
  - Feature test: Stream local dictation across navigation, preserve its original
    composer, manage the transcript in Voice History, and play it after restart.
  - Prerequisites: Microphone/audio devices and supported local speech runtime.
  - Expected: tentative/committed text, model state, draft ownership, history,
    playback, and cleanup agree with Voice Settings.
  - [ ] S3-F9-T1/T2 — Streaming engine and immutable draft
    - Test instructions:
      1. Begin dictation with existing text in new-chat and active-chat composers.
      2. Navigate among chats/projects while tentative and committed text arrives.
      3. Stop/cancel, then force the explicit fallback path.
    - Expected: text remains bound to the initiating conversation, preserves the
      prior draft, never auto-sends, and fallback is visible.
    - Notes:
  - [ ] S3-F9-T3 — Voice History
    - Test instructions:
      1. Complete dictations with and without optional local audio retention.
      2. Search, copy, insert, play, reveal, and delete history entries.
      3. Restart and repeat one mutation.
    - Expected: transcript and metadata persist; actions target the selected
      entry once; absent or deleted audio is explained safely.
    - Notes:
  - [ ] S3-F9-T4/T5 — Settings, device, restart, and package behavior
    - Test instructions:
      1. Change adapter/model/offline preference/playback voice/rate.
      2. Deny permission, change devices, restart, and retry.
      3. Repeat the bounded flow in a candidate package where available.
    - Expected: runtime follows canonical Settings, permissions and model states
      are honest, and no recorder/audio/model process survives incorrectly.
    - Notes:

- [ ] S3-F10 — Secure credentials
  - State: not tested
  - Feature test: Add, replace, migrate, use, and remove disposable provider
    credentials across restart without revealing their stored value.
  - Prerequisites: Disposable provider credential and profile containing an
    optional legacy test value.
  - Expected: renderer sees status only, encrypted storage is durable, migration
    is acknowledged, and logs/errors never expose the secret.
  - [ ] S3-F10-T2/T3 — Migration and management UI
    - Test instructions:
      1. Start with a disposable legacy credential and open its Settings surface.
      2. Confirm migration, replace it, restart, then remove it.
      3. Inspect UI, logs, diagnostics, and retry behavior throughout.
    - Expected: the old value is not deleted before successful migration;
      add/replace/remove states are clear; plaintext cannot be retrieved.
    - Notes:
  - [ ] S3-F10-T4 — Provider and packaged consumption
    - Test instructions:
      1. Use the stored credential for one bounded provider action.
      2. Restart and repeat, then remove it and retry.
      3. Repeat in a candidate package where applicable.
    - Expected: the provider consumes the encrypted value only while configured;
      removal fails safely and no secret appears in artifacts.
    - Notes:

- [ ] S3-F11 — Provider-scoped extensions
  - State: not tested
  - Feature test: Inspect extensions from multiple providers, mutate one
    supported item, and confirm only the intended runtime consumes the change.
  - Prerequisites: At least two configured provider runtimes and sample extensions.
  - Expected: identity, source, support level, read/write ability, and limitations
    stay provider-scoped.
  - [ ] S3-F11-T2/T3 — Discovery and Settings inventory
    - Test instructions:
      1. Filter skills, commands, plugins, custom agents, and MCP entries by provider.
      2. Open similarly named items from two providers.
      3. Inspect source, availability, mutability, and limitation details.
    - Expected: formats are not conflated and duplicate names retain distinct,
      stable provider identities.
    - Notes:
  - [ ] S3-F11-T4/T5 — Supported mutations and runtime use
    - Test instructions:
      1. Enable, install, create, edit, or remove one supported disposable item.
      2. Start the owning provider and verify it consumes the change.
      3. Attempt the same unsupported action for another provider.
    - Expected: only the exact provider target changes; unsupported operations
      fail visibly without cross-provider corruption.
    - Notes:

- [ ] S3-F12 — Permission mode promotion
  - State: not tested
  - Feature test: Configure permission defaults at global, project, task, and
    chat scope; exercise custom and project-only modes with each eligible provider.
  - Prerequisites: Disposable projects and configured providers.
  - Expected: hierarchy and exact enforcement agree; ineligible modes remain
    unavailable or explicitly limited.
  - [ ] S3-F12-T2 — Durable permission hierarchy
    - Test instructions:
      1. Set distinct global, project, task, and per-chat defaults.
      2. Create chats before and after each change.
      3. Restart and compare resolved modes.
    - Expected: the nearest explicit scope wins without retroactively changing
      unrelated existing chats.
    - Notes:
  - [ ] S3-F12-T3/T4/T5 — Custom and project-only enforcement
    - Test instructions:
      1. For each eligible provider, allow one custom capability and deny another.
      2. In project-only mode, request an inside-project and outside-project write.
      3. Compare selection availability, pre-run limitation text, approvals, and diff.
    - Expected: inside-project behavior follows the stated mode, outside-project
      mutation is deterministically asked or denied, and unsupported providers do
      not claim exact enforcement.
    - Notes:

- [ ] S3-F13 — Copy, navigation, and search consistency
  - State: not tested
  - Feature test: Discover every visible Settings page through navigation and
    search with pointer and keyboard, checking provider-specific wording and
    direct routes.
  - Prerequisites: Representative configured providers and released Settings tabs.
  - Expected: one visibility source governs sidebar, search, routing, targets,
    focus, and copy.
  - [ ] S3-F13-T1/T2/T3 — Visible copy and discovery
    - Test instructions:
      1. Search generic and provider-specific settings terms.
      2. Open every visible result by pointer and keyboard, including direct routes.
      3. Try known hidden terms and inspect focus order and target anchors.
    - Expected: wording names a provider only when behavior is provider-specific;
      visible targets open and focus correctly; hidden targets do not leak.
    - Notes:

- [ ] S3-F14 — Usage hardening and exit
  - State: not tested
  - Feature test: Run background collection and live provider refresh, then
    compare dashboard, persisted samples, alert delivery, restart, and cleanup.
  - Prerequisites: Supported background-service OS; disposable provider
    credentials and webhook.
  - Expected: one secure daemon and truthful dashboard survive app closure,
    failure, retry, restart, and uninstall.
  - [ ] S3-F14-T3 — Secure daemon lifecycle
    - Test instructions:
      1. Install/start the collector, close Flapstack, and wait for a poll.
      2. Reopen and compare heartbeat/sample, then restart the service.
      3. Disable/uninstall and inspect owned processes and OS registration.
    - Expected: credentials use OS-backed storage, collection continues exactly
      once while closed, and cleanup leaves no duplicate/orphan.
    - Notes:
  - [ ] S3-F14-T4 — Live providers and dashboard
    - Test instructions:
      1. Refresh each configured provider and complete one attributable run.
      2. Filter cards, charts, samples, cycles, and alerts by provider/account.
      3. Force timeout, unavailable history, and alert-delivery failure/retry.
    - Expected: UI and persisted data agree, exact/estimated/unknown remain
      distinct, and failures cannot resemble zero or success.
    - Notes:

- [ ] S3-F15 — Provider harness closeout
  - State: not tested
  - Feature test: Complete bounded Cursor, OpenRouter, and NanoGPT chats, including
    permissions, cancellation, continuation, restart, and exact model checks.
  - Prerequisites: Current supported CLIs/sidecar, low-value credentials, and
    chat-capable models.
  - Expected: all three provider paths preserve honest identity, lifecycle,
    permission, run, and limitation state.
  - [ ] S3-F15-T2 — Cursor lifecycle
    - Test instructions:
      1. Authenticate, choose a model, and complete a small Cursor turn.
      2. Stop another turn, retry, continue, and restart.
      3. Inspect messages, run status, checkpoint/manifest, and limitation text.
    - Expected: one coherent session persists with exact provider/model and no
      duplicate output or orphan process.
    - Notes:
  - [ ] S3-F15-T3 — OpenRouter and NanoGPT live defaults
    - Test instructions:
      1. Refresh each catalog and choose a current chat-capable model.
      2. Complete one low-cost turn, reload, and inspect exact identity.
      3. Remove/disable the model or credential and retry.
    - Expected: no stale default is selected, live output persists, and missing
      prerequisites produce an actionable state.
    - Notes:
  - [ ] S3-F15-T4 — Permissions and run integrity
    - Test instructions:
      1. Trigger a tool under read-only, ask, and full-access behavior.
      2. Deny and allow requests while also testing Stop or overlapping activity.
      3. Inspect approval, audit, run evidence, and checkout changes.
    - Expected: displayed permissions hold exactly or state their limitation;
      concurrent lifecycle events cannot corrupt or strand the run.
    - Notes:

- [ ] S3-F16 — Reasoning parity and evidence
  - State: not tested
  - Feature test: Run reasoning-enabled and disabled turns across configured
    providers, then inspect streaming, timer, disclosure, reload, and search.
  - Prerequisites: Providers/models representing visible, summary, token-only,
    absent, and unsupported reasoning controls where available.
  - Expected: every output class is honest, accessible, persistent, and free of
    fabricated or private reasoning.
  - [ ] S3-F16-T3 — UI, timer, reload, and search
    - Test instructions:
      1. Watch the disclosure and timer during a live turn and after completion.
      2. Expand/collapse with pointer and keyboard, navigate away, restart, and return.
      3. Search visible reasoning and inspect the result.
    - Expected: one disclosure retains correct state and timing across remount;
      accessible state and search target agree with persisted content.
    - Notes:
  - [ ] S3-F16-T4 — Live-provider no-fabrication behavior
    - Test instructions:
      1. Run the smallest supported reasoning-enabled turn per configured provider.
      2. Repeat disabled or with an unsupported setting.
      3. Compare request resolution, visible output, token labels, and persisted data.
    - Expected: visible/summary/token-only/absent/fallback behavior matches the
      provider result, and no encrypted or hidden chain-of-thought is exposed.
    - Notes:

- [ ] S3-F17 — Integrated Stage 3 release
  - State: not tested
  - Feature test: On one exact candidate, complete a compact cross-feature
    walkthrough in verified Dev and the available package, then record personal
    acceptance or reproducible issues.
  - Prerequisites: Candidate identity and artifact hash; disposable profile;
    required providers, devices, and background-service support.
  - Expected: MCP, approvals, spawning, Voice, credentials, permissions, Usage,
    providers, reasoning, Settings, restart, and cleanup work coherently together.
  - [ ] S3-F17-T3 — Integrated live and packaged regression
    - Test instructions:
      1. Record source/build/profile identity and exercise one bounded path from
         each Stage 3 feature in Dev.
      2. Repeat provider, persistence, restart, and failure-critical paths in the
         candidate package where available.
      3. Record exact failed step, expected/actual behavior, IDs, OS, version,
         artifact hash, restart result, and cleanup state.
    - Expected: UI, runtime, persisted data, MCP/audit, provider output, and
      package identity agree; unavailable platform/device rows are named rather
      than inferred.
    - Notes:

## Stage 4 — Knowledge, Workspaces, and Multi-Agent Operations

- [ ] S4-F1 — Unified skills and hooks manager
  - State: not tested
  - Feature test: Open the manager, inspect extensions from different sources,
    safely enable one supported item, and confirm the next run uses it.
  - Prerequisites: Stage 4 beta features enabled; one supported skill or hook.
  - Expected: source and support level are clear, previews are truthful, and
    enablement persists without silently changing the source.
  - [ ] S4-F1-T3/T4 — Scoped enablement and explicit sharing
    - Test instructions:
      1. Enable one compatible extension at global, project, and task scope and
         compare the resolved state in chats inside and outside those scopes.
      2. Copy a supported skill between two harnesses, preview the target, and
         confirm the original source remains unchanged.
      3. Attempt the same operation with an incompatible or conflicting target.
    - Expected: scope precedence is visible, copied content has explicit source
      and destination provenance, and incompatible sharing fails without
      partially enabling anything.
    - Notes:
  - [ ] S4-F1-T5 — Unified manager UI
    - Test instructions:
      1. Filter extensions by source, scope, harness, and support level.
      2. Open an item and inspect its resolved details and target preview.
      3. Restart Flapstack and return to the same manager state.
    - Expected: filters and details are understandable, unsupported differences
      stay visible, and persisted state returns.
    - Notes:
  - [ ] S4-F1-T6 — Hook safety and enablement
    - Test instructions:
      1. Import a hook and leave it disabled.
      2. Run validation and dry-run, then explicitly enable it.
      3. Start a supported agent run and inspect the resulting history/audit.
    - Expected: no hook runs before enablement; validation failures are clear;
      the enabled hook affects only the intended run.
    - Notes:

- [ ] S4-F2 — Project knowledge vaults
  - State: not tested
  - Feature test: Create a project vault, edit and search its sections, load a
    selected section into a run, then restart and restore it.
  - Prerequisites: Project Memory beta feature enabled; sample project.
  - Expected: only selected knowledge enters context, edits persist, and secrets
    or conflicting changes are handled visibly.
  - [ ] S4-F2-T3 — Vault browser, editor, and search
    - Test instructions:
      1. Create and edit notes in two typed sections.
      2. Search for a unique phrase and open the matching result.
      3. Cause an external edit before saving another app edit.
    - Expected: search opens the right section and conflicting content is not
      silently overwritten.
    - Notes:
  - [ ] S4-F2-T4/T5 — Run context and approved agent operations
    - Test instructions:
      1. Select one vault section for a new run and ask the agent to identify the
         supplied knowledge without reading an unselected section.
      2. Ask the agent to create or update a disposable vault note and approve
         the exact operation.
      3. Deny an out-of-scope, stale-revision, or traversal-style vault request.
    - Expected: context includes only selected material, approved changes are
      attributable, and denied or stale operations leave the vault unchanged.
    - Notes:
  - [ ] S4-F2-T6 — Acceptance and recovery
    - Test instructions:
      1. Export or back up a vault.
      2. Change content and restore the backup.
      3. Restart Flapstack and reopen the project.
    - Expected: content and section metadata restore without leaking excluded
      secrets or losing unrelated project data.
    - Notes:

- [ ] S4-F3 — Multi-agent operations
  - State: not tested
  - Feature test: Launch a small multi-agent workflow, inspect its fleet and
    lineage, exchange a message, pause it, resume it, then cancel the tree.
  - Prerequisites: Orchestration beta feature enabled; configured provider.
  - Expected: agents, relationships, activity, and stop state stay consistent
    across views and restart.
  - [ ] S4-F3-T2/T3 — Fleet, lineage, messaging, and navigation
    - Test instructions:
      1. Start a workflow that creates at least two agents.
      2. Navigate from fleet to each agent chat and inspect parent/child links.
      3. Send a message to one running agent.
    - Expected: no completed work replays; lineage is clear; navigation and
      messaging reach the intended agent.
    - Notes:
  - [ ] S4-F3-T4/T6 — Workflow templates, settings, and profile boundaries
    - Test instructions:
      1. Save and version a bounded workflow template, then launch a new
         operation from the saved version.
      2. Change a coordination engine setting and compare the next operation
         with the already running one.
      3. Assign different profiles or permission limits to two workers and ask
         each to exceed its declared boundary.
    - Expected: running operations retain immutable versions, new settings apply
      only where intended, and no engine or profile widens a worker's permission,
      budget, worktree, or descendant limit.
    - Notes:
  - [ ] S4-F3-T5 — Cascading control and recovery
    - Test instructions:
      1. Pause and resume a running workflow.
      2. Restart Flapstack while work is queued or running.
      3. Cancel the parent and inspect every descendant.
    - Expected: queue and lineage recover; cancellation reaches descendants;
      partial failures are shown honestly.
    - Notes:
  - [ ] S4-F3-T7/T8/T9 — Workflow engines and runtime activity
    - Test instructions:
      1. Run the same bounded workflow through each available engine.
      2. Compare outputs, approvals, cancellation, and ordered activity.
      3. Open the shared runtime timeline.
    - Expected: engine differences are explicit and the timeline shows ordered,
      attributable activity without duplicates.
    - Notes:

- [ ] S4-F4 — Saved workspaces
  - State: not tested
  - Feature test: Build a multi-pane workspace, save it, pop out a pane, restart,
    and reopen both a personal and orchestration-owned workspace.
  - Prerequisites: Saved Workspaces beta feature enabled.
  - Expected: layout, pane targets, ownership, and recovery remain consistent.
  - [ ] S4-F4-T1/T2 — Workspace lifecycle and crash recovery
    - Test instructions:
      1. Create, rename, duplicate, and delete disposable saved workspaces.
      2. Make a layout change, terminate Flapstack before a normal close, and
         reopen the last workspace.
      3. Open the same workspace in two windows and make competing changes.
    - Expected: lifecycle actions affect only the selected workspace, crash
      recovery returns a valid last-known layout, and conflicts never silently
      overwrite a newer revision.
    - Notes:
  - [ ] S4-F4-T3/T4/T5 — Layout, panes, and pop-outs
    - Test instructions:
      1. Arrange chat, terminal, file, diff, and browser panes.
      2. Save the layout and pop out one pane.
      3. Close and reopen Flapstack, then restore the workspace.
    - Expected: correct content returns once, with no duplicate ownership or
      pane pointing at the wrong project/task.
    - Notes:
  - [ ] S4-F4-T6 — Orchestration-owned workspace
    - Test instructions:
      1. Start a multi-agent operation that opens a workspace.
      2. Navigate between its chats, terminal, and activity.
      3. Stop the operation and reopen its saved workspace.
    - Expected: workspace ownership and historical context are clear and no
      running process is falsely implied.
    - Notes:

- [ ] S4-F5 — Automation and scheduler
  - State: not tested
  - Feature test: Create an approval-gated automation, run it manually and by
    trigger, inspect retry/history, then disable and remove it.
  - Prerequisites: Automations beta feature enabled; safe sample project.
  - Expected: only intended triggers run, approvals and budgets are enforced,
    and disabling/removal leaves no stale execution.
  - [ ] S4-F5-T3/T4 — Trigger behavior
    - Test instructions:
      1. Run an automation manually.
      2. Exercise a schedule or run-complete trigger.
      3. Exercise a scoped file-change trigger outside and inside its scope.
    - Expected: each trigger fires once when expected and never for excluded
      files or unrelated runs.
    - Notes:
  - [ ] S4-F5-T5/T6 — Approval, retry, budgets, and kill
    - Test instructions:
      1. Deny one requested action and approve another.
      2. Trigger a controlled failure and observe bounded retry.
      3. Stop a running automation and restart Flapstack.
    - Expected: denied work does not run; retries and budgets stop at their
      limits; no child process survives cancellation.
    - Notes:
  - [ ] S4-F5-T7 — Management, history, and inbox UI
    - Test instructions:
      1. Create, edit, disable, and delete an automation.
      2. Filter its history and open a failed run.
      3. Resolve any inbox item produced by the run.
    - Expected: status and next-run information are understandable and history
      matches the actions performed.
    - Notes:

- [ ] S4-F6 — Local models
  - State: not tested
  - Feature test: Configure a local model, chat with streaming, use progressively
    broader tools with approvals, stop a run, and resume after restart.
  - Prerequisites: Local Models beta feature enabled; supported local provider.
  - Expected: capability limits are clear, tool scope is enforced, and local
    runs persist without pretending to support unavailable functions.
  - [ ] S4-F6-T2/T3 — Streaming and read-only tools
    - Test instructions:
      1. Start a local chat and observe streaming output.
      2. Ask it to inspect two project files without editing them.
      3. Stop mid-response and reopen the run after restart.
    - Expected: partial output persists, cancellation is prompt, and no file
      changes occur.
    - Notes:
  - [ ] S4-F6-T4/T5 — Write, shell, git, and network tools
    - Test instructions:
      1. Approve an exact project-scoped edit and inspect the diff.
      2. Deny an out-of-scope write or command.
      3. Exercise one allowed shell/git/network action and inspect audit history.
    - Expected: boundaries and approval mode are enforced and every mutation is
      attributable.
    - Notes:
  - [ ] S4-F6-T6 — Onboarding and controls
    - Test instructions:
      1. Add a supported local provider/model.
      2. Inspect capability and health information.
      3. Disable or remove it and attempt a new chat.
    - Expected: setup and repair guidance are clear and disabled models cannot
      be selected accidentally.
    - Notes:
  - [ ] S4-F6-T7 — Usage, workspace, and orchestration integration
    - Test instructions:
      1. Run the local model once in a normal chat and once as an orchestration
         worker inside a saved workspace.
      2. Open each run from workspace activity and inspect provider/model usage.
      3. Restart and reopen both histories.
    - Expected: every run remains navigable and attributable to the local model;
      missing price data is labeled unknown rather than fabricated.
    - Notes:

- [ ] S4-F7 — Advanced usage and limits
  - State: not tested
  - Feature test: Explore usage by project/provider, save a view, set a budget,
    trigger an alert, and export redacted data.
  - Prerequisites: Usage data from more than one provider or project.
  - Expected: rollups reconcile, forecasts explain uncertainty, alerts are
    scoped correctly, and exports omit secrets.
  - [ ] S4-F7-T1/T2 — Attribution provenance and backfill
    - Test instructions:
      1. Open usage created before and after Stage 4 attribution support.
      2. Compare provider, account, project, task, chat, run, runtime, and model
         labels with the originating runs.
      3. Inspect a record whose historical scope cannot be recovered.
    - Expected: known attribution matches its source, backfilled values are
      distinguishable from exact capture, and unavailable dimensions stay
      unknown rather than being guessed.
    - Notes:
  - [ ] S4-F7-T3/T4 — Rollups and forecasts
    - Test instructions:
      1. Compare total usage with filtered provider/project views.
      2. Open forecast and anomaly explanations.
      3. Change the time range and inspect estimate/quality labels.
    - Expected: totals reconcile and uncertainty is visible rather than shown as
      exact fact.
    - Notes:
  - [ ] S4-F7-T5/T6 — Budgets, alerts, explorer, and export
    - Test instructions:
      1. Create and update a scoped budget.
      2. Cross a test threshold and inspect the alert.
      3. Export CSV, JSON, and redacted raw data.
    - Expected: alert scope is correct and exported content matches the visible
      filters without exposing credentials.
    - Notes:

- [ ] S4-F8 — Import, export, and private sync
  - State: not tested
  - Feature test: Export selected settings/data, preview an import, apply it,
    recover from a failed import, and sync to an explicitly owned private repo.
  - Prerequisites: Disposable profile; optional private Git remote.
  - Expected: secrets are excluded, diffs are understandable, imports are
    transactional, and sync never targets an unapproved remote.
  - [ ] S4-F8-T2/T3 — Secret-safe export
    - Test instructions:
      1. Add a recognizable fake secret to disposable data.
      2. Export selected scopes and inspect exclusion reporting.
      3. Search the bundle for the fake secret.
    - Expected: the secret is absent and the exclusion is reported clearly.
    - Notes:
  - [ ] S4-F8-T4/T5 — Preview, transactional import, and recovery
    - Test instructions:
      1. Preview a compatible bundle and inspect its diff.
      2. Apply it, then repeat with a deliberately invalid bundle.
      3. Restart and inspect the original and imported data.
    - Expected: valid changes apply once; invalid changes roll back without
      corrupting unrelated state.
    - Notes:
  - [ ] S4-F8-T6/T7 — Private sync and UI
    - Test instructions:
      1. Configure an explicitly owned private remote.
      2. Preview and run one push/pull cycle.
      3. Remove authorization and retry.
    - Expected: remote and scope remain visible; unauthorized sync stops safely.
    - Notes:

- [ ] S4-F9 — Plan and Kanban views
  - State: not tested
  - Feature test: Open a discovered plan, promote a candidate once, move the
    resulting task, and review an AI proposal through approval.
  - Prerequisites: Planning & Task Board beta feature enabled; sample plan.
  - Expected: plan and board share real task identity and provenance without
    duplicate promotion or cross-window drift.
  - [ ] S4-F9-T3/T4 — Plan view and real task cards
    - Test instructions:
      1. Open a plan containing several tasks.
      2. Navigate to its Kanban cards and change one allowed status.
      3. Open a second window and compare the same task.
    - Expected: cards map to real tasks and status stays consistent.
    - Notes:
  - [ ] S4-F9-T5/T6 — Promotion and AI proposals
    - Test instructions:
      1. Promote the same plan candidate twice.
      2. Review and deny one AI proposal, then approve another.
      3. Inspect provenance and audit history.
    - Expected: promotion is idempotent, denied work is absent, and approved work
      is attributable.
    - Notes:
  - [ ] S4-F9-T7 — Provenance, divergence, and cross-window consistency
    - Test instructions:
      1. Edit a promoted task outside its source plan and reopen both views.
      2. Resolve or acknowledge the displayed divergence.
      3. Repeat a status change with Plan and Kanban open in separate windows.
    - Expected: source provenance and divergence remain visible, no external edit
      is silently overwritten, and both windows converge on one task state.
    - Notes:

- [ ] S4-F11 — Agent runtimes
  - State: not tested
  - Feature test: Run supported Codex, Claude, and Flapstack Native modes, inspect
    their shared activity, cancel them, and resume only where supported.
  - Prerequisites: configured provider credentials; runtime beta availability.
  - Expected: capability differences and release gates are honest; lifecycle and
    activity remain provider-neutral.
  - [ ] S4-F11-T4/T5/T6 — Runtime adapters
    - Test instructions:
      1. Launch the same bounded prompt with each available runtime.
      2. Exercise one tool/approval and cancel each run.
      3. Restart and attempt supported continuation.
    - Expected: unavailable or gated runtimes stay unavailable with a reason;
      supported runs stream, stop, and recover correctly.
    - Notes:
  - [ ] S4-F11-T7/T8/T9 — Timeline, settings, and orchestration seam
    - Test instructions:
      1. Change global, project, and new-chat runtime preferences and inspect the
         resolved source and availability reason.
      2. Open the shared activity timeline during a mixed-runtime workflow and
         navigate from activity to the originating chat.
      3. Attempt a compatible and incompatible per-worker runtime override.
    - Expected: preferences affect only intended launches and activity is
      ordered, attributable, and navigable; incompatible overrides fail before
      spawning work.
    - Notes:
  - [ ] S4-F11-T7/T8 — Activity privacy, controls, and continuation
    - Test instructions:
      1. Compare reasoning, child activity, and hook-diagnostic controls for
         runtimes that do and do not support them.
      2. Search, copy, and export a timeline containing public, opaque, and
         private activity.
      3. Continue a started chat with a compatible runtime, double-click once,
         then retry an unavailable continuation.
    - Expected: controls affect only their named stream, private content is
      absent from display/copy/export, and continuation creates exactly one new
      attributed chat without changing the source.
    - Notes:

- [ ] S4-F12 — Agent profiles and personalities
  - State: not tested
  - Feature test: Create a named profile, preview its resolved behavior, bind it
    to a workflow, launch it standalone, export/import it, and evaluate it.
  - Prerequisites: Agent profile feature available; supported runtime.
  - Expected: snapshots are deterministic, trust/source are visible, and named
    behavior survives restart and portability.
  - [ ] S4-F12-T3/T4 — Lifecycle and Profile Studio
    - Test instructions:
      1. Create and edit a profile in Profile Studio.
      2. Inspect the resolved preview and save it.
      3. Restart, export, and re-import the profile.
    - Expected: the resolved result is understandable and persists without
      silently importing untrusted behavior.
    - Notes:
  - [ ] S4-AP08 — Profile Studio keyboard and screen-reader walkthrough
    - Test instructions:
      1. Enable the owner's preferred Windows screen reader.
      2. Using only the keyboard, create and preview a profile, inspect
         capability and personality sections, and resolve one validation error.
      3. Bind the profile to a workflow, launch it standalone, then duplicate,
         import, export, archive, and restore it.
      4. Confirm focus remains visible and logical through dialogs, errors, and
         returning navigation.
    - Expected: controls expose clear names, roles, states, errors, and section
      boundaries; capability and personality are not confused; every flow is
      operable without a pointer.
    - Notes:
  - [ ] S4-F12-T5/T6/T7 — Workflows, standalone launch, and evaluation
    - Test instructions:
      1. Bind the profile to a deterministic workflow.
      2. Launch the same profile standalone.
      3. Run its evaluation and compare the recorded snapshot.
    - Expected: both launches use the named snapshot and evaluation reports
      meaningful differences without changing the profile.
    - Notes:

## Stage 5 — Native Windows Compatibility

The expanded Windows walkthrough remains in
[`stage5-windows-manual-test.md`](stage5-windows-manual-test.md).

- [ ] S5-F1 — Supported Windows toolchain
  - State: not tested
  - Feature test: Prepare a clean Windows 11 x64 environment, run prerequisite
    diagnostics/bootstrap, and repeat from a path containing spaces and Unicode.
  - Prerequisites: clean Windows 11 x64 VM or device.
  - Expected: supported versions and missing tools are reported accurately with
    safe repair guidance.
  - [ ] S5-F1-T1/T2/T3/T5 — Support contract and diagnostics
    - Test instructions:
      1. Run diagnostics with the supported Windows 11 x64, Node 22, npm 10,
         Python 3.11, PowerShell 5.1+, and required native-build tools.
      2. Repeat with one unsupported version or missing prerequisite at a time.
      3. Generate the environment report and inspect its version, architecture,
         path, and redaction details.
    - Expected: the supported setup passes, every unsupported prerequisite fails
      before build work with a precise repair path, and the report contains no
      credential or sensitive user data.
    - Notes:
  - [ ] S5-F1-T4/T6 — Bootstrap and difficult paths
    - Test instructions:
      1. Run the documented prerequisite/bootstrap command.
      2. Clone into a spaces-and-Unicode path under a standard user.
      3. Run install and diagnostics from PowerShell.
    - Expected: no WSL/Git Bash/source patch is needed and diagnostics expose no
      token or private path.
    - Notes:

- [ ] S5-F2 — Portable build scripts
  - State: not tested
  - Feature test: Run install, check, build, and cancellation from PowerShell
    without a POSIX compatibility layer.
  - Prerequisites: supported Stage 5 toolchain.
  - Expected: commands preserve arguments, exit codes, logs, and cleanup.
  - [ ] S5-F2-T1/T2/T3/T6/T7 — Portable command suite
    - Test instructions:
      1. From PowerShell, run install, typecheck, lint, test, production build,
         preview packaging, and any documented critical helper command.
      2. Intentionally fail one ordered check and inspect whether later work
         stops and the original exit code is retained.
      3. Inspect the required-command report for an undocumented POSIX-only
         dependency or hard-coded platform path.
    - Expected: the root commands work without WSL or Git Bash, ordered checks
      stop on the first failure, and no critical path requires a hidden shell
      assumption.
    - Notes:
  - [ ] S5-F2-T4 — Lock contention and stale recovery
    - Test instructions:
      1. Start one bounded heavy job and request the same lock from a second
         process.
      2. Stop the owner normally, then simulate a stale owner record and retry.
      3. Inspect the resulting lock and owned child processes.
    - Expected: contention never runs duplicate work, stale state recovers
      safely, and cleanup removes only the owning Flapstack job.
    - Notes:
  - [ ] S5-F2-T5/T8 — Quoting, cancellation, and logs
    - Test instructions:
      1. Run commands against paths containing spaces, Unicode, ampersands, and
         parentheses.
      2. Cancel a long-running command with Ctrl+C.
      3. Inspect the exit code, log, and child processes.
    - Expected: arguments arrive intact, cancellation is prompt, and no child or
      lock remains.
    - Notes:

- [ ] S5-F3 — Native dependency install
  - State: not tested
  - Feature test: Install from a clean cache, launch native terminal/database
    modules in Electron, then force one repair.
  - Prerequisites: supported C++/Rust/CMake toolchain.
  - Expected: Node and Electron ABIs are correct and repair leaves usable state.
  - [ ] S5-F3-T1/T2/T6/T7 — Native install phases and downloads
    - Test instructions:
      1. Install from an empty cache and inspect the declared dependency,
         download, rebuild, verification, and marker phases.
      2. Interrupt one Windows x64 binary/model download, then retry it with the
         cached partial content present.
      3. Run the documented speech-sidecar/model preparation and inspect the
         packaged staging input.
    - Expected: checksums and architecture are verified before use, retries do
      not trust incomplete content, and a success marker appears only after real
      native and speech probes pass.
    - Notes:
  - [ ] S5-F3-T3/T4/T5 — Native ABI and repair
    - Test instructions:
      1. Complete a clean install.
      2. Start a PowerShell PTY and exercise a database operation.
      3. Invalidate the native marker/cache and run repair.
    - Expected: both ABI probes pass and repair neither loops nor corrupts the
      install.
    - Notes:

- [ ] S5-F4 — Windows CI and development lifecycle
  - State: not tested
  - Feature test: Start the full Dev stack, verify its exact checkout/profile,
    interrupt it, restart it, and recover from a stale lock.
  - Prerequisites: repository checkout on Windows.
  - Expected: one command owns the stack and cleanup never kills unrelated work.
  - [ ] S5-F4-T1/T2/T3 — Windows CI artifact evidence
    - Test instructions:
      1. Open the exact-candidate Windows CI run and verify its source revision,
         supported runner/toolchain, and bounded timeout.
      2. Download the retained Preview/package evidence and compare its manifest
         and hash with the candidate ledger.
      3. Inspect both a successful and intentionally failed job log.
    - Expected: CI builds the intended candidate from a clean checkout, retained
      artifacts are attributable, and logs diagnose failures without exposing
      credentials or private paths.
    - Notes:
  - [ ] S5-F4-T4/T5 — Dev ownership and verification
    - Test instructions:
      1. Run the root development command.
      2. Run `npm run dev:verify`.
      3. Attempt verification against a conflicting packaged instance.
    - Expected: the exact checkout and Dev profile pass; conflict fails clearly.
    - Notes:
  - [ ] S5-F4-T6/T7 — Restart and stale-state recovery
    - Test instructions:
      1. Stop Dev normally, then by Ctrl+C and abrupt termination.
      2. Restart after sleep/wake and after creating a stale lock condition.
      3. Inspect ports and owned processes.
    - Expected: owned state recovers and unrelated processes remain untouched.
    - Notes:

- [ ] S5-F5 — Windows OS integration
  - State: not tested
  - Feature test: Exercise open-path, PowerShell terminal, credentials,
    background work, deep links, power/network changes, and Windows file paths.
  - Prerequisites: Windows standard-user profile.
  - Expected: behavior is Windows-native and recoverable with correct ownership.
  - [ ] S5-F5-T1/T2 — Open actions and terminal
    - Test instructions:
      1. Open a project file/folder from Flapstack.
      2. Open the default Windows terminal and run UTF-8 output.
      3. Resize, cancel a command, and close the terminal.
    - Expected: Windows opens the correct target and terminal behavior leaves no
      orphaned process.
    - Notes:
  - [ ] S5-F5-T3/T4/T5 — Credentials, tasks, and identity
    - Test instructions:
      1. Save a disposable credential and restart.
      2. Create, disable, and remove a scheduled/background action.
      3. Open both Dev and product deep links.
    - Expected: DPAPI state survives, owned tasks clean up, and identities route
      to the correct profile/window.
    - Notes:
  - [ ] S5-F5-T3 — DPAPI migration and fail-closed behavior
    - Test instructions:
      1. Start with a disposable legacy plaintext credential, launch the
         candidate, and verify the supported migration completes.
      2. Restart under the same Windows user and confirm the credential can be
         used without its value appearing in UI, logs, diagnostics, or exports.
      3. Copy the protected value to a different Windows user/profile or corrupt
         it, then attempt to use it.
    - Expected: successful migration removes the plaintext source, normal use is
      secret-safe, and wrong-user or corrupt DPAPI data fails closed with repair
      guidance instead of falling back to plaintext.
    - Notes:
  - [ ] S5-F5-T8 — Power, network, security, and locks
    - Test instructions:
      1. Lock/unlock and sleep/wake Windows during a safe operation.
      2. Disconnect/reconnect the network.
      3. Repeat with a locked file or ordinary antivirus scan.
    - Expected: recovery is visible and no data or owned process is stranded.
    - Notes:
  - [ ] S5-F5-T6/T7 — Process and filesystem ownership
    - Test instructions:
      1. Launch terminal, provider, speech, and background child work, then stop
         the owning run and inspect the remaining processes.
      2. Exercise profile, cache, log, temporary, project, and package paths that
         include spaces, Unicode, long names, and a locked file.
      3. Attempt a traversal, junction escape, or operation against an unowned
         external path.
    - Expected: child cleanup follows the owning Flapstack instance, supported
      Windows paths work, and unsafe or unowned filesystem targets fail without
      deleting or overwriting external data.
    - Notes:

- [ ] S5-F6 — Agent harness parity
  - State: not tested
  - Feature test: Log into Claude and Codex, run a tool-using task in each, test
    approval/denial/cancel/resume, and repeat in the packaged app.
  - Prerequisites: test accounts for both providers.
  - Expected: both harnesses use native Windows binaries with equivalent
    lifecycle, audit, and recovery behavior.
  - [ ] S5-F6-T1/T2 — Native provider binary resolution
    - Test instructions:
      1. In Dev and the packaged candidate, inspect diagnostics for the resolved
         Claude and Codex executable paths, versions, and architecture.
      2. Temporarily make a configured or bundled binary unavailable and request
         provider status and repair.
      3. Restore it and launch one bounded run from a path containing spaces and
         Unicode.
    - Expected: each provider uses the intended Windows x64 binary, missing or
      incompatible binaries fail before a run starts with repair guidance, and
      no unrelated executable is selected from `PATH`.
    - Notes:
  - [ ] S5-F6-T4/T5 — Product MCP defaults and permission gates
    - Test instructions:
      1. Create fresh Codex, Claude, Cursor, OpenRouter, and NanoGPT chats in the
         Windows candidate, and compare product MCP exposure with a fresh local
         or unsupported harness chat.
      2. In full access, run a bounded Tier 3 product MCP spawn or launch and
         confirm it completes without an approval prompt.
      3. Repeat in ask-before-edits or another guarded writable mode, approve the
         fresh prompt, then deny a second request.
    - Expected: supported provider chats default product MCP on while local or
      unsupported chats stay off; full access auto-approves the allowed Tier 3
      call; guarded mode prompts once; denial performs no work; all decisions
      appear in audit history.
    - Notes:
  - [ ] S5-F6-T3/T4/T5/T6 — Login, sessions, tools, and cleanup
    - Test instructions:
      1. Verify login/status for both providers.
      2. Run global, project, and task chats; approve and deny tools.
      3. Cancel, retry, restart, and resume supported sessions.
    - Expected: permissions and history are accurate and no provider process is
      orphaned.
    - Notes:
  - [ ] S5-F6-T7 — Packaged parity
    - Test instructions:
      1. Repeat the bounded Claude and Codex workflows in a clean package.
      2. Compare visible behavior and diagnostics with verified Dev.
    - Expected: package behavior matches or declares an explicit limitation.
    - Notes:

- [ ] S5-F7 — Speech and voice parity
  - State: not tested
  - Feature test: Dictate locally, use configured cloud fallback, play and stop
    TTS, change devices, deny permission, and restart.
  - Prerequisites: microphone, audio output, local models, optional cloud test key.
  - Expected: recording ownership is visible, fallback is explicit, and
    temporary/model/process state recovers cleanly.
  - [ ] S5-F7-T1/T2 — Speech prerequisites and secure credentials
    - Test instructions:
      1. Run the documented Windows speech preparation and inspect local engine,
         model, sidecar, and system-voice readiness.
      2. Save, replace, and remove a disposable cloud speech credential, then
         restart under the same Windows user.
      3. Make one prerequisite unavailable and request a local and cloud speech
         operation.
    - Expected: readiness and repair instructions identify the exact missing
      component, credentials use Windows-protected storage, and unavailable
      local speech never causes an undeclared cloud fallback.
    - Notes:
  - [ ] S5-F7-T3/T4/T5 — Dictation and transcription
    - Test instructions:
      1. Record and transcribe locally.
      2. Exercise configured cloud fallback.
      3. Deny or remove the microphone and try again.
    - Expected: no hidden recording occurs and the next valid session is not
      wedged.
    - Notes:
  - [ ] S5-F7-T6/T7 — TTS and lifecycle
    - Test instructions:
      1. Play system and offline TTS.
      2. Stop playback, change output device, and restart Flapstack.
      3. Use a disposable cloud TTS credential, then inspect logs, command lines,
         temporary files, diagnostics, and playback history before and after a
         forced TTS failure.
    - Expected: only current audio plays, owned resources clean up, and neither
      credentials nor protected request data appear in argv, logs, diagnostics,
      or persistent temporary artifacts.
    - Notes:

- [ ] S5-F8 — Windows packaging and security
  - State: not tested
  - Feature test: Install Preview/NSIS/portable artifacts, inspect identity and
    security prompts, upgrade/repair/rollback, then uninstall with both data
    choices.
  - Prerequisites: clean and upgrade Windows VMs; candidate artifacts and hashes.
  - Expected: artifacts match the candidate, preserve supported data, and remove
    only owned state.
  - [ ] S5-F8-T1/T2/T3 — Artifact build, staging, and inspection
    - Test instructions:
      1. Build the unpacked Preview, NSIS installer, and portable artifact from a
         clean exact-candidate checkout.
      2. Compare the fresh staging manifest with the source revision/version and
         inspect it for an unexpected development file, cache, credential, or
         user profile artifact.
      3. Run the package inspector and verify required Windows executables, DLLs,
         native modules, speech assets, licenses, and provider binaries.
    - Expected: all three outputs belong to the exact candidate, staging is
      allowlisted and secret-safe, native Electron ABI checks pass before
      packaging, and no required component is missing or wrong-architecture.
    - Notes:
  - [ ] S5-F8-T4/T5 — Preview, installer, and portable runtime
    - Test instructions:
      1. Launch Preview and portable artifacts.
      2. Install the NSIS artifact as a standard user.
      3. Open from Start menu and protocol.
    - Expected: correct product identity/profile opens with only expected
      Windows security/UAC prompts.
    - Notes:
  - [ ] S5-F8-T6 — Package lifecycle
    - Test instructions:
      1. Upgrade an existing profile and verify preserved data.
      2. Repair/reinstall and rehearse supported rollback.
      3. Run the default uninstall and verify app data is kept, reinstall, then
         run the documented `--delete-app-data` uninstall path and verify only
         Flapstack-owned data is removed.
    - Expected: migrations and restoration are sound; owned processes, tasks,
      protocols, and binaries clean up; default uninstall keeps profile data;
      `--delete-app-data` removes the owned profile without touching unrelated
      data.
    - Notes:
  - [ ] S5-F8-T7/T8 — Signature and security evidence
    - Test instructions:
      1. Verify Authenticode signature, certificate chain, and timestamp when a
         signed candidate is available, then compare published hashes.
      2. Scan every installer, portable, and unpacked candidate with Microsoft
         Defender and review any SmartScreen or reputation prompt without
         bypassing a real detection.
      3. Review the candidate security report covering every distributed file,
         dependencies/licenses, malware results, secret scan, and acknowledged
         exceptions.
    - Expected: signing claims match actual status, hashes match exact artifacts,
      Defender has no unresolved detection, every distributed file is covered by
      the security report, and no unsafe bypass is required.
    - Notes:

- [ ] S5-F9 — Integrated Windows release
  - State: not tested
  - Feature test: Follow the complete development and packaged walkthroughs on
    the exact candidate, then record personal acceptance or issues.
  - Prerequisites: candidate ledger; clean and upgrade VMs; all prior feature
    checks available.
  - Expected: the product feels coherent across Dev, clean install, upgrade,
    recovery, and uninstall; all notes identify exact build and step.
  - [ ] S5-F9-T1/T3/T4/T5/T6/T8 — Exact-candidate integrated regression
    - Test instructions:
      1. Record the source revision, app version, artifact hashes, Windows build,
         profile type, and signing status before testing.
      2. Complete one native Dev run and the clean-install, upgrade,
         failure-recovery, and uninstall package journeys using that same
         candidate.
      3. Reopen an existing Stage 4 profile, exercise representative workspace,
         agent, MCP, voice, automation, and portability features, and record any
         blocker or accepted limitation.
    - Expected: all evidence belongs to one immutable candidate, shared Stage 4
      behavior remains intact on Windows, failures recover without data loss, and
      the final go/no-go notes identify every unresolved limitation.
    - Notes:
  - [ ] S5-F9-T7 — Owner walkthrough and documentation feedback
    - Test instructions:
      1. Follow [`stage5-windows-manual-test.md`](stage5-windows-manual-test.md).
      2. Record failed step, expected/actual behavior, Windows build, artifact
         hash, and whether restart reproduces it.
      3. Mark this entry passed, issue found, retest required, or accepted with
         limitation.
    - Expected: owner feedback is reproducible and mapped to the exact candidate.
    - Notes:
