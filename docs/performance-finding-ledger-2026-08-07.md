# Renderer performance finding ledger — 2026-08-07

## Scope and baseline

- Reconciled baseline: `e294ac9fc19626c17f4813f16e184a3167aed4c8`.
- The named source, consolidation, and pane worktrees were inspected before writes. Their intended committed work was already contained in `e294ac9`; the named worktrees were clean, so no draft change was discarded or silently omitted.
- Measurements use the repository Stage 6 core harness on the same Windows host (i7-12700KF, balanced AC) plus `npm run performance:bundle` against production Vite output.
- Raw Stage 6 reports are machine-local under `.local-evidence/stage6-performance/`. They are not committed.

## Findings

|   # | Status                | Resolution                                                                                                                                                                                                                                                                              |
| --: | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | implemented           | Moved `agentInput.listWithContext` into `AgentInputPoller`, a leaf beside the workbench. The polling subscriber no longer rerenders `AgentsContentInner`.                                                                                                                               |
|   2 | implemented           | Cache lookup now precedes persisted JSON parsing; duplicate provider/precompute work was removed; hydration is keyed by persisted raw-message identity.                                                                                                                                 |
|   3 | implemented           | Removed Ollama hot logging and routed chat/terminal hot-path logs through an explicit `VITE_PROFILE_RENDERS` gate while preserving warnings/errors.                                                                                                                                     |
|   4 | implemented           | Chat metadata uses a 30-second stale window, cache-first mount behavior, and explicit invalidation instead of `staleTime: 0` plus `refetchOnMount: "always"`.                                                                                                                           |
|   5 | implemented           | Added `(chat_id, created_at)` for sub-chat ordering and evidence-backed active sidebar composites. `EXPLAIN QUERY PLAN` tests require covering-index scans without temporary B-trees.                                                                                                   |
|   6 | implemented           | `ProgressiveOverflowRow` observes only the row and pinned boundary, caches intrinsic widths, batches one measurement per animation frame, and skips identical state.                                                                                                                    |
|   7 | implemented           | Removed five-second worktree/Git polling; status is stale-aware and invalidated by Git watcher or worktree-menu activity. A path-only result cache was intentionally not used because default/root-registration semantics remain chat-specific.                                         |
|   8 | implemented           | Adjacent text/reasoning chunks are merged and delivered at most once per animation frame; tool, error, and finish events flush immediately. Both IPC and direct-runtime transports use the batcher.                                                                                     |
|   9 | already fixed         | Preserved pane-divider rAF preview plus one durable commit and existing DnD geometry caching; added diagnostic counters and regression coverage.                                                                                                                                        |
|  10 | implemented           | Added lightweight `chats.getMetadata` and one-transcript `chats.getTranscript`; metadata consumers no longer receive every sub-chat message blob.                                                                                                                                       |
|  11 | implemented           | Composer uses the shared metadata endpoint instead of issuing a duplicate full-chat request.                                                                                                                                                                                            |
|  12 | implemented           | Provider credentials/catalogs and worktree options are gated by menu/provider visibility; stable runtime catalogs have five-minute shared cache windows.                                                                                                                                |
|  13 | implemented           | Legacy persisted messages normalize through an identity-keyed cache rather than once per subscriber/render.                                                                                                                                                                             |
|  14 | implemented           | Terminal collections and active IDs are exposed through per-scope atom families; all visible terminal surfaces use scoped subscriptions. Terminal fit/layout work is coalesced once per frame and PTY resize sends only on dimension changes.                                           |
|  15 | superseded            | A wholesale `ActiveChat` rewrite was not justified after the current architecture added scoped stores and memoized transcript sections. Query-owning/lazy islands were added for diff, preview, plan, details, file viewer, and terminal surfaces without destabilizing lifecycle code. |
|  16 | implemented           | Menu-open state and menu-only queries remain local to small controls; no portal rewrite was attempted.                                                                                                                                                                                  |
|  17 | implemented           | Top-tab context-menu left/right collections are derived only for the open menu instead of slicing/filtering every visible tab on every render.                                                                                                                                          |
|  18 | implemented           | Transcript/workbench, composer, and overflow resize reads are rAF-batched, observers are cleaned up, and identical dimensions do not write state.                                                                                                                                       |
|  19 | implemented           | Settings, usage, diff, preview, Kanban, plan, vault, saved workspaces, orchestration, automation/inbox, details/file viewer, and terminal surfaces are dynamic renderer chunks.                                                                                                         |
|  20 | implemented           | Startup preloading was removed; Shiki uses a type-only static import and dynamic `import("shiki")` on first highlighted code/diff.                                                                                                                                                      |
|  21 | implemented           | Why-Did-You-Render is dynamically loaded only in development when `VITE_PROFILE_RENDERS=true`; the disabled tool is absent from the static startup graph.                                                                                                                               |
|  22 | implemented           | Sidebar open-subchat state is projected incrementally instead of reparsing/sorting all window storage; closed archive sections use a lightweight count and defer full queries; five-second sidebar polling was removed.                                                                 |
|  23 | unsafe/not worthwhile | Sidebar virtualization was not added: after removing redundant rebuild/query work, no measured Stage 6 dataset demonstrated a render-volume bottleneck that justified focus/keyboard/height complexity.                                                                                 |
|  24 | unsafe/not worthwhile | Transcript virtualization already starts after 12 groups. Overscan was left unchanged because the long-transcript harness remained within budget and no measurement supported a different value.                                                                                        |
|  25 | implemented           | Hover/keyboard prefetch now fetches metadata and the canonical visible transcript, not the full set of transcripts.                                                                                                                                                                     |
|  26 | implemented           | Audited duplicate tRPC work, broad terminal atoms, repeated storage parsing, polling, payload size, and hot logs; the applicable duplicates and broad subscribers are covered above.                                                                                                    |
|  27 | already fixed         | Pane/menu motion already uses transform/opacity or zero-duration resizing on the audited production paths; the optimization preserves those paths.                                                                                                                                      |

