# S4-F1-T5 unified extension manager

## Headless code-ready evidence

- One shared Settings component now inventories native extensions, plugin inventory, and managed hooks.
- Harness, kind, source, native-scope, and normalized text filters are independent.
- Every row shows its native or managed source path, capability-registry support, runtime-consumption state, and limitations.
- User, project, and task policy resolution is visible. Unsupported policy scopes cannot write state.
- Native create/edit and cross-harness copy use the existing preview DTOs. Apply requires a second explicit review checkbox and the preview hashes.
- Disable/enable policy changes and managed-hook disablement show an exact policy or lifecycle diff before confirmation.
- Hook imports show exact command validation and remain disabled after import. The same surface previews validation, bounded dry-run, enablement, and disablement; dry-run and enablement each require Tier 3 approval and current-revision evidence.
- Search shortcut, labelled controls, live result count, roving listbox focus, arrow/Home/End navigation, and screen-reader selection state are covered by headless contracts.

## Consolidated headless verification

- Node 22 F1 service, router, renderer-contract, policy, adapter, copy, hook,
  permission, and invalidation coverage passes 11 files / 144 tests.
- Full TypeScript and focused ESLint pass after removing unrelated F3 Settings
  hunks from the extracted integration diff.
- Lifecycle controls expose current validation and dry-run state, exact command,
  runtime-consumption limitation, disabled prerequisites, labelled action group,
  preview diff, and explicit confirmation.

## Dev-profile walkthrough

- `npm run dev:verify` identified this exact checkout and the isolated
  `~/Library/Application Support/Flapstack Dev` profile.
- With the selected project pointing at the removed
  `/Users/michaelshi/.codex/worktrees/1188/flapstack` root, the manager retained
  the 19-row user inventory, reported the root-verification failure, and kept
  project policy mutation disabled.
- After selecting the registered `/Users/michaelshi/Documents/GitHub/flapstack`
  project, the same inventory loaded without the refresh error and enabled the
  project-policy preview.
- The preview exposed the supported result, exact project policy record and
  native source path, and the resolved-state diff. `Confirm and apply` remained
  disabled until its review checkbox; the preview was cancelled, so this
  walkthrough wrote no extension or policy state.

## Manual verification remaining

- Keyboard and screen-reader walkthrough.
- Applied user, project, and task mutations against a running Dev profile.
- Restart/runtime-consumption behavior after the final policy change.
- Packaged preview behavior and platform-specific accessibility proof.

No Playwright, package preview, provider-spend, network-device, or
physical-device test was run for this task. The Electron Dev walkthrough above
covered inventory and a cancelled project-policy preview only.
