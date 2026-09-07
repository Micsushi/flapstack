# S4-F6 Local Models

Flapstack runs local chats through Ollama at a validated loopback endpoint. The
local harness never uses hosted credentials and never falls back to Codex,
Claude, OpenRouter, NanoGPT, or another cloud path.

## Setup and model truth

1. Start Ollama outside Flapstack and install a model with Ollama's own tools.
2. Open Settings -> Local models.
3. Keep the default `http://127.0.0.1:11434` endpoint or another loopback URL.
4. Refresh the catalog and select an installed model.

Catalog capability declarations are authoritative. A model with chat support
but no declared tool support remains chat-only. Flapstack does not guess from a
model name. Read, project-write, shell, git, and network tiers stay independently
gated by both model capability and the run permission snapshot.

## Runs and recovery

Local responses use normal chat messages, durable run/model/permission identity,
checkpoints, manifests, cancellation, and bounded tool evidence. A stopped app
does not reconnect or replay an abandoned local provider stream. Startup marks
that run failed while preserving completed content and evidence.

Saved chat panes restore the exact durable `local` harness and model identity.
Orchestration workers require an explicit model and may declare required local
tool tiers plus a validated loopback `localEndpoint`; omitted endpoints use the
default loopback URL. Launch preflight rejects unavailable models, unsupported
tiers, or permission mismatches before provider work starts. Cancellation uses
the same run identity, and successful assistant text becomes the bounded
orchestration result summary.

Durable local orchestration input is validated before a pending run is claimed.
Malformed definitions, non-array or non-string tiers, unknown or duplicate
tiers, and invalid endpoint, provider, model, or permission fields fail closed.
The run, sub-chat, and correlated MCP audit become terminal failures; no local or
cloud provider launch occurs. An absent or null tier list means no required tool
tier, never permission to erase malformed requirements.

## Usage honesty

Ollama-reported input, output, and total tokens are stored under the Local /
Ollama usage provider. Missing token fields remain unknown. Provider billing is
exactly zero because execution is local; compute time, energy, thermals, and
hardware cost remain explicitly unmeasured.

## Diagnostics

The local-model diagnostics route reports the canonical endpoint, loopback-only
policy, cached catalog state/model count, active run identities, reconnect
support, and the fixed `cloudFallback: false` contract. Errors shown to users are
sanitized; provider payloads and local secrets are not copied into diagnostics.

## Flapstack Dev fixture

The Local Models Settings page exposes a clearly labeled development fixture in
the `Flapstack Dev` profile only. Its reserved loopback endpoints provide ready,
empty, unavailable, endpoint-error, and stale catalog states plus two declared
models: one chat-only and one tool-capable. Chat responses are fixed, bounded,
credential-free, and provider-spend-free. `/fixture slow`, `/fixture error`, and
`/fixture tool` exercise cancellation, sanitized failure, and tool gating through
the normal local chat transport. Production and packaged profiles never resolve
the fixture endpoints as test data.

The fixture selection uses the same persisted endpoint and model settings as a
normal local chat. Resetting selects the ready fixture and its chat-only model;
testers then use the normal catalog refresh and chat UI without database or
filesystem injection.

## Write safety

Project writes apply the configured existing-file byte limit to planning,
rollback capture, and both pre-commit content checks. A file that grows while
approval is pending fails with `file-too-large` without replacing the changed
content. Descriptor reads stop at the limit plus one detection byte, including
when a file grows after its size check. Content-hash and rooted-path checks
remain separate requirements; a size limit is not an operating-system sandbox.

## Headless verification

Run with Node 22:

```sh
npx vitest run tests/local-model-dev-fixture.test.ts tests/local-model-catalog.test.ts tests/local-model-stream.test.ts tests/local-model-read-tools.test.ts tests/local-model-write-tools.test.ts tests/local-model-exec-tools.test.ts tests/local-model-ui.test.ts tests/local-model-router-transport.test.ts tests/local-model-integration.test.ts
npx vitest run tests/mcp-main-run-launcher.test.ts tests/usage-store.test.ts tests/saved-workspace-pane-adapters.test.ts
npx --yes @fission-ai/openspec@latest validate add-local-model-harness --strict --no-interactive
```

Real installed-model catalog/chat, one chat-only model, one tool-capable model,
packaged preview, direct interaction/accessibility, and unavailable platform or
device evidence remain manual acceptance. Headless success does not close them.

### Opt-in installed Ollama check

`tests/local-model-router-transport.test.ts` includes two live checks, skipped by
default. Point `FLAPSTACK_LIVE_OLLAMA_ENDPOINT` at an isolated loopback Ollama
server and `FLAPSTACK_LIVE_OLLAMA_MODEL` at an already installed model, then run:

```sh
npm test -- tests/local-model-router-transport.test.ts
```

The checks use a temporary Flapstack database and registered fixture directory,
read-only run permissions, actual catalog and provider requests, durable queue
claim, stored assistant/usage evidence, and cancellation after streamed text.
They never download a model or change Ollama settings themselves. A 60-second
stream deadline cancels stalled work. A cold provider load can exceed that
deadline; inspect its logs before treating the failure as an app regression.

Windows evidence used Ollama 0.20.6 and
[Qwen3:0.6B Q4_K_M](https://ollama.com/library/qwen3:0.6b), 522,653,767 bytes,
manifest `7df6b6e09427a769808717c0a93cadc4ae99ed4eb8bf5ca557c90846becea435`.
The model is [Apache-2.0 licensed](https://huggingface.co/Qwen/Qwen3-0.6B/blob/main/LICENSE).
Its home/cache and loopback port were isolated, cloud disabled, one request/model
allowed, and idle model retention disabled using
[documented Ollama configuration](https://docs.ollama.com/faq).
The first cold load exceeded the fixture deadline; two unchanged reruns passed.
This is live-provider backend evidence, not packaged UI or multi-OS acceptance.
