# Change: Add a local model harness

## Why

Flapstack can query Ollama for small helper requests but cannot run a persisted
local-model chat or tool loop. Stage 4 adds an honest local harness using the
same run, permission, checkpoint, manifest, usage, and orchestration surfaces.

## What Changes

- Add a `local` harness and Ollama adapter with model capability probing.
- Add normalized streaming, cancellation, session context, and run persistence.
- Add a minimal Flapstack-owned tool loop: read tools first, then gated project
  writes, shell, git, and network where model/runtime support is proven.
- Add onboarding, catalog, model selection, limitations, and usage visibility.
- Add local-model participation in saved workspaces and orchestration.

## Impact

- Affected specs: new `local-model-runs` capability.
- Affected code: harness types/adapters, Ollama router, normalized chunks,
  permissions/approvals, run persistence, usage, renderer selectors, and tests.
