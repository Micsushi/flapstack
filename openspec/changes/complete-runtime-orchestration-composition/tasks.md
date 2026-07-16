# S5-F7 — Runtime and Cross-Provider Orchestration Composition

### S5-F7-T1 — Freeze ownership, execution-target, and compatibility contracts

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F7
- Outcome: Every target field and request/control/activity/result field has one authoritative owner, and every valid or invalid harness/Runtime combination is deterministic.
- Scope: F3/F11 seam audit; `ExecutionTarget` schema; harness/Runtime/provider/model/account/profile/permission/worktree compatibility graph; capability snapshot/version; precedence; target preview contract; failure/repair taxonomy; Stage 4 migration and deprecation map.
- Out of scope: Provider implementation or universal cross-wired Runtime.
- Acceptance: Codex cannot resolve Claude Code Runtime; Claude cannot resolve Codex Runtime; explicit Flapstack Native compatibility remains truthful; unsupported/unknown blocks before mutation; no duplicate process/parser/activity owner; Stage 4 snapshots remain readable.
- Verification: Architecture and security review; resolver/precedence/compatibility/probe-drift/migration/property tests; invalid-pair and no-silent-fallback fixtures.
- Blocked by: fully accepted S4-F3 and S4-F11
- Blocks: S5-F7-T2, S5-F7-T3, S5-F7-T4, S5-F7-T5
- Context: RuntimeLaunchCoordinator, Agent Runtime resolver, coordination engines, Agent Profiles, Chat lineage, activity references.

### S5-F7-T2 — Resolve exact targets through one native Runtime authority

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F7
- Outcome: Direct, continuation, delegated, and workflow launches use one immutable compatible target and one F11-owned provider client/session/event source.
- Scope: Versioned F3 consumer port; target resolution and probe; Codex V2/V1 task-path/mailbox/follow-up/interrupt routing through F11 App Server authority; Claude/native adapter routing; immutable target snapshot; request correlation; idempotent launch intent; adapter drift; diagnostics; explicit repair and retry.
- Out of scope: Second Codex App Server client in F3, Claude-through-Codex, Codex-through-Claude, or post-intent fallback.
- Acceptance: One process/session owner per child; exact target persists before provider intent; unsupported version/capability blocks; drift expires preview; events retain provider/run/task-path provenance; retries create explicit new attempts.
- Verification: Port/version/probe/process-count/request-correlation/idempotency tests; Codex mailbox/follow-up/interrupt fixtures; Claude/native launch fixtures; cancellation/restart/drift tests; credentialed live native targets.
- Blocked by: S5-F7-T1
- Blocks: S5-F7-T3, S5-F7-T5, S5-F7-T6
- Context: F11 adapters/protocol clients, F3 engines, runtime launch bridge, run reservation and diagnostics.

### S5-F7-T3 — Materialize child Chats and versioned task/result envelopes

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F7
- Outcome: `Continue with` and `Delegate to` cross providers through distinct child Chats with bounded visible context and durable typed results.
- Scope: Continue/delegate modes; parent/initiator/ancestor lineage; child Chat/provider-session materialization; visible-context manifest and digest; explicit file/artifact references; task/result envelope versions; required capabilities; structured-output schema mapping for Codex/Claude/Native; output validation/repair; limitations and terminal evidence; deletion/stale-lineage behavior.
- Out of scope: Reusing a native provider session across harnesses, copying hidden history/private reasoning/secrets/raw session files, prompt-only schema imitation, or folding child history into the parent.
- Acceptance: Both provider directions create separately navigable child Chats; imported history is labeled context; selected/omitted scope is auditable; required unsupported output blocks before claim; invalid/absent output fails its barrier; child result and artifact references remain durable after restart/source deletion.
- Verification: Bidirectional continuation/delegation contract tests; lineage/navigation/missing-parent tests; envelope version/size/digest/import/export/privacy tests; cross-adapter valid/invalid/absent/oversize/schema-repair/checkpoint/restart tests; credentialed live paths.
- Blocked by: S5-F7-T1, S5-F7-T2
- Blocks: S5-F7-T5, S5-F7-T6
- Context: chat-handoff visible exporter, durable Chats, spawned-agent service, workflow schemas, F11 launch input, provider structured output.

### S5-F7-T4 — Enforce cross-provider authority, worktree, budget, and controls

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F7
- Outcome: Delegation cannot expand authority, leak credentials, exceed limits, corrupt a shared worktree, or claim unsupported controls.
- Scope: Effective-authority intersection; provider/account/permission/network/tool/MCP/skill/descendant/budget/workspace/worktree preview and approval; credential isolation; shared-worktree lease/conflict policy; isolated-worktree lifecycle; exact cancel/pause/resume/steer capability; group cascade; race with terminal; audit and partial results.
- Out of scope: Credential forwarding, ambient approval inheritance, suspending OS processes without provider support, auto-merge/commit/push/deploy, or destructive worktree cleanup.
- Acceptance: Child authority never exceeds every ceiling; provider credentials remain isolated; escalation or target change invalidates approval; conflicting worktree use blocks or follows reviewed policy; unsupported controls leave target unchanged; terminal wins races; every partial result is durable and attributable.
- Verification: Permission/approval/revoke/account/secret/descendant/budget tests; lease/conflict/checkpoint/diff/cleanup tests; capability/race/cascade/partial/terminal/restart tests; live supported and unsupported targets.
- Blocked by: S5-F7-T1
- Blocks: S5-F4-T6, S5-F6-T5, S5-F7-T5, S5-F7-T6
- Context: permission boundary, approval coordinator, worktree coordinator, Runtime controls, cascade control, lifecycle CAS.

