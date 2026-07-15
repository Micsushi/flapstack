# Agent Runtime fixture manifest

This directory is the S4-F11 manifest for the immutable Stage 3 baseline at
`a674784b0141c7a5293c5637c3bea65be6d44c4e`. It does not claim that a fixture is
a native-runtime capture merely because a normalizer accepts its shape.

## Privacy classes

| Class                  | Allowed committed content                                                         | Required handling                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `public-doc-derived`   | Minimal protocol shape derived from public/provider docs                          | No credentials, prompts, account IDs, paths, URLs with tokens, or private payload bodies                                                 |
| `repo-derived`         | Minimal shape derived from committed Stage 3 code/tests                           | Cite the source file; keep only fields required by the contract                                                                          |
| `sanitized-live`       | Real provider/CLI event with identifying data removed                             | Replace IDs, prompts, paths, account data, secrets, headers, URLs, tool payloads, and encrypted blobs; record version/date/command class |
| `synthetic`            | Deliberately constructed edge case                                                | Mark synthetic; never present it as provider proof                                                                                       |
| `opaque-private`       | Presence/classification marker only                                               | Never commit plaintext, ciphertext, signatures, chain-of-thought, hidden tool inputs, or reversible hashes                               |
| `sensitive-local-only` | Raw provider logs, session JSONL, database copies, screenshots containing content | Do not commit. Derive a minimal sanitized fixture, then delete or retain only under the user's local evidence policy                     |

## Existing committed fixtures

| Fixture                                                                                                      | Provenance                                                                        | Privacy                                                            | Frozen coverage                                                                               | Known limitation                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [`../reasoning-output/codex.json`](../reasoning-output/codex.json)                                           | Mixed `sanitized-live` and minimal protocol shape; local capture dated 2026-07-10 | `sanitized-live`, with encrypted content replaced by a fake marker | ACP thought chunk, visible summary, opaque classification, reasoning tokens, absent reasoning | Not a matched App Server/ACP/AI SDK/persistence trace; no thread/turn/item/index/section ordering         |
| [`../reasoning-output/claude.json`](../reasoning-output/claude.json)                                         | Derived from Stage 3 Claude transformer                                           | `repo-derived`                                                     | thinking start/delta/final and absent reasoning                                               | Not credentialed live; omits system, hook, permission, subagent, result, UUID, resume, and fork envelopes |
| [`../reasoning-output/cursor.json`](../reasoning-output/cursor.json)                                         | Live Cursor CLI capture dated 2026-07-09                                          | `sanitized-live`                                                   | reasoning delta/final/absent                                                                  | Named reasoning models were unavailable; provider version is not lockfile-pinned                          |
| [`../reasoning-output/openrouter.json`](../reasoning-output/openrouter.json)                                 | Provider-doc-derived OpenAI-compatible shapes                                     | `public-doc-derived`                                               | text, summary, opaque, token, absent                                                          | Not a captured OpenCode sidecar stream or credentialed request                                            |
| [`../reasoning-output/nanogpt.json`](../reasoning-output/nanogpt.json)                                       | Provider-doc-derived current and legacy shapes                                    | `public-doc-derived`                                               | current/legacy reasoning, summary, token, opaque, absent                                      | Not a captured OpenCode sidecar stream or credentialed request                                            |
| [`../reasoning-output/local.json`](../reasoning-output/local.json)                                           | AI SDK/OpenCode-style shapes                                                      | `public-doc-derived` and `synthetic`                               | delta/final/absent                                                                            | No concrete local adapter/version                                                                         |
| [`../reasoning-output/README.md`](../reasoning-output/README.md)                                             | Stage 2 fixture contract                                                          | `repo-derived`                                                     | shape and redaction rules                                                                     | Provider-level only; not a Runtime transport manifest                                                     |
| [`../reasoning-output/MANUAL_MATRIX.md`](../reasoning-output/MANUAL_MATRIX.md)                               | Stage 3 evidence ledger                                                           | `repo-derived`; references sanitized IDs only                      | historical provider/UI/reload/package status and gaps                                         | Historical evidence, not a raw fixture and not re-executed by T1                                          |
| [`../cursor-agent/reasoning-output-run.jsonl`](../cursor-agent/reasoning-output-run.jsonl)                   | Live Cursor `stream-json` output                                                  | `sanitized-live`                                                   | incremental reasoning stream                                                                  | Cursor-only; older recorded CLI build than final closeout                                                 |
| [`../cursor-agent/no-reasoning-output-run.jsonl`](../cursor-agent/no-reasoning-output-run.jsonl)             | Live Cursor `stream-json` output                                                  | `sanitized-live`                                                   | valid absent reasoning                                                                        | Does not prove reasoning was disabled internally                                                          |
| [`../cursor-agent/tool-and-cumulative-final-run.jsonl`](../cursor-agent/tool-and-cumulative-final-run.jsonl) | Live Cursor `stream-json` output                                                  | `sanitized-live`                                                   | tool interleave and cumulative final                                                          | Cursor-only                                                                                               |

