# S6-F7 — Runtime and Cross-Provider Orchestration Composition

### S6-F7-T1 — Freeze ownership, execution-target, and adapter contracts

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F7
- Outcome: Every target field and request/control/activity/result field has one authoritative owner, and every native, enhanced, translated, or invalid provider/Runtime combination is deterministic.
- Scope: F3/F11 seam audit; `ExecutionTarget` schema; Runtime mode and adapter-chain identity; provider/model/account/profile/permission/worktree capability graph; snapshot/version; precedence; target preview; loss matrix; failure/repair taxonomy; Stage 4 migration and deprecation map.
- Out of scope: Provider adapter implementation.
- Acceptance: Native choices remain provider truthful; translated choices identify their adapter chain and losses; Flapstack Native remains universal; unsupported/unknown blocks before mutation; no duplicate process/parser/activity owner; Stage 4 snapshots remain readable.
- Verification: Architecture and security review; resolver/precedence/compatibility/probe-drift/migration/property tests; invalid-pair and no-silent-fallback fixtures.
- Blocked by: fully accepted S4-F3 and S4-F11
- Blocks: S6-F7-T2, S6-F7-T3, S6-F7-T4, S6-F7-T5
- Context: RuntimeLaunchCoordinator, Agent Runtime resolver, coordination engines, Agent Profiles, Chat lineage, activity references.

### S6-F7-T2 — Resolve exact targets through one Runtime adapter broker

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F7
- Outcome: Direct, continuation, delegated, and workflow launches use one immutable native or translated target and one F11-owned provider/session/event authority.
- Scope: Versioned F3 consumer port; native and translated target resolution/probe; adapter-chain registry; Codex V2/V1 routing through F11 authority; Claude/native/translated routing; immutable target snapshot; request correlation; idempotent launch intent; drift; diagnostics; repair/retry.
- Out of scope: Second provider client in F3, prompt-only capability claims, or post-intent fallback.
- Acceptance: One provider/session owner per child; exact Runtime mode and adapter chain persist before provider intent; unsupported version/capability blocks; drift expires preview; events retain provider/run/task-path/adapter provenance; retries create explicit new attempts.
- Verification: Port/version/probe/process-count/request-correlation/idempotency tests; Codex mailbox/follow-up/interrupt fixtures; Claude/native launch fixtures; cancellation/restart/drift tests; credentialed live native targets.
- Blocked by: S6-F7-T1
- Blocks: S6-F7-T3, S6-F7-T5, S6-F7-T6
- Context: F11 adapters/protocol clients, F3 engines, runtime launch bridge, run reservation and diagnostics.

### S6-F7-T3 — Materialize child Chats and versioned task/result envelopes

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F7
- Outcome: `Continue with` and `Delegate to` cross providers through distinct child Chats with bounded visible context and durable typed results.
- Scope: Continue/delegate modes; parent/initiator/ancestor lineage; child Chat/provider-session materialization; visible-context manifest and digest; explicit file/artifact references; task/result envelope versions; required capabilities; structured-output schema mapping for Codex/Claude/Native; output validation/repair; limitations and terminal evidence; deletion/stale-lineage behavior.
- Out of scope: Reusing a native provider session across harnesses, copying hidden history/private reasoning/secrets/raw session files, prompt-only schema imitation, or folding child history into the parent.
- Acceptance: Both provider directions create separately navigable child Chats; imported history is labeled context; selected/omitted scope is auditable; required unsupported output blocks before claim; invalid/absent output fails its barrier; child result and artifact references remain durable after restart/source deletion.
- Verification: Bidirectional continuation/delegation contract tests; lineage/navigation/missing-parent tests; envelope version/size/digest/import/export/privacy tests; cross-adapter valid/invalid/absent/oversize/schema-repair/checkpoint/restart tests; credentialed live paths.
- Blocked by: S6-F7-T1, S6-F7-T2
- Blocks: S6-F7-T5, S6-F7-T6
- Context: chat-handoff visible exporter, durable Chats, spawned-agent service, workflow schemas, F11 launch input, provider structured output.

