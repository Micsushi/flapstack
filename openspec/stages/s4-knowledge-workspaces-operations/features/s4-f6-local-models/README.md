# S4-F6 — Local Models

- Outcome: Ollama and later local models run through Flapstack's app-owned,
  permission-gated agent loop with normal run/checkpoint/manifest records.
- Change: `openspec/changes/add-local-model-harness/`
- Tasks: `openspec/changes/add-local-model-harness/tasks.md`
- Task IDs: S4-F6-T1 through S4-F6-T8
- Starting point: Ollama router, reserved local harness, and shipped direct-API
  tool loop.
- Dependencies: stable provider loop and model catalog contracts.
- Safety boundary: read-only tools ship before write or shell tiers.