## Existing code-constructed fixtures and tests

These files contain inline synthetic events or temporary databases rather than
standalone raw captures:

| Test                                                                                                 | Provenance/privacy                             | Contract frozen by the test                                                |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| [`../../reasoning-output-contract.test.ts`](../../reasoning-output-contract.test.ts)                 | `synthetic` plus the provider JSON files above | visibility, persistence class, accumulation, deduplication, and labels     |
| [`../../codex-transport-decision.test.ts`](../../codex-transport-decision.test.ts)                   | `repo-derived`                                 | ACP/App Server transport decision and pinned adapter                       |
| [`../../codex-reasoning-output-normalizer.test.ts`](../../codex-reasoning-output-normalizer.test.ts) | `synthetic` sanitized session JSONL            | newest in-window summary selection, opaque filtering, deduplication        |
| [`../../claude-transform-reasoning-output.test.ts`](../../claude-transform-reasoning-output.test.ts) | `synthetic` SDK message shapes                 | thinking-to-fake-tool streaming and no-duplicate fallback                  |
| [`../../chat-handoff.test.ts`](../../chat-handoff.test.ts)                                           | `synthetic` secret markers                     | visible-history continuation and exclusion of metadata/tool/file secrets   |
| [`../../stage3-migration-rebase.test.ts`](../../stage3-migration-rebase.test.ts)                     | synthetic temporary SQLite profiles            | Stage 3 schema migration, repair, queued-run recovery, append-only audit   |
| [`../../codex-reasoning-session.test.ts`](../../codex-reasoning-session.test.ts)                     | synthetic session JSONL                        | Codex session reasoning lookup                                             |
| [`../../claude-session-options.test.ts`](../../claude-session-options.test.ts)                       | synthetic                                      | resume, resume-at, fork, and fresh-run option behavior                     |
| [`../../claude-session-recovery.test.ts`](../../claude-session-recovery.test.ts)                     | synthetic                                      | missing/stale session recovery                                             |
| [`../../claude-message-persistence.test.ts`](../../claude-message-persistence.test.ts)               | synthetic temporary DB                         | stream ownership, message/session persistence                              |
| [`../../app-shutdown.test.ts`](../../app-shutdown.test.ts)                                           | synthetic                                      | abort-before-wait, timeout, ordered cleanup, database-last behavior        |
| [`../../mcp-main-run-launcher.test.ts`](../../mcp-main-run-launcher.test.ts)                         | synthetic temporary DB                         | pending claim/serialization, shared provider launch path, restart outcomes |

## Frozen versions and provenance anchors

| Surface              | Version                                   | Authority                                                                                        |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Flapstack            | `0.0.72`                                  | Stage 3 `package.json`/`package-lock.json`                                                       |
| Codex ACP            | `1.1.2`                                   | `package-lock.json`                                                                              |
| ACP AI provider      | `0.3.3` plus repository postinstall patch | `package-lock.json`; `scripts/patch-acp-ai-provider.mjs`                                         |
| Codex CLI/App Server | `0.144.1`                                 | `package-lock.json`; download/package scripts                                                    |
| Claude Agent SDK     | `0.3.207`                                 | `package-lock.json`                                                                              |
| Claude Code binary   | `2.1.207`                                 | download/package scripts                                                                         |
| AI SDK               | `6.0.219`                                 | `package-lock.json`                                                                              |
| OpenCode fallback    | `1.17.18`                                 | `src/main/lib/harness/opencode-sidecar/binary.ts`                                                |
| Cursor CLI           | not pinned                                | Fixture README records `2026.07.08-0c04a8a`; final Stage 3 closeout records `2026.07.09-a3815c0` |
| Replay runtime       | Node `22.23.1`, npm `10.9.8`, macOS arm64 | exact S4-F11-T1 replay environment                                                               |

