# Flapstack Design

Last updated: 2026-07-10

## Product Feel

Flapstack should feel like a practical coding-agent control room, not a landing
page or decorative dashboard. The first screen is the working app: onboarding
when needed, then projects, chats, agent controls, files, diffs, worktrees, and
settings.

## Current UI From Source

The inherited UI currently starts in `src/renderer/App.tsx`.

- Root providers: Jotai, next-themes, VS Code theme provider, tooltip provider,
  tRPC provider, Sonner toaster.
- Onboarding router: billing method, Anthropic setup, Codex setup, API key
  setup, then repository selection.
- Main shell: `AgentsLayout` owns desktop/fullscreen state, sidebar visibility,
  project validation, settings view, login modals, hotkeys, and traffic-light
  visibility.
- Left side: `AgentsSidebar` is the dense navigation surface for projects,
  chats, pinned/archived state, settings entry points, and new-window actions.
- Main workspace: `AgentsContent` and `ActiveChat` render chat tabs, transcript,
  tool output, input controls, diff/file surfaces, and harness execution state.
- Sub-chat switching: top tabs, quick switch, split view, and direct routing
  remain active. The inherited vertical middle **Chats** pane is hidden behind
  `SUBCHATS_SIDEBAR_PANEL_ENABLED=false` until a future workflow review proves
  it is useful.
- Right/details surfaces: `details-sidebar`, `agent-diff-view`, file viewer,
  terminal, and settings sidebar provide secondary context and inspection.
- Existing inherited areas still visible in source: automations, kanban, inbox,
  sandbox import/open-locally affordances, and remote compatibility shims. These
  are disabled or non-core until the local-first product shape replaces them.

## Current Layout Model

```text
App
  Onboarding screens
  AgentsLayout
    AgentsSidebar
    AgentsContent / ActiveChat
    Details, file viewer, terminal, settings sidebars/dialogs
```

The current code is still chat-first and project-first from the inherited app.
It does not yet fully model Flapstack tasks, global/project/task chat hierarchy,
resolved permission inheritance, or checkpoint/run manifests as first-class UI
objects.

## Target Core Layout

- Left navigation: global chats, projects, project tasks, pinned items, archive
  access.
- Main area: active global/project/task chat workspace.
- Chat tabs: active/latest harness chip, non-default worktree chip,
  pin/archive state where useful.
- Sub-chat tabs: active UI for parallel threads inside one chat. Do not reuse
  the parked vertical **Chats** pane for project/task chat lists; those belong
  in the left navigation.
- Input bar: agent/harness selector, model selector, permission mode, target
  worktree, attachments/context, overflow options.
- Right details panel: branch, commit, worktree, dirty/clean state, changed
  files, diffs, checkpoints, run/change history.

## Future Workspace Layer

This is a future addition after the current defined iteration, not active build
scope.

- Task = what to do: goal, description, acceptance criteria, deadline, status,
  context, artifacts, chats, and runs.
- A task can group multiple chats/threads for one feature or outcome. Chats are
  conversation units; tasks are not conversations.
- Workspace = where/how work happens: saved layout, linked chats, terminals,
  agents, worktrees, browser/editor/diff panes, screenshots, and notes.
- A workspace belongs to either a project or a task. A task workspace gathers
  that task's working surfaces; a project workspace may gather project-level
  surfaces and work from several tasks.
- A future combine action should let users select multiple chats and open them
  in one workspace.
- Default multi-chat workspace window limit: four chat panes. More chats should
  use tabs, pop-out windows, or multiple workspace windows.

## Important UI Decisions

- Do not cram branch, worktree, model, permission, commits, and run state into
  one header.
- Keep the input bar for launch-critical controls and move secondary state into
  the right details panel or an overflow menu.
- Use chips for quick visual identity:
  - Codex: blue
  - Claude Code: orange
  - local model: green
  - OpenRouter: purple
  - unknown/custom: gray
- Use a visible worktree chip when a chat is not using its default worktree.
- Search scope must be explicit and can narrow from global/all to one chat.
- Archives should have a clear entry point plus a short undo action after
  archive.
- Rewind/fork/revert actions must be explicit and should show the
  run/checkpoint/change target before applying.

### Plan And Run Progress Capsule

Future plan/run surfaces should borrow Codex's compact progress capsule as a
visual reference. Keep it glanceable without turning the main header into a
status dump.

- Show a running spinner or completed-state icon, then explicit progress such
  as `Step 4 / 6`.
- Show a compact current summary beside progress, such as `32 files changed`;
  truncate long summaries with an ellipsis instead of growing the capsule.
- Show aggregate diff magnitude inline: additions in green (`+903`) and
  deletions in red (`-114`). Do not rely on color alone; keep the signs and
  accessible labels.
- Clicking the capsule should reveal the full current step, complete plan,
  changed-file list, and diff details. The capsule is a summary, not the only
  route to those details.
- Reuse this pattern for active plan execution and agent runs where step and
  change data exist. Hide unavailable metrics instead of showing fake zeroes.
- Treat the supplied Codex screenshot from 2026-07-10 as visual inspiration,
  not a pixel-for-pixel implementation requirement.

### Conversation Timeline Preview

Future long-chat navigation should borrow Codex's compact conversation
timeline/minimap as a visual reference. It should help users answer “what did I
send here?” without scrolling through the whole transcript.

- Show a slim vertical rail with markers for conversation turns or meaningful
  run events; visually distinguish the current/selected marker.
- Hovering or focusing a marker should open a compact preview containing the
  user's sent message and the beginning of the matching assistant response.
- Truncate both excerpts cleanly. Preserve enough text to identify the turn,
  and expose the full content through the transcript rather than an oversized
  tooltip.
- Clicking a marker or preview should jump to and focus that transcript turn.
- Support keyboard focus, screen-reader labels, and a touch/click interaction;
  do not make hover the only way to inspect sent content.
- Group or thin markers for very long chats so the rail remains readable, with
  search and full history still available as the precise navigation tools.
- Treat the supplied Codex screenshot from 2026-07-10 as visual inspiration,
  not a pixel-for-pixel implementation requirement.

## Current Gaps To Resolve

- Replace inherited hosted/sandbox/automation UI concepts with local-first
  Flapstack projects, tasks, runs, checkpoints, and worktree controls.
- Make tasks visible as folder-like work areas under projects.
- Move permission mode, harness, model, and target worktree into the input bar
  or compact launch controls.
- Make the right details panel the canonical place for run changes, dirty
  state, diffs, commits, checkpoints, and revert/fork/rewind targets.
- Ensure disabled inherited areas are either hidden or clearly marked until
  rebuilt locally.
- Revisit the parked vertical sub-chats **Chats** pane only if the app needs a
  dedicated side list for many sub-chats inside one chat; keep it hidden for now.
