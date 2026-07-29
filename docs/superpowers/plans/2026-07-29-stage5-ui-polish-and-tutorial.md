# Stage 5 UI Polish and Guided Tutorial Implementation Plan

> REQUIRED SUB-SKILL: Use `executing-plans` when implementation begins.

**Goal:** Bring the Windows UI up to the same level of finish as macOS, remove distracting chat-navigation motion, correct cross-platform behavior, make Claude Opus 5 and OpenAI GPT-5.6 Sol the new-chat defaults, make completed-chat notifications deep-link reliably, and move the user-facing tutorial from Stage 6 into a Stage 5 patch.

**Implementation target:** Work directly on `main`, as requested. Treat `C:\Users\sushi\Documents\Github\temp\flapstack-stage6` as read-only. Do not merge, rebase, clean, or edit that worktree.

**Architecture:** Keep shared visual geometry platform-neutral. Put genuine operating-system differences behind typed main/preload APIs. Leave provider-specific reasoning, skill selection, tool use, runtime launch behavior, and activity presentation unchanged in this patch. Change only the model catalog/default wiring. Implement the tutorial as a versioned, anchor-driven coachmark tour over the actual main page, independent from Stage 6's feature-visibility questionnaire.

**Verification policy:** Every task starts with a failing focused test, implements the smallest fix, then runs focused tests. Finish with typecheck, lint, the affected regression suites, a Windows preview package, and a macOS build/package inspection where the current machine permits it. Do not claim the user's manual Stage 1–5 pass is complete. Do not create commits unless the user separately authorizes them.

## Acceptance criteria

- Opening Flapstack without a selected project shows the normal application shell and a useful home state, not a full-screen repository picker.
- Switching between existing chats does not replay left-to-right title typing or scale/slide the conversation.
- Long-running planning status is stable, restrained, readable, and respects reduced motion.
- The project sidebar has a more useful default width in fullscreen and clicking its resize divider never closes it.
- Modes are `Write`, `Plan`, and `Review`; `Read` is migrated to `Review`; the selector supports click, keyboard, and drag.
- Windows preview/release windows show the Flapstack icon and correctly spaced titlebar chrome.
- Header actions are clickable, header title/folder icon are optically aligned, and project/provider chips share one centered geometry.
- Collapsible sidebar chevrons use one position and hover/focus behavior. Chat row padding and tint-bar geometry are consistent.
- Claude Opus 5 is available and is the default for new Claude chats. Opus 4.8 remains selectable for existing and explicit chats while Anthropic continues to support it.
- OpenAI GPT-5.6 Sol is the default for new Codex API-key chats instead of GPT-5.5. Existing chats with an explicitly stored model remain unchanged.
- The Open In menu lists only platform-valid, installed applications. Windows says `Open folder` or `File Explorer`; macOS says `Finder`.
- Clicking a completion notification focuses Flapstack and opens the exact project, chat, and subchat, including cold-renderer and cross-project cases.
- A short main-page tutorial auto-runs once only in a normal packaged profile, never auto-runs in development/test profiles, and can always be rerun from Settings.
- Stage 5 and Stage 6 documentation agree that the product tutorial is a Stage 5 patch. Stage 6 retains only its feature-visibility questionnaire/setup work.

## Task 1: Establish the Stage 5 patch contract

**Files**

- Create: `openspec/changes/add-stage5-ui-polish-and-guided-tour/proposal.md`
- Create: `openspec/changes/add-stage5-ui-polish-and-guided-tour/design.md`
- Create: `openspec/changes/add-stage5-ui-polish-and-guided-tour/tasks.md`
- Create: `openspec/changes/add-stage5-ui-polish-and-guided-tour/specs/ui-polish/spec.md`
- Create: `openspec/changes/add-stage5-ui-polish-and-guided-tour/specs/guided-tour/spec.md`
- Modify: Stage matrix/index files that currently enumerate Stage 5 patches

**Steps**

1. Write scenarios for every acceptance criterion above, including Windows/macOS differences and development/test tutorial suppression.
2. Run the repository's OpenSpec validation command discovered from `openspec/AGENTS.md` or the adjacent accepted changes.
3. Correct schema or scenario failures before product code changes.
4. Mark this as a commit-ready checkpoint without committing.

## Task 2: Update provider model defaults without destabilizing old chats

**Files**

- Modify: `src/shared/model-catalog.ts`
- Modify: `tests/model-catalog.test.ts`
- Inspect and modify only if a live smoke rejects Opus 5:
  - `package.json`
  - `package-lock.json`
  - `scripts/download-claude-binary.mjs`
  - `scripts/prepare-package-resources.mjs`
  - Claude runtime fixtures and capability metadata under `src/main/lib/agent-runtime/claude-code/`