Package version equality is checked from the frozen `package-lock.json`, not by
trusting a mutable globally installed CLI.

## Required missing captures

No downstream task may fill these gaps by inventing provider fields.

### Codex matched transport corpus

Capture one sanitized deterministic run at the pinned versions with four
matched layers:

1. App Server JSON-RPC notifications, including thread ID, turn ID, item ID,
   summary/content indices, section boundaries, lifecycle, plan, tool,
   permission, usage, warning, and completion events.
2. ACP `session/update` output from the same run.
3. AI SDK UI message chunks from the same run.
4. Final Flapstack `sub_chats.messages`, `agent_runs`, usage, checkpoint, and
   session identity from the same run.

Include visible-summary, raw/displayability distinction, absent reasoning,
tool interleave, cancellation, resume, and restart cases. For private or
encrypted reasoning, retain only a boolean/type/byte-length class. Never retain
the payload or a reversible digest.

### Claude matched SDK corpus

Capture one sanitized deterministic run at SDK `0.3.207`/Claude Code `2.1.207`
with:

- `system/init`, session ID, exact model, capability lists;
- message/content-block start/delta/stop with index;
- visible thinking, text, tool use/result, permission/input callback;
- hook event and subagent event with UUID and `parent_tool_use_id`;
- result/subtype/usage/cost;
- final Flapstack chunks, persisted message JSON, and run/session rows;
- resume, `resumeSessionAt`, fork, cancellation, process failure, and restart.

Prompts, thinking bodies, tool inputs/outputs, account data, local paths,
credentials, headers, and session files are `sensitive-local-only`. Commit only
minimal tokens such as `VISIBLE_SUMMARY_A`, `tool-1`, and `parent-1` after
field-by-field review.

### Package and operating-system corpus

Still missing for Runtime parity fixtures:

- a pinned unsigned macOS Preview matched provider trace after Runtime adapters
  exist;
- Windows x64/arm64 native launch, cancellation, resume, and package evidence;
- Linux x64/arm64 native launch, cancellation, resume, and package evidence;
- signed/notarized distribution evidence when that release channel exists.

The lockfile's platform packages are provenance, not execution evidence.

## Automated versus manual/provider gates

| Gate                                                                                                 | Current class                                                                     |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Stage 3 reasoning contract, Codex decision/normalizer, Claude transformer, handoff, migration replay | Automated; passed from `git archive a674784` under Node 22 (6 files, 70 tests)    |
| Same set on current descendant                                                                       | Automated; passed (6 files, 73 tests)                                             |
| Fixture privacy review                                                                               | Automated shape tests plus human field review required for every new live capture |
| Credentialed Codex/Claude protocol capture                                                           | Provider credential required; not run by T1                                       |
| Live transcript/keyboard/screen-reader/search/copy behavior                                          | Live UI/manual required; not run by headless T1                                   |
| Preview application provider trace                                                                   | Package build and manual/provider run required; not run by T1                     |
| Windows/Linux                                                                                        | Matching OS required; unverified                                                  |

## Fixture admission checklist

- Bind the capture to commit, package/binary versions, OS/arch, command class,
  and capture date.
- State `public-doc-derived`, `repo-derived`, `sanitized-live`, or `synthetic`.
- Keep native IDs only as fake stable tokens needed to test relationships.
- Remove prompts, responses, thinking bodies, tool payloads, account data,
  credentials, secrets, absolute paths, environment values, signed URLs,
  headers, and raw encrypted/private fields.
- Preserve event kind, phase, order, index, parent relation, display/privacy
  class, and terminal state only when the provider actually supplied them.
- Run a secret/path scan and focused parser test before admission.
- Record unavailable provider, package, UI, or OS evidence as a gap; never
  convert a fixture pass into live proof.
