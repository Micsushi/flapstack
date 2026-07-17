# Runtime parity/enhanced split

### S4-F11A-T1 — Freeze preference and transport contracts

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F11A
- Outcome: Parity, enhanced, and Native behavior resolve deterministically onto
  three transport adapters.
- Scope: Types, labels, mapping, compatibility, precedence, immutable snapshot,
  release-policy mapping, and diagnostics contracts.
- Acceptance: Six explicit preferences including Automatic map without silent
  fallback; enhanced preferences preserve their identity while resolving the
  matching native adapter.
- Verification: Resolver, compatibility, settings-model, snapshot, and
  diagnostics tests.
- Blocked by: S4-F11 available implementation
- Blocks: S4-F11A-T2, S4-F11A-T3, S4-F11A-T4
- Context: shared Agent Runtime contract, resolver, snapshot, diagnostics.

### S4-F11A-T2 — Migrate stored Runtime preferences safely

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F11A
- Outcome: Existing databases accept enhanced preferences without reinterpreting
  historical runs.
- Scope: Additive migration, defaults constraint, active-run trigger constraints,
  schema metadata, migration fixtures, rollback/readability proof.
- Acceptance: Existing direct behavior is relabeled Enhanced while transport,
  messages, events, and provider identity are byte-preserved; enhanced defaults
  and active run snapshots insert successfully; invalid values remain rejected.
- Verification: Focused migration/integrity/constraint tests.
- Blocked by: S4-F11A-T1
- Blocks: S4-F11A-T3, S4-F11A-T4
- Context: migrations 0034-0040, Runtime defaults, immutable run triggers.

### S4-F11A-T3 — Separate provider parity from Flapstack enhancements

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F11A
- Outcome: Codex and Claude Code parity omit Flapstack prompt/extension additions;
  Enhanced modes retain them over the same native adapters.
- Scope: Direct launch instruction resolution, Codex thread params, Claude SDK
  query options, native instruction discovery, managed hooks/MCP/skills policy,
  session continuation guard, prompt-policy tests.
- Acceptance: No Flapstack startup/vault text reaches parity options; Enhanced
  receives it once; both retain provider-native presets/settings and the same
  transport/event fidelity.
- Verification: Unit/contract tests with captured launch options and no-leak
  assertions for both providers.
- Blocked by: S4-F11A-T1, S4-F11A-T2
- Blocks: S4-F11A-T4, S4-F11A-T5
- Context: main Runtime launcher, Codex App Server adapter, Claude Agent SDK,
  launch context, extension management.

### S4-F11A-T4 — Expose the split in Settings and Chat controls

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F11A
- Outcome: Users can select and understand provider parity, provider enhanced,
  and Flapstack Native choices.
- Scope: Settings rows, Chat Runtime selector, labels/icons, inherited/default
  state, release reasons, diagnostics, accessibility, continuation copy.
- Acceptance: Codex and Claude each show parity, matching Enhanced, and Native;
  generic harnesses show Native only; started Chats branch when behavior changes.
- Verification: Component/model/lifecycle/accessibility tests.
- Blocked by: S4-F11A-T1, S4-F11A-T2, S4-F11A-T3
- Blocks: S4-F11A-T5
- Context: Runtime Settings model/tab, Chat selector, lifecycle service.

### S4-F11A-T5 — Verify exact provider and package behavior

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F11A
- Outcome: Parity and Enhanced modes have direct fixture, live-provider, restart,
  UI, and package evidence without overstating closed-provider parity.
- Scope: Full automated gate, strict OpenSpec, exact-version Codex/Claude
  comparisons, restart/continue, verified Dev, macOS preview, documentation.
- Acceptance: Automated gates pass; parity has no Flapstack instruction leakage;
  enhanced has exactly one approved addition; limitations are documented.
- Verification: Node 22 `npm run check`; strict OpenSpec; `npm run dev` and
  `npm run dev:verify`; credentialed provider matrix; macOS preview package.
- Blocked by: S4-F11A-T3, S4-F11A-T4
- Blocks: Stage 5 cross-provider Runtime adapters
- Context: Runtime fixtures, release policy, Stage 4 matrix/manual handoff.
