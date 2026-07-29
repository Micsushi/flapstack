# Change: Add the Stage 5 UI polish and guided-tour patch

## Why

Native Windows testing exposed a focused set of interaction, alignment,
navigation, notification, and platform-integration defects in the accepted
Stage 5 application. New users also need a short explanation of the existing
main page before Stage 6 introduces optional feature visibility.

## What Changes

- Replace the full-screen repository picker with an in-shell home state.
- Remove distracting chat-switch motion and stabilize planning-status copy.
- Refine sidebar sizing, mode selection, header alignment, and Windows chrome.
- Make Open In platform- and installation-aware.
- Deep-link completed-chat notifications to the exact conversation.
- Add Claude Opus 5 and GPT-5.6 Sol as new-chat defaults without rewriting
  existing chats.
- Add a versioned, concise main-page product tour that runs once in normal
  packaged profiles and can be rerun from Settings.
- Keep Stage 6 ownership limited to its feature-visibility questionnaire and
  setup flow.

## Impact

- Affected specs: new `stage5-ui-polish` and `stage5-guided-tour`
  capabilities.
- Affected code: renderer shell, chat header, sidebar, mode controls, model
  catalog, external app integration, notifications, Settings, preload/main IPC,
  and focused tests.
- Affected docs: Stage 5 patch routing and Stage 6 onboarding ownership.
