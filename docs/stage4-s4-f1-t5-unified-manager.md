# S4-F1-T5 unified extension manager

## Headless code-ready evidence

- One shared Settings component now inventories native extensions, plugin inventory, and managed hooks.
- Harness, kind, source, native-scope, and normalized text filters are independent.
- Every row shows its native or managed source path, capability-registry support, runtime-consumption state, and limitations.
- User, project, and task policy resolution is visible. Unsupported policy scopes cannot write state.
- Native create/edit and cross-harness copy use the existing preview DTOs. Apply requires a second explicit review checkbox and the preview hashes.
- Disable/enable policy changes and managed-hook disablement show an exact policy or lifecycle diff before confirmation.
- Hook imports show exact command validation and remain disabled after import. Hook enablement stays outside this surface until validation, dry-run, and Tier 3 approval succeed.
- Search shortcut, labelled controls, live result count, roving listbox focus, arrow/Home/End navigation, and screen-reader selection state are covered by headless contracts.

## Manual verification remaining

- Live Settings rendering and pointer/keyboard/screen-reader walkthrough.
- User, project, and task mutations against a running Dev profile.
- Restart/runtime-consumption behavior after the final policy change.
- Packaged preview behavior and platform-specific accessibility proof.

No Electron, Playwright, live UI, package preview, provider-spend, network-device,
or physical-device test was run for this task.
