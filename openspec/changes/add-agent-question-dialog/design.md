## Context

Claude already emits `AskUserQuestion` through Flapstack's Agent SDK bridge. The main
process waits for a reply, the renderer stores the pending question set, and the current
inline UI submits the answer back into the same tool call. A 60-second native wait then
falls back to an expired-question continuation path. OpenRouter and NanoGPT share the
OpenCode sidecar, so they require one adapter rather than separate UI implementations.
Codex ACP and Cursor must be capability-detected because their active Flapstack adapters
do not currently expose a structured question request.

## Goals / Non-Goals

- Goals: focused dialog, fast structured answers, custom answers, free-text escape hatch,
  same-run continuation where supported, multi-chat pending state, durable history.
- Non-goals: forcing models to ask questions, faking structured choices from ordinary
  prose, or claiming same-run continuation when a harness only supports a new turn.

## Decisions

- Decision: use an in-app modal dialog, not a second operating-system window. It receives
  focus reliably, works in web/dev mode, and reuses Flapstack's existing React state.
- Decision: keep the compact question card in transcript history; the modal is only the
  active answering surface.
- Decision: single-select uses radio semantics; multi-select uses checkboxes. Every
  question also offers a custom text answer that is mutually exclusive with single-select
  choices and additive only when the question explicitly allows multiple answers.
- Decision: “Answer in chat” closes the modal, copies a numbered plain-text question list
  into the composer context, and keeps the list reopenable from the pending card.
- Decision: normalize all provider events behind one `AgentInputRequest` contract with
  capability fields describing native pause/resume, Flapstack-injected tool support, or
  continuation fallback.
- Decision: implement by harness family, not model name. Claude uses the Agent SDK;
  OpenRouter and NanoGPT share OpenCode; Codex uses ACP; Cursor uses its CLI stream.
  Models added beneath an existing family inherit the behavior automatically.
- Decision: where a harness accepts custom tool definitions, expose one Flapstack-owned
  `request_user_input` tool with the shared question schema. Provider prompts instruct
  the model when to call it, but ordinary prose is never heuristically converted.
- Decision: do not infer question choices by parsing ordinary assistant prose.

## Risks / Trade-offs

- Claude's current 60-second timeout is too short for a modal that users may leave pending;
  the implementation should replace it with cancellation-aware lifecycle handling or a
  longer configurable timeout.
- A modal can interrupt unrelated work when several chats run concurrently. Only the
  active chat opens automatically; background chats use the existing needs-input
  notification and a visible pending badge.
- Native parity depends on each installed harness protocol. Unsupported structured
  prompts must fall back honestly to a normal chat continuation.