**Steps**

1. Add a failing catalog test asserting `claude-opus-5` is first, selectable, mapped, and the new-chat default.
2. Add a failing catalog test asserting `DEFAULT_CODEX_MODEL_ID` is `gpt-5.6-sol` instead of `gpt-5.5`.
3. Add migration assertions proving stored `claude-opus-4-8` and `gpt-5.5` values remain valid and are not silently rewritten.
4. Add Opus 5 to `CLAUDE_MODELS` and `CLAUDE_MODEL_ID_MAP`; change `DEFAULT_CLAUDE_MODEL_ID` and `DEFAULT_CODEX_MODEL_ID` only.
5. Run:

   ```powershell
   npm run test:model-catalog
   npm run ts:check
   ```

6. Send controlled development chats using Opus 5 and GPT-5.6 Sol. Upgrade the bundled Claude SDK/CLI only if the Opus 5 smoke reports an actual unsupported-model or protocol error; otherwise leave every provider runtime pin unchanged.

## Task 3: Verify default propagation and preserve provider behavior

**Files**

- Inspect and modify tests only where needed:
  - `src/renderer/features/agents/atoms/index.ts`
  - `src/renderer/features/agents/lib/models.ts`
  - `src/renderer/features/agents/main/new-chat-form.tsx`
  - `src/renderer/features/agents/lib/acp-chat-transport.ts`
  - `tests/agent-runtime-defaults.test.ts`
  - `tests/model-catalog.test.ts`

**Steps**

1. Add failing renderer/default tests proving a new Claude chat selects Opus 5 and a new Codex API-key chat selects GPT-5.6 Sol.
2. Add tests proving existing chats, subchats, and drafts with explicit older model IDs are not rewritten.
3. Confirm the shared default constants already propagate through renderer atoms and transports; avoid duplicate literals.
4. Do not change Codex/Claude prompts, skills, executable paths, runtime versions, tool selection, reasoning behavior, or activity UI.
5. Run the catalog and runtime-default suites.

## Task 4: Replace the repository-picker start page with an in-shell home state

**Files**

- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/features/layout/agents-layout.tsx`
- Create: `src/renderer/features/agents/main/workspace-home.tsx`
- Refactor: `src/renderer/features/onboarding/select-repo-page.tsx`
- Add: `tests/workspace-home.test.tsx`
- Modify: project-selection tests that assert the old full-screen page

**Steps**

1. Add a failing renderer test proving `AgentsLayout` remains mounted when no project is selected.
2. Add a failing interaction test for `Open folder`, `Clone repository`, `New global chat`, and recent-project selection.
3. Move the existing repository-opening/clone mutations into reusable actions or a dialog.
4. Render a quiet home state in the main content pane while keeping the sidebar, settings, and project navigation available.
5. Ensure empty, loading, invalid-recent-project, and keyboard-focus states are explicit.

## Task 5: Remove repetitive chat-switch animation and stabilize planning status

**Files**

- Modify: `src/renderer/features/agents/main/active-chat.tsx`
- Modify: `src/renderer/features/agents/main/chat-title-editor.tsx`
- Modify: `src/renderer/components/ui/typewriter-text.tsx`
- Modify: `src/renderer/features/agents/main/agent-tool-registry.tsx`
- Add: `tests/chat-switch-motion.test.tsx`
- Add: `tests/planning-status.test.tsx`

**Steps**

1. Add a failing test showing that navigating from chat A to chat B renders B's existing title immediately and does not apply a scale/slide transform.
2. Restrict title typing to the one moment a newly generated title first arrives. Navigation and remounts must render stored titles statically.
3. Remove the `scale(0.98)` chat-tab transition and any navigation-specific horizontal movement. Retain only immediate visibility changes or a very short opacity change.
4. Replace render-time random status words with a deterministic phrase sequence keyed to the active run/tool. Rotate no faster than every 4 seconds.
5. Expand the phrase set with restrained development language such as `Analyzing context`, `Tracing code`, `Planning changes`, and `Checking constraints`.
6. Under `prefers-reduced-motion`, render one static phrase and no typewriter effect.

## Task 6: Improve sidebar sizing and divider behavior

**Files**

- Modify: the `agentsSidebarWidthAtom` definition
- Modify: `src/renderer/features/layout/agents-layout.tsx`
- Modify: the shared resizable-sidebar component used by `AgentsLayout`
- Add: `tests/agents-sidebar-resize.test.tsx`

**Steps**

1. Add failing tests for a 272 px default, a wider maximum, persisted custom widths, and a divider click that does not close the sidebar.
2. Change the default to 272 px and allow resizing to 360 px.
3. Migrate only the legacy untouched 224 px value. Preserve every explicit user width.
4. Pass `disableClickToClose`; closing remains available through the explicit control and keyboard shortcut.
5. Verify fullscreen, restored-window, minimum-width, and high-DPI behavior.

## Task 7: Replace Read mode with a three-stop segmented mode control

**Files**

- Modify: `src/shared/chat-mode.ts`
- Modify: the `AgentModeSelector` component
- Modify: chat-mode persistence/migration
- Modify: `tests/chat-mode.test.ts`
- Modify: `tests/chat-mode-migration.test.ts`
- Modify: `tests/agent-mode-selector-interaction.test.ts`
- Modify: `tests/permission-ui-contract.test.ts`

**Steps**

1. Add failing tests for exactly `Write`, `Plan`, and `Review`.
2. Add migration coverage that normalizes legacy `read` to `review`.
3. Implement a three-stop segmented track with click, arrow-key, Home/End, and pointer-drag selection.
4. Keep permission semantics separate: Write may mutate; Plan and Review are read-only.
5. Add accessible labels, selected state, focus ring, and coarse-pointer coverage.

## Task 8: Polish Windows chrome and the active-chat header

**Files**

- Modify: `src/main/windows/main.ts`
- Modify: the Windows titlebar component
- Modify: `src/renderer/features/agents/main/active-chat.tsx`
- Modify: `src/renderer/features/agents/main/chat-title-editor.tsx`
- Modify: shared header chip/control styles
- Modify: `tests/active-chat-header-actions.test.ts`
- Add: `tests/windows-window-icon.test.ts`
- Add: `tests/chat-header-alignment.test.tsx`

**Steps**

1. Add a failing test for development and packaged Windows icon resolution.
2. Set the Windows `BrowserWindow` icon and render a 16 px Flapstack mark in the custom titlebar with an 8 px left inset.
3. Make the complete right-side header action cluster `no-drag`, not only individual children.
4. Define one 28 px header-control geometry. Use an 18 px folder icon, explicit line height, and centered project/provider chips.
5. Keep the CSS identical across operating systems except for real native-window chrome differences. Do not add Windows-only baseline offsets.
6. Test 100%, 125%, 150%, and 200% Windows display scaling; inspect a macOS preview for regression.

## Task 9: Standardize sidebar disclosure arrows and chat-row spacing

**Files**

- Modify: `src/renderer/features/agents/sidebar/agents-sidebar.tsx`
- Create or refactor: a shared collapsible sidebar header component
- Add: `tests/agents-sidebar-sections.test.tsx`
- Add: `tests/chat-row-geometry.test.tsx`

**Steps**

1. Add failing tests proving Drafts, Projects, Chats, and Archive use the same trailing-chevron slot.
2. Show the chevron when the section is open, hovered, or keyboard-focused. Keep the target available to assistive technology.
3. Reduce top padding and add slightly more bottom padding to chat rows so label baselines sit optically centered.
4. Keep the existing color-bar hue/meaning; change only its inset and vertical geometry.

## Task 10: Make Open In platform-aware and installation-aware

**Files**

- Modify: `src/shared/external-apps.ts`
- Modify: `src/main/lib/external/app-launch.ts`
- Modify: the external-app tRPC/IPC router
- Modify: `src/renderer/components/open-in-button.tsx`
- Modify: `tests/external-app-launch.test.ts`
- Modify: `tests/external-editor.test.ts`
- Modify: `tests/open-in-button.test.ts`

**Steps**

1. Add a typed `listAvailableApps` contract and failing platform matrices for Windows, macOS, and Linux.
2. Detect installed executables/app bundles in main process. Cache the result briefly and provide a refresh path.
3. Always return one native folder action:
   - macOS: `Finder`
   - Windows: `Open folder` with File Explorer icon
   - Linux: `Open folder`
4. Return Cursor, Zed, Sublime Text, Xcode, iTerm, Warp, Terminal, Ghostty, VS Code variants, and JetBrains variants only when valid for the current platform and actually installed.
5. If a saved preferred app is unavailable, fall back to the native folder action without an error.
6. Use platform-correct shortcut labels: Command on macOS, Control on Windows/Linux.

## Task 11: Make completion notifications deep-link to the exact conversation

**Files**

- Modify: main-process notification handling
- Modify: `src/preload/index.ts`
- Move/refactor: notification navigation currently in `src/renderer/features/agents/ui/agents-content.tsx`
- Modify: `src/renderer/App.tsx`
- Create: `src/renderer/lib/navigate-to-chat.ts`
- Add: `tests/notification-deep-link.test.ts`
- Extend: notification main/preload contract tests

**Steps**

1. Add failing tests for same-project, cross-project, subchat, settings-open, no-project-selected, and renderer-reload clicks.
2. In main, retain the latest unconsumed notification target and send it to the current/focused main window once ready.
3. Expose a consume-once preload method so a click cannot be lost while the renderer is loading or the project shell is absent.
4. Install the listener at app scope. Resolve the chat's project, select it, wait for project/chat state hydration, then select the exact chat and subchat.
5. Focus and restore the main window before navigation. Do not open a duplicate window.
6. Verify with the development notification control and a packaged Windows preview.

## Task 12: Move the product tutorial into a Stage 5 patch

**Reference only**

- `C:\Users\sushi\Documents\Github\temp\flapstack-stage6\src\renderer\features\onboarding\feature-visibility-onboarding-page.tsx`
- `C:\Users\sushi\Documents\Github\temp\flapstack-stage6\src\shared\feature-visibility.ts`
- `C:\Users\sushi\Documents\Github\temp\flapstack-stage6\src\shared\onboarding-visibility.ts`

**Files**

- Create: `src/shared/product-tour.ts`
- Create: `src/renderer/features/onboarding/product-tour.tsx`
- Modify: main-page components to add stable `data-tour-id` anchors
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/dialogs/settings-tabs/agents-preferences-tab.tsx`
- Modify: `src/renderer/features/settings/settings-search.ts`
- Add: `tests/product-tour-state.test.ts`
- Add: `tests/product-tour-renderer.test.tsx`
- Add: `tests/product-tour-settings.test.tsx`

