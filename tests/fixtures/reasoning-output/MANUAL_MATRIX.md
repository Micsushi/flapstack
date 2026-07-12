# Reasoning output manual matrix (Stage 2 Track T - T7)

Run this matrix in the dev app after the provider/harness branch is wired. The
fixtures are the repeatable gate; a fixture replay is not a claim that the
provider was live-tested.

| Path                         | Verification                                                                                               | Status          | Expected result                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| Claude Code reasoning output | `claude-transform-reasoning-output.test.ts` fixture replay                                                 | Fixture-tested  | Deltas grow one Reasoning output panel; final block does not duplicate it.                        |
| Codex ACP reasoning output   | `codex-reasoning-output-normalizer.test.ts` fixture replay                                                 | Fixture-tested  | Visible ACP output appears in the Reasoning output panel.                                         |
| Codex/OpenAI token usage     | Local Codex session JSONL capture (2026-07-10) plus Codex fixture                                          | Capture-tested  | `reasoning_output_tokens` is retained as labeled usage metadata; encrypted content never renders. |
| Cursor `auto`                | Live `cursor-agent --stream-partial-output --model auto` smoke on 2026-07-10 plus `cursor-harness.test.ts` | CLI live-tested | Four reasoning-output deltas arrived before assistant text; no-reasoning-output reply completes.  |
| OpenRouter                   | `openrouter.json` fixture replay                                                                           | Fixture-tested  | Visible reasoning, summary, encrypted details, and token counts follow the shared contract.       |
| NanoGPT                      | `nanogpt.json` fixture replay                                                                              | Fixture-tested  | Current `reasoning` and legacy `reasoning_content` use the same Reasoning-output path.            |
| Local/open adapter           | `local.json` fixture replay                                                                                | Fixture-tested  | AI SDK/opencode `reasoning` parts render; provider-private state does not.                        |

Pending app checks: Claude, Codex ACP, Cursor UI, OpenRouter, NanoGPT, and a
local model require a running dev app. OpenRouter and NanoGPT additionally need
Track E's sidecar runtime and provider credentials. Do not mark them UI-tested
until panel behavior and persisted history are observed manually.
