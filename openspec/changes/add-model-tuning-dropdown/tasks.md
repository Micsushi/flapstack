## 1. Shared Controls

- [x] 1.1 Extract provider-aware effort, reasoning-level, and fast-mode presentation into an adjacent tuning dropdown.
- [x] 1.2 Keep the closed tuning trigger glanceable by showing the effective effort/reasoning label and enabled fast state.
- [x] 1.3 Remove effort and fast-mode controls from the provider/model picker while retaining unrelated provider controls.

## 2. Capability Gating

- [x] 2.1 Derive available effort/reasoning choices from the selected model metadata.
- [x] 2.2 Render the fast-mode switch only when the selected model explicitly supports fast mode.
- [x] 2.3 Preserve the existing automatic fast-mode reset when switching to an unsupported model.
- [x] 2.4 Hide the tuning control when the selected provider/model exposes no tunable run settings.

## 3. Integration

- [x] 3.1 Add the tuning dropdown beside model selection in the new-chat input bar.
- [x] 3.2 Add the tuning dropdown beside model selection in the active-chat input bar.
- [x] 3.3 Preserve per-chat and last-selected persistence for effort, reasoning, and fast mode.

## 4. Verification

- [x] 4.1 Add focused tests for visible labels, effort selection, supported fast mode, unsupported fast-mode hiding, and model-switch reset behavior.
- [x] 4.2 Run formatting, lint, strict TypeScript, focused tests, and the production build.
- [ ] 4.3 Run `npm run dev:verify` and manually verify both new-chat and active-chat controls in the `Flapstack Dev` profile.
