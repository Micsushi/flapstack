# Stage 6 Full Feature Test Matrix

Every row remains open until observed against the exact stated SHA/build/profile.
Headless, prior-SHA, fixture-only, or cross-built evidence cannot close required
live, usability, device, provider, package, or native-platform rows.

## Automated and migration gate

- [ ] **S6-A01** All twelve Stage 6 OpenSpec changes pass strict validation.
- [ ] **S6-A02** Node 22 npm run check passes from the exact candidate.
- [ ] **S6-A03** Clean install, final Stage 5 upgrade, preserved Stage 4 legacy
      migration fixture, interrupted migration, rollback/reopen, and data-integrity fixtures pass.
- [ ] **S6-A04** Security suites cover paths/symlinks, secrets, Markdown/profile
      trust, mobile replay/network, visual redaction, organization credentials,
      graph/frontmatter/Obsidian boundaries, group control, and package artifacts.
- [ ] **S6-A05** Visual, accessibility, performance, and evidence-ledger validators pass.

## Product-wide UI/UX polish

- [ ] **S6-UX01** Navigation preserves project/task/chat/run/workspace context
      and every destination is keyboard/search reachable.
- [ ] **S6-UX02** Chat/composer/details expose launch-critical choices and
      truthful recovery without crowding or duplicate controls.
- [ ] **S6-UX03** Settings categories are alphabetically ordered and every
      eligible control is searchable/deep-linkable.
- [ ] **S6-UX04** Progress capsule, transcript timeline, workspaces, and
      multi-window ownership remain accurate and responsive at supported limits.
- [ ] **S6-UX05** Primary flows pass keyboard, screen-reader, contrast, zoom,
      reduced-motion, responsive, dynamic-vocabulary privacy/transcript review,
      and observed novice/power-user usability checks.

## Guided onboarding and feature visibility

- [ ] **S6-ON01** Fresh Focused, Standard, Complete, skipped, interrupted, and
      resumed onboarding paths produce reviewed deterministic visibility.
- [ ] **S6-ON02** Existing-user upgrade preserves current visibility until opt-in.
- [ ] **S6-ON03** Hidden features retain data, APIs/MCP, safety, background
      behavior, Settings search, and reversible re-enable paths.
- [ ] **S6-ON04** Feature explanations agree across questionnaire review, Settings, empty
      states, and contextual help; rerun previews before applying.

## Agent Profiles and reusable personalities

- [ ] **S6-AP01** Agent Profile is the single complete configuration; no agent
      preset entity or duplicate registry exists.
- [ ] **S6-AP02** Multiple profiles reference one exact Markdown personality
      version while retaining independent capabilities/authority.
- [ ] **S6-AP03** New global/project/task chats select an exact compatible
      profile/personality without auto-launching.
- [ ] **S6-AP04** Direct children and workflow workers resolve stable allowed
      profile IDs/versions and retain immutable snapshots across retry/restart.
- [ ] **S6-AP05** Effort and speed/fast preference resolve independently; import,
      migration, evaluation, Studio, providers, accessibility, and package pass.

## Cross-agent mobile companion

- [ ] **S6-MC01** Bridge is default-off, private-interface-only, authenticated,
      rate-limited, and stops on unsafe network change.
- [ ] **S6-MC02** QR pairing, fingerprint, device keys, sessions, expiry, replay
      defense, rename, and immediate revoke pass.
- [ ] **S6-MC03** Scoped snapshots/events recover gaps without stale mutation,
      unbounded memory, unauthorized data, or completed-work replay.
- [ ] **S6-MC04** PWA monitoring, steering, lifecycle control, approvals,
      offline state, and notifications call shared services and remain honest.
- [ ] **S6-MC05** Real iOS and Android-class browsers plus desktop packages pass
      pairing/control/revoke/reconnect/security/accessibility evidence.

## Visual context and screenshot capture

- [ ] **S6-VC01** Screen/window/region capture requires visible selection or
      scoped approval and handles OS permissions/multiple displays truthfully.
- [ ] **S6-VC02** Preview/crop/annotation/redaction prevents recovery of removed
      pixels/metadata and persists the exact confirmed derivative hash.
