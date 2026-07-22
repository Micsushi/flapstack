# S6-F3 — Agent Profiles and Reusable Personalities

### S6-F3-T1 — Lock vocabulary, boundaries, and S4 migration behavior

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F3
- Outcome: Agent Profile, Personality, and Starter Profile have one non-overlapping contract.
- Scope: Canonical copy; capability/personality field ownership; preset removal; scopes; inheritance; versioning; launch precedence; inline S4 migration; trait schema; speed semantics; rollback.
- Out of scope: Schema and UI implementation.
- Acceptance: Every S4 field has one destination; personality cannot grant authority; historical snapshots remain readable.
- Verification: Product/security/data-model review and migration decision table.
- Blocked by: fully accepted S4-F12
- Blocks: S6-F3-T2, S6-F3-T3, S6-F3-T4, S6-F3-T5, S6-F3-T6, S6-F3-T7, S6-F3-T8
- Context: S4 agent profile schema/migration/docs, extension trust, runtime capabilities.

### S6-F3-T2 — Add versioned Markdown personality contracts and storage

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F3
- Outcome: Reusable personality files have stable identity, typed traits, immutable versions, trust, and safe local storage.
- Scope: YAML frontmatter/body schema; IDs/versions/scopes/base; size/encoding; central/project paths; provenance; secret scan; parse errors; CRUD/archive/search; file/DB transaction; watchers; backup.
- Out of scope: Profile resolution and editor UI.
- Acceptance: No executable semantics; concurrent edits never overwrite silently; malformed/secret-bearing files quarantine; versions are immutable.
- Verification: Parser/property/path/symlink/concurrency/secret/migration/restart tests.
- Blocked by: S6-F3-T1
- Blocks: S6-F3-T3, S6-F3-T4, S6-F3-T8
- Context: project vault files, extension file adapters, agent profile version service.

### S6-F3-T3 — Resolve personality references and migrate embedded presentation

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F3
- Outcome: Profiles reference exact personality versions while all S4 profiles/history remain valid.
- Scope: Schema/migration; nullable exact ref; inline legacy representation; conversion flow; resolver precedence/source preview; immutable combined snapshot/digest; current-policy revalidation; rollback.
- Out of scope: New-chat and Profile Studio UI.
- Acceptance: Fresh and upgraded profiles resolve identically; edits affect future launches only; missing/archived personality blocks with repair, no fallback.
- Verification: S4 fixture migration/rollback, resolver/source, snapshot immutability, missing/archive, concurrent conversion, and restart tests.
- Blocked by: S6-F3-T1, S6-F3-T2
- Blocks: S6-F3-T4, S6-F3-T5, S6-F3-T6, S6-F3-T8
- Context: agent_profile_versions, presentation_json, resolver, snapshot service.

### S6-F3-T4 — Extend Profile Studio with a reusable Personality Library

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F3
- Outcome: Users create, preview, version, duplicate, import/export, archive, and select personalities separately from capability.
- Scope: Personality list/editor; Markdown/traits preview; profile reference chooser; source/version diff; convert-inline action; compatibility; missing repair; accessibility; multi-window invalidation.
- Out of scope: New-chat launch chooser.
- Acceptance: Capability and personality remain visually separate; preview shows exact versions/sources; save conflicts do not lose text.
- Verification: Reducer/component/accessibility/import/concurrency/multi-window/restart and manual Profile Studio walkthrough.
- Blocked by: S6-F1-T2, S6-F1-T5, S6-F3-T2, S6-F3-T3
- Blocks: S6-F3-T5, S6-F3-T8, S6-F3-T9
- Context: Profile Studio, Markdown editor, settings search, portability.

