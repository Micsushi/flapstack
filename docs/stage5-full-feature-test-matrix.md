# Stage 5 Full Feature Test Matrix

Every row remains open until observed against the exact stated SHA/build/profile.
Headless, prior-SHA, fixture-only, or cross-built evidence cannot close required
live, usability, device, provider, package, or native-platform rows.

## Automated and migration gate

- [ ] **S5-A01** All twelve Stage 5 OpenSpec changes pass strict validation.
- [ ] **S5-A02** Node 22 npm run check passes from the exact candidate.
- [ ] **S5-A03** Clean install, final Stage 4 upgrade, interrupted migration,
      rollback/reopen, and data-integrity fixtures pass.
- [ ] **S5-A04** Security suites cover paths/symlinks, secrets, Markdown/profile
      trust, mobile replay/network, visual redaction, organization credentials,
      graph/frontmatter/Obsidian boundaries, group control, and package artifacts.
- [ ] **S5-A05** Visual, accessibility, performance, and evidence-ledger validators pass.

## Product-wide UI/UX polish

- [ ] **S5-UX01** Navigation preserves project/task/chat/run/workspace context
      and every destination is keyboard/search reachable.
- [ ] **S5-UX02** Chat/composer/details expose launch-critical choices and
      truthful recovery without crowding or duplicate controls.
- [ ] **S5-UX03** Settings categories are alphabetically ordered and every
      eligible control is searchable/deep-linkable.
- [ ] **S5-UX04** Progress capsule, transcript timeline, workspaces, and
      multi-window ownership remain accurate and responsive at supported limits.
- [ ] **S5-UX05** Primary flows pass keyboard, screen-reader, contrast, zoom,
      reduced-motion, responsive, dynamic-vocabulary privacy/transcript review,
      and observed novice/power-user usability checks.

## Guided onboarding and feature visibility

- [ ] **S5-ON01** Fresh Focused, Standard, Complete, skipped, interrupted, and
      resumed onboarding paths produce reviewed deterministic visibility.
- [ ] **S5-ON02** Existing-user upgrade preserves current visibility until opt-in.
- [ ] **S5-ON03** Hidden features retain data, APIs/MCP, safety, background
      behavior, Settings search, and reversible re-enable paths.
- [ ] **S5-ON04** Feature explanations agree across tutorial, Settings, empty
      states, and contextual help; rerun previews before applying.

## Agent Profiles and reusable personalities

- [ ] **S5-AP01** Agent Profile is the single complete configuration; no agent
      preset entity or duplicate registry exists.
- [ ] **S5-AP02** Multiple profiles reference one exact Markdown personality
      version while retaining independent capabilities/authority.
- [ ] **S5-AP03** New global/project/task chats select an exact compatible
      profile/personality without auto-launching.
- [ ] **S5-AP04** Direct children and workflow workers resolve stable allowed
      profile IDs/versions and retain immutable snapshots across retry/restart.
- [ ] **S5-AP05** Effort and speed/fast preference resolve independently; import,
      migration, evaluation, Studio, providers, accessibility, and package pass.

## Cross-agent mobile companion

- [ ] **S5-MC01** Bridge is default-off, private-interface-only, authenticated,
      rate-limited, and stops on unsafe network change.
- [ ] **S5-MC02** QR pairing, fingerprint, device keys, sessions, expiry, replay
      defense, rename, and immediate revoke pass.
- [ ] **S5-MC03** Scoped snapshots/events recover gaps without stale mutation,
      unbounded memory, unauthorized data, or completed-work replay.
- [ ] **S5-MC04** PWA monitoring, steering, lifecycle control, approvals,
      offline state, and notifications call shared services and remain honest.
- [ ] **S5-MC05** Real iOS and Android-class browsers plus desktop packages pass
      pairing/control/revoke/reconnect/security/accessibility evidence.

## Visual context and screenshot capture

- [ ] **S5-VC01** Screen/window/region capture requires visible selection or
      scoped approval and handles OS permissions/multiple displays truthfully.
- [ ] **S5-VC02** Preview/crop/annotation/redaction prevents recovery of removed
      pixels/metadata and persists the exact confirmed derivative hash.
- [ ] **S5-VC03** Chat/task/knowledge/run artifacts preserve scope/provenance;
      unselected visuals never enter agent context.
- [ ] **S5-VC04** Agent capture, history/retention/export, tamper/missing state,
      and standalone helper reuse the same safety and pass platform/package proof.

## Terminal-grid and swarm workspaces

- [ ] **S5-TG01** Grid panes bind existing identities and exclusive chat/window
      ownership without creating duplicate tasks, chats, agents, or terminals.
- [ ] **S5-TG02** Layouts/templates restore crash-safely; stale panes repair
      independently; default users are not forced into advanced mode.
- [ ] **S5-TG03** Fleet/lineage/activity/task-path projections preserve exact
      Runtime/provenance and never synthesize/replay/private-reasoning state.
- [ ] **S5-TG04** Group actions preview exact selection, use shared authority,
      report partial results, and pass keyboard/reader/scale/performance evidence.

