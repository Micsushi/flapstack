# Change: Add agent question dialog

## Why

Agents can pause a run to request structured user input, but Flapstack currently
shows Claude questions inline above the composer and does not provide equivalent
behavior for every harness. Users should be able to answer quickly with choices
or deliberately switch to normal free-text chat without losing the paused run.

## What Changes

- Show structured agent questions in a focused Flapstack dialog when a run needs input.
- Support single-select radio choices, multi-select choices, and a custom answer field.
- Let the user switch the whole question set to the normal chat composer with one action.
- Preserve the question list in chat history and keep the originating run visibly paused.
- Resume the same run after a structured answer; use a normal continuation message after
  the user deliberately switches to free-text mode or after the native prompt expires.
- Normalize Claude, Codex, Cursor, OpenRouter, NanoGPT, and future provider question
  requests into one Flapstack-owned renderer contract.
- Give providers without native structured-question events a Flapstack question tool
  contract where their harness supports custom tools; otherwise use an explicit normal-
  turn continuation fallback.

## Impact

- Affected specs: `agent-input-prompts` (new)
- Affected code: shared harness contracts; Claude, Codex ACP, Cursor, and OpenCode
  adapters; chat transport and atoms; active chat; question UI; notifications;
  persistence/search; and focused tests