**Steps**

1. Add failing state tests for a versioned completion key, packaged first run, development suppression, test suppression, version upgrades, completion, dismissal, and manual rerun.
2. Define 6–8 short steps with stable anchors. Each explanation is one title plus no more than two short sentences. Cover:
   - project/task/chat hierarchy
   - runtime and model selection, with `agent-hotline` as a simple runtime example
   - Write/Plan/Review
   - permissions
   - worktree/terminal/diff surfaces
   - completion notifications
   - Settings
3. Auto-start only when `desktopApi.isPackaged()` is true, the profile is not a test/preview fixture profile, and the current tutorial version is incomplete.
4. Never auto-start from `import.meta.env.DEV`. A Settings `Run tutorial` button may start it manually in any profile.
5. Use an accessible coachmark/dialog overlay with Back, Next, Skip, Done, Escape, focus management, scroll-into-view, and missing-anchor fallback.
6. Reuse only presentation/state ideas from Stage 6. Do not copy the Stage 6 feature-visibility questionnaire or write to its worktree.

## Task 13: Correct Stage 5 and Stage 6 documentation

**Files**

- Modify: the Stage 5 README/matrix/index documents that list accepted patches
- Modify on `main`: `openspec/changes/add-guided-onboarding-visibility/` so its Stage 6 scope is only feature visibility/setup
- Modify: Stage 6 README, execution plan, and documentation matrix references on `main`
- Modify: root README stage summary if it currently assigns the product tutorial to Stage 6

**Steps**

1. Add the Stage 5 UI polish/tutorial patch to the Stage 5 documentation without renumbering an existing patch.
2. Remove product-tour ownership from Stage 6 prose and tasks. Preserve the Stage 6 feature-visibility questionnaire as a separate capability.
3. Link both stages to their canonical OpenSpec changes so future work does not duplicate tutorial code.
4. Run markdown/style checks and the OpenSpec validator.

## Task 14: Full polish and regression pass

**Automated commands**

```powershell
npm run test:model-catalog
npm test -- tests/chat-mode.test.ts tests/chat-mode-migration.test.ts tests/agent-mode-selector-interaction.test.ts
npm test -- tests/active-chat-header-actions.test.ts tests/open-in-button.test.ts tests/external-app-launch.test.ts
npm test -- tests/notification-deep-link.test.ts tests/product-tour-state.test.ts tests/product-tour-renderer.test.tsx
npm run ts:check
npm run lint
npm run check
npm run package:preview:win
npm run package:inspect:preview:win
npm run package:smoke:preview:win
```

**Manual matrix**

- Windows 11 at 100%, 125%, 150%, and 200% scaling
- Windowed, maximized, fullscreen, and narrow-window layouts
- Dark and light themes
- Mouse, keyboard-only, and reduced-motion
- New packaged profile, existing profile, development profile, and test profile
- macOS visual/package inspection for shared header geometry and Finder/app detection
- Same-project and cross-project completion notifications
- New Claude chat using Opus 5 and an existing stored Opus 4.8 chat
- New Codex API-key chat using GPT-5.6 Sol and an existing stored GPT-5.5 chat

**Completion rule**

Record automated evidence and screenshots in the Stage 5 patch documents. Leave the user's manual Stage 1–5 acceptance item open until the user performs and approves that pass.
