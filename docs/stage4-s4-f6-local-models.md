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

## Headless verification

Run with Node 22:

```sh
npx vitest run tests/local-model-catalog.test.ts tests/local-model-stream.test.ts tests/local-model-read-tools.test.ts tests/local-model-write-tools.test.ts tests/local-model-exec-tools.test.ts tests/local-model-ui.test.ts tests/local-model-router-transport.test.ts tests/local-model-integration.test.ts
npx vitest run tests/mcp-main-run-launcher.test.ts tests/usage-store.test.ts tests/saved-workspace-pane-adapters.test.ts
npx --yes @fission-ai/openspec@latest validate add-local-model-harness --strict --no-interactive
```

Real installed-model catalog/chat, one chat-only model, one tool-capable model,
packaged preview, direct interaction/accessibility, and unavailable platform or
device evidence remain manual acceptance. Headless success does not close them.