### S6-F3-T5 — Add Agent Profile selection to every new-chat flow

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F3
- Outcome: A selected named profile preconfigures a new chat without repeated prompt context.
- Scope: Global/project/task new chat; chooser/search/recent; exact profile/personality preview; model/runtime/skills/permission/effort/speed/worktree summary; compatibility; idle chat creation; provenance chip; change-before-first-run.
- Out of scope: Changing a started chat profile in place.
- Acceptance: One new chat stores exact selected versions; incompatible choice blocks; no run starts automatically; empty chat can change selection safely.
- Verification: New-chat component/service tests, idempotency, all scopes, compatibility, permissions, accessibility, and live Codex/Claude/local walkthrough.
- Blocked by: S6-F1-T4, S6-F3-T3, S6-F3-T4
- Blocks: S6-F3-T9, S6-F11-T3
- Context: new-chat form, Agent Runtime resolver, copy-on-create permissions.

### S6-F3-T6 — Add exact profile selection to sub-agent and workflow creation

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F3
- Outcome: Parents and workflow authors select named specialists such as Reviewer by stable allowed profile identity.
- Scope: Spawn API/approval; direct child chooser; allowed descendants; workflow worker binding; exact versions; snapshot before durable child rows; context fork; limits/budgets; lineage/activity labels; retry/resume/fork.
- Out of scope: Letting profile prompts alter topology or authority.
- Acceptance: Display-name collision cannot substitute a profile; child receives required skills/instructions without prompt duplication; disallowed descendants fail before creation.
- Verification: Direct spawn/workflow parallel/dependency/retry/restart/idempotency/permission/lineage tests and live mixed-agent walkthrough.
- Blocked by: S6-F3-T1, S6-F3-T3, accepted S4-F3/F12
- Blocks: S6-F3-T9, S6-F11-T3
- Context: profile workflow materializer, spawned-agent service, orchestration definitions.

### S6-F3-T7 — Add provider-supported speed preference independent of effort

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F3
- Outcome: Profiles request speed/fast mode separately from reasoning effort with honest adapter compatibility.
- Scope: Capability schema; adapter matrix; resolver/precedence; profile and launch overrides; preview; immutable snapshot; usage/activity labels; unavailable/changed capability repair.
- Out of scope: Inventing universal speed controls or pricing claims.
- Acceptance: Unsupported/unknown fails visibly; model change clears or repairs incompatible speed; effort remains unchanged.
- Verification: Cross-runtime/model capability fixtures, resolver, snapshot, model-change, live supported Codex path, and unsupported-provider tests.
- Blocked by: S6-F3-T1, accepted S4-F11
- Blocks: S6-F3-T8, S6-F3-T9
- Context: model-run-controls, runtime compatibility, agent capability schema.

### S6-F3-T8 — Extend starter profiles, trust, portability, and evaluation

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F3
- Outcome: Small starter profiles and reusable personalities remain safe, portable, and honestly evaluated.
- Scope: Planner/Implementer/Reviewer/Verifier conversion; optional shared starter personalities; user-copy flow; bundle versions; unresolved refs; prompt injection; cross-model/runtime/effort/speed evidence; no marketplace.
- Out of scope: Large public catalog.
- Acceptance: Built-ins remain read-only; imports grant no authority; unsupported combinations are labeled/blocked; user copies are independent.
- Verification: Golden/evaluation/adversarial/import/export/missing-ref/version and regression tests.
- Blocked by: S6-F3-T2, S6-F3-T3, S6-F3-T7
- Blocks: S6-F3-T9
- Context: starter catalog, evaluation runner, portability trust.

### S6-F3-T9 — Close profile and personality acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F3
- Outcome: Custom, starter, new-chat, direct child, and workflow agents reuse exact personality/profile snapshots safely.
- Scope: Matrix S6-AP; migration/rollback; Studio; new chat; child/workflow; speed/effort; import/export; restart; accessibility; package and provider evidence.
- Out of scope: Hosted personality/profile marketplace.
- Acceptance: One personality serves multiple profiles without sharing capability; Reviewer child launches with exact skills/instructions; historical behavior remains immutable.
- Verification: Node 22 npm run check, strict OpenSpec, verified Dev, credentialed provider matrix, forced restart, accessibility, and packaged preview.
- Blocked by: S6-F3-T4, S6-F3-T5, S6-F3-T6, S6-F3-T7, S6-F3-T8
- Blocks: S6-F11-T3, S6-F11-T5
- Context: docs/stage6-full-feature-test-matrix.md.
