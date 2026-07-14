# S4-F6 — Local Models

### S4-F6-T1 — Define the local harness and model capability contract

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F6
- Outcome: `local` is a typed harness with per-model capability and limitation truth.
- Scope: Shared harness/model DTOs; Ollama endpoint config; availability/catalog probe; capability cache/versioning; model identity; limitation codes; fixtures.
- Out of scope: Streaming runs and tools.
- Acceptance: Missing Ollama, empty catalog, stale cache, unsupported tool/vision, and endpoint errors render typed states; no name-based capability guessing.
- Verification: `npm test -- local-model-catalog` with version/model/error/capability fixtures.
- Blocked by: Stage 3 provider/run baseline
- Blocks: S4-F6-T2, S4-F6-T3, S4-F6-T6
- Context: `ollama.ts`, shared harness types, OpenCode catalog/contract, model selector.

### S4-F6-T2 — Add streaming local chat and run persistence

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F6
- Outcome: Ollama chat streams through normal Flapstack messages and run lifecycle.
- Scope: `/api/chat` adapter; normalized chunks; context assembly; session transcript strategy; abort/timeout; run creation/finalization; reconnect failure; error sanitization.
- Out of scope: Tool calls and renderer onboarding.
- Acceptance: Text streams incrementally; cancellation is bounded; restart never resumes an ordinary abandoned stream; run/model/context identity remains durable.
- Verification: `npm test -- local-model-stream` with chunk, timeout, abort, malformed, disconnect, and persistence fixtures.
- Blocked by: S4-F6-T1
- Blocks: S4-F6-T3, S4-F6-T7
- Context: OpenCode chunk mapper/persistence, launch context, agent run schema, active stream maps.

### S4-F6-T3 — Implement the bounded read-only tool loop

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F6
- Outcome: Tool-capable local models can inspect a registered project without mutation.
- Scope: Provider-neutral loop; read/list/glob/grep tools; tool schema/normalization; iteration/call/context/output/time caps; unknown-tool denial; tool evidence.
- Out of scope: File writes, shell, git, network, subagents, and MCP mutation.
- Acceptance: Read tools stay inside registered roots; unsupported models remain chat-only; loops stop at limits; malformed/unknown calls fail closed.
- Verification: `npm test -- local-model-read-tools` with traversal, symlink, recursion, malformed, limit, and chat-only fixtures.
- Blocked by: S4-F6-T1, S4-F6-T2
- Blocks: S4-F6-T4, S4-F6-T5, S4-F6-T7
- Context: path safety, file read/search services, normalized tool events, permission evidence.

### S4-F6-T4 — Add exact project-scoped edit and write tools

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F6
- Outcome: Authorized local runs make bounded project edits with checkpoints and manifests.
- Scope: Edit/write/apply-patch tools; before-write revalidation; symlink/race defense; permission resolution; ask-mode approval; atomic writes; checkpoint/manifest integration.
- Out of scope: Shell, git commands, network, external directories.
- Acceptance: Read-only denies mutation; project-only cannot escape; ask mode blocks pending approval; successful writes appear in the run manifest and undo path.
- Verification: `npm test -- local-model-write-tools` with permission, traversal, symlink swap, stale file, approval, rollback, and manifest cases.
- Blocked by: S4-F6-T3
- Blocks: S4-F6-T5, S4-F6-T7
- Context: run undo/review, checkpoint service, path validation, approval UI.

### S4-F6-T5 — Add shell, git, and network tool tiers

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F6
- Outcome: Explicitly authorized local runs use bounded shell/git/network tools with honest limitations.
- Scope: Tool adapters; cwd/root binding; timeout/output caps; environment/secret filtering; shell-vs-git capability mapping; network allow/ask/deny; approval and audit.
- Out of scope: Browser automation, secrets access, subagents, and unrestricted external-directory writes.
- Acceptance: Each capability is independently gated; unknown command/tool fails closed; secrets are absent from prompt, env logs, output previews, and audit.
- Verification: `npm test -- local-model-exec-tools` with mode matrix, timeout, output flood, env secret, git mutation, network denial, and audit cases.
- Blocked by: S4-F6-T3, S4-F6-T4 and Stage 3 approval/audit
- Blocks: S4-F6-T7
- Context: shell safety, git security commands, OpenCode permission bridge, provider audit patterns.

### S4-F6-T6 — Build local model onboarding and controls

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F6
- Outcome: Users connect Ollama, inspect models, choose capabilities, and launch local chats honestly.
- Scope: Settings status/endpoint/model catalog; refresh; input-bar harness/model selection; capability/limitation preview; chat-only vs tool tiers; empty/error states; accessibility.
- Out of scope: Bundled downloads, model installation, and remote Ollama by default.
- Acceptance: UI never offers unsupported tiers; selected model and permissions are visible before launch; offline local flow needs no cloud credential.
- Verification: `npm test -- local-model-ui` plus accessibility and live Ollama catalog/launch walkthrough.
- Blocked by: S4-F6-T1
- Blocks: S4-F6-T7, S4-F6-T8
- Context: Agents Models/API tabs, onboarding, harness/model selector, Settings search.

### S4-F6-T7 — Integrate local runs with usage, workspaces, and orchestration

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F6
- Outcome: Local runs behave like first-class Flapstack runs across Stage 4 consumers.
- Scope: Usage capture/provenance; checkpoints/manifests; saved workspace binding; orchestration preflight/worker launch; cancellation; capability mismatch; result aggregation.
- Out of scope: Local compute telemetry beyond provider-reported fields.
- Acceptance: Eligible local workers run and aggregate; mismatched tool requirements fail preflight; local cost/usage remains honest; workspace restore preserves model identity.
- Verification: `npm test -- local-model-integration` with workspace, orchestration, usage, cancellation, and mismatch fixtures.
- Blocked by: S4-F6-T2, S4-F6-T3, S4-F6-T4, S4-F6-T5, S4-F6-T6, S4-F4-T4, S4-F3-T4
- Blocks: S4-F6-T8
- Context: orchestration definitions, saved workspace pane bindings, usage run capture.

### S4-F6-T8 — Close local model acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F6
- Outcome: Chat-only and tool-capable local models pass automated, live, and package evidence.
- Scope: Full gate; matrix S4-LM01–S4-LM03; missing/runtime/model cases; read/write/shell/network gates; restart/cancel; workspace/orchestration; docs; package preview.
- Out of scope: Guaranteeing capabilities for every Ollama model.
- Acceptance: One chat-only and one tool-capable model show correct behavior/limitations; unsafe tiers fail closed; no cloud fallback occurs.
- Verification: Node 22 `npm run check`, strict OpenSpec, `npm run dev:verify`, live Ollama matrix, and packaged preview.
- Blocked by: S4-F6-T6, S4-F6-T7
- Blocks: Stage S4 integrated exit
- Context: `docs/stage4-full-feature-test-matrix.md` and Stage 4 execution plan.