### S5-F7-T5 — Unify activity, usage, cancellation, and recovery without replay

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F7
- Outcome: Parent and child projections reference exact native activity, usage, and lifecycle while retaining attempt identity and surviving every crash window without duplicate work.
- Scope: Activity high-water and ordered merge; delegation/workflow-only events; definition/Chat/run/target/checkpoint/attempt identity; child result projection; provider/account/model/Runtime usage references and parent aggregation; cancellation intent; terminal CAS; reservations; crash windows; uncertain state; retry; cleanup and long-history bounds.
- Out of scope: Copying/relabeling native activity or reasoning, estimating missing usage as fact, double counting child usage, or replaying uncertain work.
- Acceptance: Dedupe/reorder/restart safe; prior runs cannot satisfy fresh attempts; parent totals reference actual child usage once; partial cancellation persists; terminal results are atomic with accepted output; uncertainty never auto-replays; missing usage remains unknown.
- Verification: Concurrent reservation, crash/fault injection at every launch/result/terminal window, activity order/dedupe, usage aggregation/provenance, cancel/terminal races, restart/no-replay, retry lineage, corruption isolation, and 10k-event tests.
- Blocked by: S5-F7-T1, S5-F7-T2, S5-F7-T3, S5-F7-T4
- Blocks: S5-F4-T4, S5-F6-T4, S5-F7-T6, S5-F7-T7
- Context: F11 activity/usage stores, F3 workflow checkpoints/fleet, child result projector, recovery coordinator.

### S5-F7-T6 — Ship truthful composition UX and prove native provider/package paths

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F7
- Outcome: Users can preview, continue, delegate, inspect, repair, cancel, and recover Codex/Claude compositions without interpreting Runtime compatibility themselves.
- Scope: Harness-compatible Runtime selector; `Continue with` and `Delegate to` actions; execution-target/context/authority/worktree/budget preview; unavailable reason and repair; child Chat lineage/navigation; parent result/activity references; diagnostics; accessibility; docs; credentialed Codex-to-Claude and Claude-to-Codex paths; mixed workflow; verified Dev and macOS preview package. Windows/Linux parity is owned by S5-F10.
- Out of scope: Cross-wired native Runtime choices, hidden fallback, provider UI cloning, or claiming unavailable provider/platform capabilities.
- Acceptance: UI never offers Claude Runtime for Codex or Codex Runtime for Claude; both provider directions show distinct child Chats and exact provenance; context omissions/permissions/worktree/usage are visible; cancellation and forced restart recover honestly; limitations are recorded per adapter/platform; exact build/profile/version evidence exists.
- Verification: Component/interaction/accessibility/diagnostic tests; credentialed verified-Dev continuation/delegation/mixed-workflow/incompatible-repair/cancel/restart matrix; `npm run package:preview:mac` walkthrough and logs; native Windows/Linux composition repeated by S5-F10.
- Blocked by: S5-F7-T2, S5-F7-T3, S5-F7-T4, S5-F7-T5, native package/host rows from S5-F10 as applicable
- Blocks: S5-F7-T7, S5-F11-T3, S5-F11-T6
- Context: Runtime and provider selectors, Chat handoff/actions, lineage UI, diagnostics, docs/stage5-full-feature-test-matrix.md.

### S5-F7-T7 — Close Runtime and cross-provider composition acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F7
- Outcome: Native Runtime boundaries and bidirectional cross-provider composition pass automated, live, restart, privacy, accessibility, and package evidence on one exact candidate.
- Scope: Matrix S5-RO; migrations/rollback; target compatibility; ports; Codex authority; child Chats; task/result envelopes; structured output; permission/worktree/budget ceilings; controls; activity/usage; no-replay; UX; security/privacy; docs and manual test handoff.
- Out of scope: New coordination engine, universal provider session, cross-wired Runtime, hosted relay, release publication, or unsupported platform claim.
- Acceptance: Codex-to-Claude and Claude-to-Codex continuation and delegation complete with exact child lineage, bounded visible context, schemas, activity, usage, controls, and recovery; crash/restart never duplicates; secrets/private reasoning never cross; every ownership boundary and unsupported state remains truthful.
- Verification: Node 22 `npm run check`; strict OpenSpec; migration/rollback/security/privacy/accessibility/performance suites; `npm run dev` plus `npm run dev:verify`; credentialed bidirectional provider matrix; forced restart; macOS preview package; exact-SHA user manual test. Unobserved Windows/Linux rows remain open until S5-F10 evidence exists.
- Blocked by: S5-F7-T5, S5-F7-T6
- Blocks: S5-F4-T8, S5-F6-T8, S5-F11-T3, S5-F11-T4, S5-F11-T6
- Context: docs/stage5-full-feature-test-matrix.md and Stage 5 manual-test handoff.