- [ ] **S6-VC03** Chat/task/knowledge/run artifacts preserve scope/provenance;
      unselected visuals never enter agent context.
- [ ] **S6-VC04** Agent capture, history/retention/export, tamper/missing state,
      and standalone helper reuse the same safety and pass platform/package proof.

## Multi-pane Chat and swarm workspaces

- [ ] **S6-TG01** One, two, three, and four visible top-level Chat panes each
      retain an independent heading, transcript scrollbar, timeline, composer,
      draft, focus, run/stream/error state, and simultaneous send path.
- [ ] **S6-TG02** Tab reorder, center-to-tab, directional edge drops, every
      preset/asymmetric layout, resize, maximize, join/close, and fifth-group
      recovery match their previews through pointer and keyboard paths.
- [ ] **S6-TG03** Drag-out, Move into New Window, cross-window drop, pull-back,
      destination failure, source close/crash, and read-only copy preserve one
      durable Chat identity and never expose two editable owners.
- [ ] **S6-TG04** Main plus three auxiliary workbench windows is the hard app
      maximum across every creation path; fifth-window races preserve source
      state and offer existing-window destinations while exempt dialogs still open.
- [ ] **S6-TG05** Window bounds/display, group trees, active tabs, drafts, split
      sizes, responsive collapse, Saved Workspace promotion, stale panes, and
      old or over-limit state restore crash-safely without deleting work;
      excess saved windows remain dormant and recoverable.
- [ ] **S6-TG06** Terminal/run/agent/worktree/diff/file/browser panes plus
      fleet/lineage/activity/task-path projections preserve exact identity,
      Runtime/provenance, and never synthesize/replay/private-reasoning state.
- [ ] **S6-TG07** Group actions preview exact selection, use shared authority,
      report partial results, and the full feature passes native macOS/Windows/
      Linux multi-window, keyboard/reader, scale, leak, and performance evidence.

## Runtime and orchestration composition

- [ ] **S6-RO01** Every launch previews and snapshots an exact compatible
      harness/Runtime/provider/model/account/profile/permission/worktree target;
      Codex cannot use Claude Code Runtime, Claude cannot use Codex Runtime, and
      no unavailable choice silently falls back.
- [ ] **S6-RO02** F3 coordination uses one F11-owned provider client/session/event
      authority with exact capability/version; Codex V1/V2 and Claude/native
      paths do not create duplicate protocol or activity owners.
- [ ] **S6-RO03** Codex-to-Claude and Claude-to-Codex `Continue with` each create
      a separately navigable child Chat/native session with immutable lineage
      and only the previewed, labeled visible-context manifest.
- [ ] **S6-RO04** Bidirectional `Delegate to` and mixed workflows exchange
      versioned task/result envelopes with durable structured output, artifacts,
      changes, limitations, terminal evidence, and child Chat/run identity.
- [ ] **S6-RO05** Secrets, credentials, private/encrypted reasoning, provider
      session state, hidden tool state, and unselected files never cross provider
      context, logs, diagnostics, audit, or export boundaries.
- [ ] **S6-RO06** Child permissions, provider account, descendants, budgets,
      workspace/worktree, approvals, cancel/pause/resume/steer, and partial group
      results remain capability-gated, previewed, conflict-safe, and no broader
      than every delegation ceiling.
- [ ] **S6-RO07** Activity, result, reservation, usage/cost references,
      cancellation, terminal races, retry, forced crash/restart, uncertain state,
      mixed Runtimes, packages, and platforms preserve exact provenance without
      replay or double counting.
- [ ] **S6-RO08** Verified Dev and macOS preview-package walkthroughs prove both
      provider directions, incompatible-target repair, accessibility, diagnostics,
      cancellation, and recovery; Windows/Linux rows remain open until observed
      natively by S6-F10.

## Organization usage APIs

- [ ] **S6-OU01** Optional OpenAI/Anthropic Admin credentials are write-only,
      organization-bound, removable, and absent from logs/exports.
- [ ] **S6-OU02** Pagination/cursors/rate limits/freshness and exact organization,
      endpoint, window, currency, coverage, and truth provenance pass.
