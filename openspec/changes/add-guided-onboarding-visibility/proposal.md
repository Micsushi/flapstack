# Change: Add guided onboarding and progressive feature visibility

## Why

Flapstack's complete feature set can overwhelm users who only need one or two
agents. First-run guidance should reveal the right default UI without disabling
underlying capabilities or forcing permanent choices.

## What Changes

- Add a first-run work-style questionnaire and reviewable visibility setup.
- Add reviewable visibility presets backed by a typed feature registry.
- Keep hidden features operational, safe, searchable, and individually configurable.
- Add reusable feature explanations and contextual help.
- Allow the guide to rerun with preview and data-safe application.

## Impact

- Affected specs: new guided-onboarding capability.
- Affected code: onboarding router, settings, navigation registry, persistence,
  feature descriptions, migrations, accessibility, and tests. The concise
  main-page product tour is owned by
  `add-stage5-ui-polish-and-guided-tour`.
