# Change: Add An Adjacent Model Tuning Dropdown

## Why

Reasoning effort and Codex fast mode are buried inside the model picker, so users cannot see the active effort without reopening the full provider/model menu. Model choice and run tuning are separate decisions and should remain independently accessible.

## What Changes

- Keep provider and model selection in the existing model dropdown.
- Add a compact tuning dropdown directly beside the model dropdown in both new-chat and active-chat input bars.
- Show the selected effort or reasoning level on the closed tuning trigger.
- Let supported providers change effort from the tuning dropdown without reopening model selection.
- Show the fast-mode switch only for selected models that explicitly support it.
- Show a visible fast-state indicator when fast mode is enabled.
- Turn fast mode off when the user changes to a model that does not support it.
- Remove effort and fast controls from the provider/model dropdown so the two controls are independent.

## Impact

- Affected specs: `model-run-controls` (new capability)
- Affected code: shared agent model selector, new-chat input controls, active-chat input controls, model capability metadata, focused renderer tests
- Breaking changes: none
