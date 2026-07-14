# Change: Add Open In Control To The Chat Header

## Why

Users need a direct way to open the active conversation's local folder in VS Code or another installed editor without leaving the chat. The control must work consistently for every agent provider because folder selection belongs to the conversation workspace, not the model.

## What Changes

- Add the existing `OpenInButton` control to the shared desktop conversation header.
- Target the active chat's resolved worktree or project folder.
- Keep the primary action tied to the user's preferred editor and retain the existing editor dropdown.
- Disable the control when the conversation has no local folder.
- Cover folder targeting and provider-independent rendering with focused tests.

## Impact

- Affected specs: `workspace-lifecycle`
- Affected code: shared chat header composition and existing external-app launch UI
- Breaking changes: none