## Runtime and orchestration composition

- [ ] **S5-RO01** F3 coordination uses one F11-owned provider client/request
      authority with exact capability/version and no silent fallback.
- [ ] **S5-RO02** Required workflow schemas reach supported adapters and invalid,
      absent, or unsupported output fails before barrier success.
- [ ] **S5-RO03** Pause/resume is capability-gated and races with terminal/cancel
      preserve authoritative per-target results.
- [ ] **S5-RO04** Activity references, reservations, cancellation, crash/restart,
      mixed Runtimes, providers, packages, and platforms pass without replay.

## Organization usage APIs

- [ ] **S5-OU01** Optional OpenAI/Anthropic Admin credentials are write-only,
      organization-bound, removable, and absent from logs/exports.
- [ ] **S5-OU02** Pagination/cursors/rate limits/freshness and exact organization,
      endpoint, window, currency, coverage, and truth provenance pass.
- [ ] **S5-OU03** Organization totals remain separate from run samples; rebuild,
      reconciliation, dashboard, budgets, and alerts never double count.
- [ ] **S5-OU04** Low-value live credentials, closed-app daemon, revoke/failure,
      package/platform, and sanitized evidence pass or remain explicit blockers.

## Obsidian-compatible project knowledge graph

- [ ] **S5-KG01** Existing Stage 4 vaults migrate the six typed sections into
      seed/system nodes without content, version, hash, backup, selection, or rollback loss.
- [ ] **S5-KG02** Unlimited custom notes/folders and safe attachments preserve
      stable identity, frontmatter, aliases, tags, supported embeds, and exact conflicts.
- [ ] **S5-KG03** Wikilinks, heading/block links, aliases, unresolved/ambiguous
      targets, backlinks, and graph edges match the declared Obsidian-compatible subset.
- [ ] **S5-KG04** Note tree, backlinks, local graph, whole-vault graph, filters,
      and equivalent lists pass keyboard, reader, touch, zoom, reduced-motion,
      multi-window, and graph/list-truth evidence.
- [ ] **S5-KG05** Real Obsidian opens the same central and project-owned folders;
      create/edit/link/rename/move/attachment/conflict/restart round trips preserve both tools' data.
- [ ] **S5-KG06** App-managed memory stays outside Git; project-owned untracked
      setup verifies a local exclude; tracking removal is separately confirmed;
      Flapstack never stages or commits knowledge.
- [ ] **S5-KG07** Exact node selection and explicitly bounded link expansion
      preserve provenance/budgets; unselected links, secrets, unsafe files, and
      out-of-scope agent operations never enter runs, previews, search, or audit content.
- [ ] **S5-KG08** Index deletion/rebuild, watcher storms, export/import/root
      remapping, corruption/recovery, declared-scale performance, Dev, and native
      package profiles pass without trusting derived indexes or `.obsidian` state.

## Performance and scale

- [ ] **S5-PF01** Versioned budgets and deterministic reports record exact
      SHA/build/platform/hardware/dataset/method/variance.
- [ ] **S5-PF02** Cold/warm startup, first-use, renderer, long-chat, search,
      migration, and database budgets pass without truth loss.
- [ ] **S5-PF03** Supported agent/terminal/grid concurrency, output flood,
      cancellation, cleanup, idle services, sleep/wake, and 24h soak pass.
- [ ] **S5-PF04** CI/local regression gates and published support limits match
      observed native package results.

## Cross-platform public distribution

- [ ] **S5-PD01** Support claims map to native observed OS/architecture/package
      rows; no target is promoted from cross-build alone.
- [ ] **S5-PD02** macOS public artifacts pass Developer ID signing, hardened
      runtime/entitlements, notarization, staple, Gatekeeper, and clean lifecycle.
- [ ] **S5-PD03** Windows package, native modules, services, secret store,
      Runtimes, speech/capture, upgrade/uninstall, and cleanup pass natively.
- [ ] **S5-PD04** Linux package/distro/display, native modules, services, secret
      store fallback, Runtimes, speech/capture, upgrade/uninstall pass natively.
- [ ] **S5-PD05** Checksums, file/architecture manifest, dependencies/SBOM,
      secret/malware/security scans, documentation, and withdrawal recovery pass.

## Integrated release

- [ ] **S5-I01** Candidate ledger maps every required row to current exact-SHA evidence.
- [ ] **S5-I02** Clean install and Stage 4 upgrade/rollback preserve all supported
      data, identity, authority, history, and preferences.
- [ ] **S5-I03** One project exercises onboarding, shared personality/profile,
      mixed workflow/Reviewer child, grid, visual context, mobile, usage,
      Obsidian knowledge graph/context round trip, restart, audit, and export
      with matching durable state.
- [ ] **S5-I04** Independent security/privacy, UI/accessibility/usability,
      performance, native-platform, artifact, package, and docs reviews pass.
- [ ] **S5-I05** Up to three review/fix rounds leave no P0/P1 or acceptance
      blocker and produce one exact-SHA handoff; remote release actions remain separately authorized.