### S6-F7-T4 — Enforce cross-provider authority, worktree, budget, and controls

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F7
- Outcome: Delegation cannot expand authority, leak credentials, exceed limits, corrupt a shared worktree, or claim unsupported controls.
- Scope: Effective-authority intersection; provider/account/permission/network/tool/MCP/skill/descendant/budget/workspace/worktree preview and approval; credential isolation; shared-worktree lease/conflict policy; isolated-worktree lifecycle; exact cancel/pause/resume/steer capability; group cascade; race with terminal; audit and partial results.
- Out of scope: Credential forwarding, ambient approval inheritance, suspending OS processes without provider support, auto-merge/commit/push/deploy, or destructive worktree cleanup.
- Acceptance: Child authority never exceeds every ceiling; provider credentials remain isolated; escalation or target change invalidates approval; conflicting worktree use blocks or follows reviewed policy; unsupported controls leave target unchanged; terminal wins races; every partial result is durable and attributable.
- Verification: Permission/approval/revoke/account/secret/descendant/budget tests; lease/conflict/checkpoint/diff/cleanup tests; capability/race/cascade/partial/terminal/restart tests; live supported and unsupported targets.
- Blocked by: S6-F7-T1
- Blocks: S6-F4-T6, S6-F6-T5, S6-F7-T5, S6-F7-T6
- Context: permission boundary, approval coordinator, worktree coordinator, Runtime controls, cascade control, lifecycle CAS.

### S6-F7-T5 — Unify activity, usage, cancellation, and recovery without replay

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F7
- Outcome: Parent and child projections reference exact native activity, usage, and lifecycle while retaining attempt identity and surviving every crash window without duplicate work.
- Scope: Activity high-water and ordered merge; delegation/workflow-only events; definition/Chat/run/target/checkpoint/attempt identity; child result projection; provider/account/model/Runtime usage references and parent aggregation; cancellation intent; terminal CAS; reservations; crash windows; uncertain state; retry; cleanup and long-history bounds.
- Out of scope: Copying/relabeling native activity or reasoning, estimating missing usage as fact, double counting child usage, or replaying uncertain work.
- Acceptance: Dedupe/reorder/restart safe; prior runs cannot satisfy fresh attempts; parent totals reference actual child usage once; partial cancellation persists; terminal results are atomic with accepted output; uncertainty never auto-replays; missing usage remains unknown.
- Verification: Concurrent reservation, crash/fault injection at every launch/result/terminal window, activity order/dedupe, usage aggregation/provenance, cancel/terminal races, restart/no-replay, retry lineage, corruption isolation, and 10k-event tests.
- Blocked by: S6-F7-T1, S6-F7-T2, S6-F7-T3, S6-F7-T4
- Blocks: S6-F4-T4, S6-F6-T4, S6-F7-T6, S6-F7-T7
- Context: F11 activity/usage stores, F3 workflow checkpoints/fleet, child result projector, recovery coordinator.

### S6-F7-T6 — Ship truthful composition UX and target previews

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F7
- Outcome: Users can preview, continue, delegate, inspect, repair, cancel, and recover native, enhanced, and translated Runtime compositions without interpreting adapter compatibility themselves.
- Scope: Capability-compatible Runtime selector; Native/Enhanced/Translated badges; adapter-chain and loss preview; `Continue with` and `Delegate to`; execution-target/context/authority/worktree/budget preview; unavailable reason/repair; lineage/navigation; result/activity references; diagnostics; accessibility; docs; credentialed native and translated paths; mixed workflow; verified Dev and macOS preview package. Windows/Linux parity is owned by S6-F10.
- Out of scope: Hidden fallback, provider UI cloning, or claiming translated/unavailable provider/platform capabilities as native.
- Acceptance: UI distinguishes native, enhanced, and translated targets; only capability-probed translated choices are enabled; provider directions show distinct child Chats and exact provenance; losses/context/permissions/worktree/usage are visible; cancellation and forced restart recover honestly; exact build/profile/version evidence exists.
- Verification: Component/interaction/accessibility/diagnostic tests; credentialed verified-Dev continuation/delegation/mixed-workflow/incompatible-repair/cancel/restart matrix; `npm run package:preview:mac` walkthrough and logs; native Windows/Linux composition repeated by S6-F10.
- Blocked by: S6-F7-T2, S6-F7-T3, S6-F7-T4, S6-F7-T5, native package/host rows from S6-F10 as applicable
- Blocks: S6-F7-T7, S6-F11-T3, S6-F11-T6
- Context: Runtime and provider selectors, Chat handoff/actions, lineage UI, diagnostics, docs/stage6-full-feature-test-matrix.md.