No item remains marked **still applicable**.

## Deterministic regression coverage

- Poll isolation, cache/refetch contracts, split metadata/transcript payloads, diagnostics/Shiki gating, and dormant-surface lazy imports: `performance-hot-path-contracts.test.ts`.
- Persisted parse/legacy-normalization deduplication: `persisted-message-cache.test.ts` and existing hydration tests.
- rAF coalescing and stream batching/flush semantics: `frame-coalescer.test.ts` and `stream-chunk-batcher.test.ts`.
- Overflow batching: `progressive-overflow.test.ts`.
- Scoped terminal subscriptions and fit/resize coalescing: `terminal-scoped-atoms.test.ts` and `terminal-fit-scheduler.test.ts`.
- Query-plan/index evidence: `performance-query-plans.test.ts`.
- Interaction/update counters and opt-in diagnostics: `performance-counters.test.ts`.
- Existing workbench component/reducer tests continue to cover divider/DnD durability and geometry behavior.

## Harness and diagnostic map

The maintained Stage 6 core lane measures cold/warm shell and first use, input response, animation-frame and long-task stalls, long-chat rendering, search/database work, streaming throughput/latency/loss, terminal start/capacity, four-pane input, CPU/memory, and soak/resource deltas. `VITE_PROFILE_PERFORMANCE=true` additionally exposes `globalThis.__flapstackPerformanceDiagnostics` with reset/read controls for:

- chat-switch count and next-frame duration;
- menu open/close next-frame duration;
- divider preview-frame and durable-update counts;
- DnD geometry-read count;
- streaming delta and render-commit counts;
- terminal open/activation/resize counts and open next-frame duration.

`npm run performance:bundle` reports entry bytes, gzip bytes, total JavaScript bytes/chunks, and entry dynamic imports from the production renderer output.

## Production bundle comparison

| Metric                     | Baseline `e294ac9` |  Optimized |                Delta |
| -------------------------- | -----------------: | ---------: | -------------------: |
| Renderer entry bytes       |         17,094,609 |  6,240,894 | -10,853,715 (-63.5%) |
| Total JavaScript bytes     |         52,152,161 | 51,857,074 |     -295,087 (-0.6%) |
| JavaScript chunks          |                468 |        506 |      +38 lazy chunks |
| Optimized entry gzip bytes |                  — |  1,225,839 |        informational |