- [ ] **S6-OU03** Organization totals remain separate from run samples; rebuild,
      reconciliation, dashboard, budgets, and alerts never double count.
- [ ] **S6-OU04** Low-value live credentials, closed-app daemon, revoke/failure,
      package/platform, and sanitized evidence pass or remain explicit blockers.

## Obsidian-compatible project knowledge graph

- [ ] **S6-KG01** Existing Stage 4 vaults migrate the six typed sections into
      seed/system nodes without content, version, hash, backup, selection, or rollback loss.
- [ ] **S6-KG02** Unlimited custom notes/folders and safe attachments preserve
      stable identity, frontmatter, aliases, tags, supported embeds, and exact conflicts.
- [ ] **S6-KG03** Wikilinks, heading/block links, aliases, unresolved/ambiguous
      targets, backlinks, and graph edges match the declared Obsidian-compatible subset.
- [ ] **S6-KG04** Note tree, backlinks, local graph, whole-vault graph, filters,
      and equivalent lists pass keyboard, reader, touch, zoom, reduced-motion,
      multi-window, and graph/list-truth evidence.
- [ ] **S6-KG05** Real Obsidian opens the same central and project-owned folders;
      create/edit/link/rename/move/attachment/conflict/restart round trips preserve both tools' data.
- [ ] **S6-KG06** App-managed memory stays outside Git; project-owned untracked
      setup verifies a local exclude; tracking removal is separately confirmed;
      Flapstack never stages or commits knowledge.
- [ ] **S6-KG07** Exact node selection and explicitly bounded link expansion
      preserve provenance/budgets; unselected links, secrets, unsafe files, and
      out-of-scope agent operations never enter runs, previews, search, or audit content.
- [ ] **S6-KG08** Index deletion/rebuild, watcher storms, export/import/root
      remapping, corruption/recovery, declared-scale performance, Dev, and native
      package profiles pass without trusting derived indexes or `.obsidian` state.

## Performance and scale

- [ ] **S6-PF01** Versioned budgets and deterministic reports record exact
      SHA/build/platform/hardware/dataset/method/variance.
- [ ] **S6-PF02** Cold/warm startup, first-use, renderer, long-chat, search,
      migration, and database budgets pass without truth loss.
- [ ] **S6-PF03** Supported agent/terminal/grid concurrency, output flood,
      cancellation, cleanup, idle services, sleep/wake, and 24h soak pass.
- [ ] **S6-PF04** CI/local regression gates and published support limits match
      observed native package results.

## Cross-platform public distribution

- [ ] **S6-PD01** Support claims map to native observed OS/architecture/package
      rows; no target is promoted from cross-build alone.
- [ ] **S6-PD02** macOS public artifacts pass Developer ID signing, hardened
      runtime/entitlements, notarization, staple, Gatekeeper, and clean lifecycle.
- [ ] **S6-PD03** Windows package, native modules, services, secret store,
      Runtimes, speech/capture, upgrade/uninstall, and cleanup pass natively.
- [ ] **S6-PD04** Linux package/distro/display, native modules, services, secret
      store fallback, Runtimes, speech/capture, upgrade/uninstall pass natively.
- [ ] **S6-PD05** Checksums, file/architecture manifest, dependencies/SBOM,
      secret/malware/security scans, documentation, and withdrawal recovery pass.

## Integrated release

- [ ] **S6-I01** Candidate ledger maps every required row to current exact-SHA evidence.
- [ ] **S6-I02** Clean install and Stage 5 upgrade/rollback preserve all supported
      data, identity, authority, history, and preferences.
- [ ] **S6-I03** One project exercises onboarding, shared personality/profile,
      mixed workflow/Reviewer child, bidirectional Codex/Claude delegation,
      child-Chat lineage, grid, visual context, mobile, usage,
      Obsidian knowledge graph/context round trip, restart, audit, and export
      with matching durable state.
- [ ] **S6-I04** Independent security/privacy, UI/accessibility/usability,
      performance, native-platform, artifact, package, and docs reviews pass.
- [ ] **S6-I05** Up to three review/fix rounds leave no P0/P1 or acceptance
      blocker and produce one exact-SHA handoff; remote release actions remain separately authorized.
