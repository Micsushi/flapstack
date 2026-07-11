# Harness Engine: OpenCode Sidecar (Track E)

This repo-local record documents the Track E decision and keeps the
implementation self-contained.

## E0 decision — use OpenCode as the first harness engine

OpenRouter and NanoGPT are **API model providers**, not editor CLIs. Rather than
build a native Flapstack model/tool loop first, Stage 2 runs these providers
through a locally-launched **OpenCode server ("sidecar")** that Flapstack owns
and controls.

- **Chosen engine:** OpenCode (`opencode-ai@1.17.18`), launched as
  `opencode-ai serve --hostname 127.0.0.1 --port 0` with per-run credentials and
  an isolated config directory.
- **Adapter blueprint:** Vibe Kanban's OpenCode executor —
  `crates/executors/src/executors/opencode.rs`,
  `crates/executors/src/executors/opencode/sdk.rs`, and
  `crates/executors/src/approvals.rs`. This TypeScript port mirrors that HTTP +
  SSE contract.
- **Reference-only:** Aider (repo-map/context, edit formats, git/autocommit,
  shell-confirm UX, OpenRouter model metadata). Not vendored.
- **Rejected for Stage 2:** building a native provider tool loop from scratch
  (deferred to the E8 spike). We do **not** vendor OpenCode internals unless the
  E8 spike proves the sidecar path cannot meet product needs.

## Reference repos

- OpenCode
- Aider
- Vibe Kanban

## OpenCode server HTTP/SSE contract (as ported here)

Auth: HTTP Basic `opencode:{password}` plus an `x-opencode-directory` header;
every request also carries `?directory=<cwd>`.

| Purpose             | Method + path                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Health              | `GET /global/health` → `{ healthy, version }`                                                                  |
| Create session      | `POST /session?directory=` → `{ id }`                                                                          |
| Fork/resume session | `POST /session/{id}/fork?directory=` → `{ id }`                                                                |
| Prompt              | `POST /session/{id}/prompt_async?directory=` with `{ model:{providerID,modelID}, parts:[{type:"text",text}] }` |
| Abort               | `POST /session/{id}/abort?directory=`                                                                          |
| Event stream (SSE)  | `GET /event?directory=` (`Accept: text/event-stream`)                                                          |
| Permission reply    | `POST /permission/{id}/reply?directory=` with `{ reply:"once"\|"always"\|"reject", message? }`                 |
| Providers/config    | `GET /config`, `GET /config/providers`, `GET /provider`                                                        |

Event types consumed: `message.updated`, `message.part.updated`,
`message.part.delta`, `session.status`, `session.idle`, `session.error`,
`permission.asked`. Session matching uses the `sessionID` pointer for each event
shape (see `events.ts`).

## Flapstack ownership boundary

Flapstack owns: sidecar launch/lifecycle, isolated config generation, provider
credentials (encrypted), app-identity/attribution headers, permission mapping,
approval bridging, event normalization, run persistence, usage hooks, provider
chips/settings, and honest limitation surfacing.

OpenCode owns: the model/tool continuation loop, tool execution, and provider
streaming.

## Honest limitations (surfaced as `HarnessPermissionLimitation` / run states)

- OpenCode binary missing, or Node/`npx` missing.
- Provider API key missing / auth failed.
- Model unavailable or config write failed.
- Server startup timeout.
- Permission bridge unavailable (a Flapstack toggle OpenCode cannot enforce
  exactly is reported as a limitation, never claimed as enforced).