The total code volume changes little; the main win is moving dormant code out of the startup entry. The entry now dynamically imports 20 named surface/highlighter chunks, including diff, terminal, settings, file viewer, plan, Kanban, vault, orchestration, automation, and Shiki.

## Stage 6 before/after

The optimized full-core run observed all 46 required budgets with zero failures. It was marked `untrusted` only because it measured the intentionally dirty performance worktree. The clean baseline run observed 36 in-process budgets with zero failures, but all 10 Electron-orchestrated rows were omitted because the baseline orchestrator exited 1; those missing rows are not presented as before/after results.

### Optimized renderer and representative layouts

| Scenario                                     | Aggregation |    Optimized | Status |
| -------------------------------------------- | ----------: | -----------: | ------ |
| Cold shell ready, single pane                |      median | 6,499.571 ms | pass   |
| Warm shell ready, single pane                |      median | 6,442.566 ms | pass   |
| Cold first-use/chat ready                    |         p95 | 7,227.432 ms | pass   |
| Warm first-use/chat ready                    |         p95 |      11.2 ms | pass   |
| Large-layout input response                  |         p95 |      15.8 ms | pass   |
| Animation-frame stall                        |         p95 |         0 ms | pass   |
| Long-task stall                              |         p95 |         0 ms | pass   |
| Long transcript render                       |         p95 |      12.1 ms | pass   |
| Large-fixture search                         |         p95 |     224.8 ms | pass   |
| Four-chat grid input                         |         p95 |      16.9 ms | pass   |
| Terminal start (10-terminal stress capacity) |         p95 |   260.933 ms | pass   |
| Visible grid capacity                        |     minimum |      4 panes | pass   |

### Comparable in-process results

| Metric                       | Aggregation |           Baseline |           Optimized |             Delta | Status    |
| ---------------------------- | ----------: | -----------------: | ------------------: | ----------------: | --------- |
| Database open                |         p95 |          18.238 ms |           17.768 ms |             -2.6% | pass/pass |
| Scoped query                 |         p95 |           1.437 ms |            1.021 ms |            -28.9% | pass/pass |
| Database search              |         p95 |           0.171 ms |            0.243 ms | +42.1% (0.072 ms) | pass/pass |
| Stream throughput            |        mean | 9,401.973 events/s | 11,349.740 events/s |            +20.7% | pass/pass |
| Stream event latency         |         p95 |          28.954 ms |           18.974 ms |            -34.5% | pass/pass |
| Ordered stream loss          |     maximum |                  0 |                   0 |         unchanged | pass/pass |
| Steady-state CPU             |         p95 |             2.980% |              4.674% |         +1.694 pp | pass/pass |
| Steady-state memory          |     maximum |       72,097,792 B |        74,792,960 B |             +3.7% | pass/pass |
| Soak memory growth           |     maximum |       10,604,544 B |        11,456,512 B |             +8.0% | pass/pass |
| Agent start                  |         p95 |           0.040 ms |            0.024 ms |            -40.0% | pass/pass |
| Terminal start               |         p95 |         260.740 ms |          260.933 ms |             +0.1% | pass/pass |
| Cancel latency               |         p95 |           0.074 ms |            0.051 ms |            -31.1% | pass/pass |
| Concurrent terminal capacity |     minimum |                 10 |                  10 |         unchanged | pass/pass |

The small database-search, CPU, and memory increases remain far inside their budgets and are not claimed as improvements. They are retained as residual measurements for future profiling. The baseline Electron omissions mean bundle structure, deterministic contracts, and the complete optimized renderer run—not fabricated wall-clock deltas—are the evidence for renderer startup and interaction changes.

## Residual bottlenecks and decisions

- The on-demand file-viewer chunk remains about 7.4 MB and the TypeScript worker about 13.3 MB. They no longer block ordinary chat startup, but first use of those surfaces remains the clearest bundle target.
- `ActiveChat` remains large lifecycle code. Further splitting should follow profiler evidence and preserve current per-chat stores; a speculative rewrite would carry disproportionate regression risk.
- Worktree resolution remains chat-aware. Canonical-path sharing is safe for filesystem facts, but not for default/root-registration identity, so invalidation and stale caching were used instead of a semantically incorrect global result cache.
- Sidebar virtualization and transcript overscan changes remain measurement-gated rather than assumed wins.