### S6-F7-T7 — Close Runtime and cross-provider composition acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F7
- Outcome: Native Runtime boundaries and bidirectional cross-provider composition pass automated, live, restart, privacy, accessibility, and package evidence on one exact candidate.
- Scope: Matrix S6-RO; migrations/rollback; native/enhanced/translated target compatibility; adapter packs; ports; provider authority; child Chats; task/result envelopes; structured output; permission/worktree/budget ceilings; controls; activity/usage; no-replay; UX; security/privacy; docs and manual test handoff.
- Out of scope: New coordination engine, universal provider session, unlabeled native cross-wiring, hosted relay, release publication, or unsupported platform claim.
- Acceptance: Native and translated Codex/Claude plus one generic/local adapter path complete with exact child lineage, bounded visible context, schemas, activity, usage, controls, loss matrices, and recovery; crash/restart never duplicates; secrets/private reasoning never cross; every ownership boundary and unsupported state remains truthful.
- Verification: Node 22 `npm run check`; strict OpenSpec; migration/rollback/security/privacy/accessibility/performance suites; `npm run dev` plus `npm run dev:verify`; credentialed bidirectional provider matrix; forced restart; macOS preview package; exact-SHA user manual test. Unobserved Windows/Linux rows remain open until S6-F10 evidence exists.
- Blocked by: S6-F7-T5, S6-F7-T6, S6-F7-T8
- Blocks: S6-F4-T8, S6-F6-T10, S6-F11-T3, S6-F11-T4, S6-F11-T6
- Context: docs/stage6-full-feature-test-matrix.md and Stage 6 manual-test handoff.

### S6-F7-T8 — Build and verify cross-provider Runtime adapter packs

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F7
- Outcome: Codex, Claude Code, and Flapstack Native Runtime contracts are available to other providers/models wherever a versioned adapter can enforce the requested capabilities.
- Scope: Provider/Runtime adapter SDK and registry; native/enhanced/translated identity; system/developer prompt and instruction-file mapping; tool/permission/MCP/skill/hook translation; session/resume/fork semantics; attachments; reasoning/activity projection; structured output; usage/cancel/recovery; loss matrices; initial Claude-to-Codex-contract, OpenAI-to-Claude-contract, and one generic/local adapter pack; contract fixtures and live proof.
- Out of scope: Claiming translated execution is native, copying proprietary hidden prompts, credential forwarding, private reasoning conversion, prompt-only tool/session emulation, or enabling a combination whose required semantics cannot be enforced.
- Acceptance: Every adapter advertises exact supported/unsupported/lossy capabilities; required gaps block before provider intent; native reference fixtures and translated fixtures share one contract suite; provider credentials and sessions remain isolated; no adapter creates a second activity/session authority; one Claude, one OpenAI, and one generic/local translated path pass end-to-end with truthful labels.
- Verification: Adapter conformance/property/fuzz tests; prompt/instruction/tool/permission/session/event/output/usage/cancel/restart/privacy fixtures; credentialed translated provider matrix; verified Dev and macOS preview package; Windows/Linux rows remain open for S6-F10.
- Blocked by: S6-F7-T1, S6-F7-T2, S6-F7-T3, S6-F7-T4
- Blocks: S6-F7-T6, S6-F7-T7
- Context: Runtime registry, provider clients, capability snapshots, extension management, activity envelope, structured-output bridge, Stage 4 parity/Enhanced split.
