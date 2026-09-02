# S7: Daily Workspace Control

### S7-F1-T1: Add provider-account launch provenance and secret boundaries

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F1
- Outcome: One main-process account contract owns redacted identity, selection, auth mode, runtime target, and immutable run snapshots without exposing secrets to renderers.
- Scope: Additive schema/migrations; remove plaintext token-returning RPCs; account revision and run provenance; legacy interpretation.
- Start points: `src/main/lib/trpc/routers/anthropic-accounts.ts`, `codex.ts`, `claude-code.ts`; `src/main/lib/claude-token.ts`, usage providers, runtime launch adapters, and Drizzle migrations.
- Acceptance: Every launch path snapshots one valid account target; renderer APIs cannot return tokens; existing chats and credentials remain readable.
- Verification: Migration/reopen, router exposure, run-creation audit, secret-redaction tests, TypeScript, lint, strict OpenSpec.
- Blocked by: none
- Blocks: S7-F1-T2, S7-F1-T3, S7-F1-T4

### S7-F1-T2: Add isolated Codex accounts and hot-swap

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F1
- Outcome: Users add, label, select, reauthenticate, and remove subscription or API-key Codex accounts without rewriting the system-default login.
- Scope: Per-account `CODEX_HOME`; login/logout capture; system-default target; config mirroring; launch binding; cleanup journal.
- Start points: `src/main/lib/trpc/routers/anthropic-accounts.ts`, `codex.ts`, `claude-code.ts`; `src/main/lib/claude-token.ts`, usage providers, runtime launch adapters, and Drizzle migrations.
- Acceptance: New launches use the selected home; live sessions retain their original home; failed add/remove rolls back without credential loss.
- Verification: OAuth/API-key fixtures, home ownership, switch/restart/race/removal tests, one credentialed launch when available.
- Blocked by: S7-F1-T1
- Blocks: S7-F1-T4, S7-F7-T1

### S7-F1-T3: Complete Claude credential capture and refresh

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F1
- Outcome: Managed Claude accounts preserve full OAuth credentials and rotate refresh tokens safely before launch.
- Scope: Full credential capture; per-account isolated auth; serialized proactive refresh; atomic persistence; reauthentication rollback; API-key/custom modes.
- Start points: `src/main/lib/trpc/routers/anthropic-accounts.ts`, `codex.ts`, `claude-code.ts`; `src/main/lib/claude-token.ts`, usage providers, runtime launch adapters, and Drizzle migrations.
- Acceptance: Expiring tokens refresh once; rotated refresh tokens persist; transient failure keeps the last valid credential; corrupt/mismatched auth fails closed.
- Verification: Token rotation, expiry, concurrent launch, rollback, keychain/file, restart, and live subscription tests when available.
- Blocked by: S7-F1-T1
- Blocks: S7-F1-T4, S7-F7-T1

### S7-F1-T4: Bind usage and account UI to the selected target

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F1
- Outcome: Desktop and mobile show active and inactive account quota from the correct home while retaining Flapstack history, budgets, alerts, and organization data.
- Scope: Account-target resolver; cache identity; switcher/usage UI; mobile projection; stale/error states; API-vs-subscription labels.
- Start points: `src/main/lib/trpc/routers/anthropic-accounts.ts`, `codex.ts`, `claude-code.ts`; `src/main/lib/claude-token.ts`, usage providers, runtime launch adapters, and Drizzle migrations.
- Acceptance: Global CLI credentials cannot overwrite managed-account usage; account switches update launch and usage identity together; historical samples remain attributable.
- Verification: Multi-account fixtures, quota endpoint failures/429s, stale cache, mobile snapshot, rollup reconciliation, credentialed probe when available.
- Blocked by: S7-F1-T1, S7-F1-T2, S7-F1-T3
- Blocks: S7-F7-T1, S9-F3-T5

### S7-F2-T1: Add typed streamed workspace search

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F2
- Outcome: File and workspace discovery streams partial results, cancels superseded scans, and reports provider failures instead of false empty state.
- Scope: Shared search result/error/cancel contracts; `rg` and filesystem fallback; single-flight cache; limits and path safety.
- Start points: `src/main/lib/trpc/routers/search.ts`, filesystem helpers, renderer command/search surfaces, and shared result/cancellation types.
- Acceptance: Rapid queries cancel older work; unreadable roots are visible failures; symlink/large-tree bounds hold; no persistent index is introduced.
- Verification: Cancellation, error, symlink, ignore, large-tree benchmark, and resource-cleanup tests.
- Blocked by: none
- Blocks: S7-F2-T2

### S7-F2-T2: Build unified Quick Open

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F2
- Outcome: One keyboard-first dialog ranks files, Chats, projects, worktrees, settings, and commands and executes the selected native action.
- Scope: Provider composition; ranking; scopes/prefixes; recent items; accessibility; partial/failure UI; existing navigation commands.
- Start points: `src/main/lib/trpc/routers/search.ts`, filesystem helpers, renderer command/search surfaces, and shared result/cancellation types.
- Acceptance: Results retain type and context; keyboard and screen-reader paths are complete; one provider failure does not blank other results.
- Verification: Component/accessibility, ranking, action routing, cancellation, search discovery, and live workspace walkthrough.
- Blocked by: S7-F2-T1
- Blocks: S7-F7-T1

### S7-F3-T1: Add durable diff annotation contracts

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F3
- Outcome: Comments bind to file, side, line/range, body, scope, diff identity, and lifecycle state.
- Scope: Schema/migration; annotation service; stale/re-anchor/delete; permissions; audit; query and mobile DTOs.
- Start points: Git/diff services, diff renderer components, Chat turn creation, audit/undo services, mobile DTOs, and Drizzle migrations.
- Acceptance: Comments never silently move after diff changes; scope checks prevent cross-project access; deletion is reversible before send.
- Verification: Migration, identity drift, rename, re-anchor, undo, scope, restart, and redaction tests.
- Blocked by: none
- Blocks: S7-F3-T2

### S7-F3-T2: Add inline review and send-to-agent feedback

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F3
- Outcome: Users comment from desktop/mobile diff views and send selected feedback as one visible agent turn.
- Scope: Diff gutters/ranges; comment editor/list; stale UI; prompt serialization; send/retry/idempotency; history linkage.
- Start points: Git/diff services, diff renderer components, Chat turn creation, audit/undo services, mobile DTOs, and Drizzle migrations.
- Acceptance: Sending modifies no Git or files by itself; exactly one user turn is created; retry cannot duplicate feedback; source comments show sent state.
- Verification: UI/accessibility, serialization, exact-once, active-run queueing, stale diff, mobile, and provider fixture tests.
- Blocked by: S7-F3-T1
- Blocks: S7-F3-T3, S7-F7-T1, S9-F3-T4

### S7-F3-T3: Bound large and image diff review

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F3
- Outcome: Large text diffs and supported image changes remain reviewable without blocking the renderer, rebuilding the file tree during progressive loads, or losing navigation/comment identity.
- Scope: Stable combined-diff tree model; deferred file loading and section revalidation; virtualized tree/hunks; keyboard navigation; binary/image classification; side-by-side image preview; truncation disclosure; cancellation and memory limits.
- Start points: Git/diff services, diff renderer components, Chat turn creation, audit/undo services, mobile DTOs, and Drizzle migrations.
- Acceptance: Opening and progressively loading a large diff stays within the stage interaction budget; loading one section does not rebuild unaffected tree rows or lose selection; deferred files load on demand; image changes show exact before/after identity; comments cannot attach to unloaded or mismatched content.
- Verification: Large-file/diff fixtures, progressive-load render counts, tree filter/navigation/revalidation, image add/delete/change cases, cancellation, memory/CPU budgets, comment anchoring, accessibility, and package smoke.
- Blocked by: S7-F3-T2
- Blocks: S7-F7-T1, S9-F3-T4

### S7-F4-T1: Add compare-and-save file authority

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F4
- Outcome: Supported text files can be written through one permissioned, audited, reversible service with external-change protection.
- Scope: Content digest/version; write/rename/save-as; conflict DTO; atomic replace; undo journal; size/binary/path limits.
- Start points: `src/main/lib/trpc/routers/files.ts`, path-safety helpers, Monaco/Markdown renderer surfaces, attachment handling, audit/undo, and migrations.
- Acceptance: Stale writes never overwrite; path traversal/symlink escapes fail; failed writes preserve drafts and original files; undo restores the prior identity.
- Verification: Race, conflict, atomic failure, permission, symlink, encoding, size, undo, and restart tests.
- Blocked by: none
- Blocks: S7-F4-T2, S7-F4-T3

### S7-F4-T2: Add editable Monaco workspaces

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F4
- Outcome: Users edit source and plain-text files with autosave, explicit conflicts, external-change notices, and drag-to-prompt from existing workspace panes.
- Scope: Monaco editor state; autosave debounce; conflict review; dirty/readonly status; multi-window ownership; drag/drop; accessibility.
- Start points: `src/main/lib/trpc/routers/files.ts`, path-safety helpers, Monaco/Markdown renderer surfaces, attachment handling, audit/undo, and migrations.
- Acceptance: One file has one editable owner; drafts survive pane moves/reloads; conflicts never auto-resolve; read-only and permission-denied states are clear.
- Verification: Component, autosave, multi-window, drag, reload, conflict, accessibility, and live file walkthrough.
- Blocked by: S7-F4-T1
- Blocks: S7-F4-T4, S7-F7-T1, S9-F3-T4

### S7-F4-T3: Add a structured Markdown editor

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F4
- Outcome: Markdown documents can switch between source and structured editing while preserving tables, tasks, code, math, Mermaid, links, images, and unknown syntax.
- Scope: Structured editor adapter; Markdown round-trip contract; source toggle; paste/drop; attachment paths; unsupported-node fallback; conflict-safe save authority.
- Start points: `src/main/lib/trpc/routers/files.ts`, path-safety helpers, Monaco/Markdown renderer surfaces, attachment handling, audit/undo, and migrations.
- Acceptance: Opening and saving supported Markdown is lossless; unsupported constructs stay preserved in source; external edits trigger the same explicit conflict flow; active content never executes outside the preview sandbox.
- Verification: Round-trip corpus, tables/tasks/math/Mermaid/images, Unicode/frontmatter, malformed Markdown, conflicts, paste/drop, accessibility, and package smoke.
- Blocked by: S7-F4-T1
- Blocks: S7-F4-T4, S7-F7-T1

### S7-F4-T4: Add bounded rich repository previews

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F4
- Outcome: Markdown, images, PDFs, notebooks, HTML, and unsupported/large files render through safe bounded preview modes.
- Scope: Type detection; sandboxed previewers; size/page/cell limits; raw/download/open-external fallback; mobile-compatible summaries.
- Start points: `src/main/lib/trpc/routers/files.ts`, path-safety helpers, Monaco/Markdown renderer surfaces, attachment handling, audit/undo, and migrations.
- Acceptance: Active content cannot escape the preview sandbox; large/unsupported content degrades visibly; preview never grants write authority.
- Verification: Malformed/large fixtures, CSP/sandbox, PDF pages, notebook cells, image limits, accessibility, and package smoke.
- Blocked by: S7-F4-T2, S7-F4-T3
- Blocks: S7-F7-T1

### S7-F5-T1: Add durable terminal journals and attach protocol

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F5
- Outcome: PTYs outlive renderer loss and expose bounded snapshot-plus-stream attachment with acknowledgement and backpressure.
- Scope: Terminal owner service; xterm serialization; row/byte/age retention; sequence/ack; park/resume; garbage collection.
- Start points: `src/main/lib/trpc/routers/terminal.ts`, `src/main/lib/terminal/`, renderer terminal/xterm components, saved-workspace layout, and mobile terminal DTOs.
- Acceptance: Reattach yields one consistent state; slow renderers stay bounded; secrets are not separately indexed; GC never kills active PTYs.
- Verification: Detach/reattach, output flood, ack gap, cold park, GC, crash, and memory/CPU budget tests.
- Blocked by: none
- Blocks: S7-F5-T2

### S7-F5-T2: Restore terminal sessions across app restart

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F5
- Outcome: Restarted Flapstack reattaches owned PTYs when verifiable and shows explicit exited/unverifiable recovery otherwise.
- Scope: Daemon ownership; persisted handles; process evidence; restart reconciliation; resize/input routing; stale cleanup.
- Start points: `src/main/lib/trpc/routers/terminal.ts`, `src/main/lib/terminal/`, renderer terminal/xterm components, saved-workspace layout, and mobile terminal DTOs.
- Acceptance: Flapstack never adopts an unrelated process; missing PTYs are not shown live; input reaches only the verified owner; recovery is idempotent.
- Verification: App/daemon restart, PID reuse, crash races, resize/input, stale handle, OS-specific process evidence, and packaged smoke.
- Blocked by: S7-F5-T1
- Blocks: S7-F5-T3, S7-F7-T1, S8-F4-T1, S9-F1-T3

### S7-F5-T3: Add nested terminal splits within the workbench

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F5
- Outcome: Terminal panes split, resize, move, close, and restore without increasing the four-visible-Chat limit.
- Scope: Terminal-only split tree; commands/drag; focus; responsive collapse; layout persistence; inactive-pane parking.
- Start points: `src/main/lib/trpc/routers/terminal.ts`, `src/main/lib/terminal/`, renderer terminal/xterm components, saved-workspace layout, and mobile terminal DTOs.
- Acceptance: Chat group count remains capped; terminal resource budgets remain enforced; layout and focus restore; keyboard/touch/screen-reader paths work.
- Verification: Reducer/property, drag, resize, restore, responsive, accessibility, resource, and multi-window tests.
- Blocked by: S7-F5-T2
- Blocks: S7-F5-T4, S7-F7-T1

### S7-F5-T4: Add terminal quick commands and launch profiles

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F5
- Outcome: Users define and invoke bounded terminal commands and launch profiles from keyboard, pointer, and touch without bypassing shell or permission rules.
- Scope: Command/profile schema; workspace/global scopes; argument and environment templates; recent/favorite actions; shell preview; import/export; mobile projection.
- Start points: `src/main/lib/trpc/routers/terminal.ts`, `src/main/lib/terminal/`, renderer terminal/xterm components, saved-workspace layout, and mobile terminal DTOs.
- Acceptance: Commands show the exact shell, cwd, host, and expanded arguments before execution; secrets remain references; invalid profiles fail without spawning; existing terminal themes, search, WebGL fallback, IME, and paste behavior remain intact.
- Verification: Schema/migration, expansion/escaping, secret redaction, local/remote target, invalid profile, accessibility, mobile projection, IME/paste, and package tests.
- Blocked by: S7-F5-T3
- Blocks: S7-F7-T1

### S7-F5-T5: Add agent-aware sleep prevention

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F5
- Outcome: Users choose Off, Automatic, or On sleep prevention and see whether Flapstack is currently keeping the system awake for active owned work.
- Scope: Cross-platform power assertion service; macOS `caffeinate` path with Electron fallback; Windows/Linux blocker behavior; automatic active-run/PTY policy; status control; sleep/wake recovery; shutdown cleanup.
- Start points: `src/main/index.ts`, run/terminal activity projections, Electron `powerMonitor`/`powerSaveBlocker`, platform helpers, status/settings UI, and package lifecycle tests.
- Acceptance: Automatic mode asserts only for qualifying owned work; Off releases every assertion; failures remain visible and bounded; app crash/quit cannot intentionally leave an orphan assertion; display sleep is not blocked unless explicitly required.
- Verification: Mode/state reducer, concurrent runs, sleep/wake, assertion failure/recovery, macOS helper exit, Windows/Linux fallback, app quit/crash, status accessibility, and packaged smoke.
- Blocked by: none
- Blocks: S7-F7-T1

### S7-F6-T1: Add sparse-checkout presets

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F6
- Outcome: Users create and update named sparse-checkout presets with an exact preview of included and excluded repository paths.
- Scope: Cone/non-cone capability detection; preset schema; dry-run preview; worktree binding; dirty-file safeguards; undo journal; unsupported-repository state.
- Start points: `src/main/lib/git/worktree.ts`, Chat/worktree cleanup paths, filesystem path-safety and trash helpers, saved-workspace metadata, audit/undo, and migrations.
- Acceptance: Applying a preset never discards dirty or untracked files silently; unsupported Git versions fail visibly; rollback restores the prior sparse configuration; presets remain scoped to the intended worktree.
- Verification: Cone/non-cone fixtures, dirty/untracked files, submodules, path escaping, apply/rollback fault windows, restart, and Git-version tests.
- Blocked by: none
- Blocks: S7-F7-T1

### S7-F6-T2: Add workspace cleanup inventory

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F6
- Outcome: Users see stale Chats, worktrees, branches, terminals, artifacts, caches, and remote-host state with freshness and exact ownership evidence before cleanup.
- Scope: Read-only candidate scanner; lifecycle and Git facets; host identity; size/age estimates; active-owner exclusion; cancellation; stale-while-revalidate UI.
- Start points: `src/main/lib/git/worktree.ts`, Chat/worktree cleanup paths, filesystem path-safety and trash helpers, saved-workspace metadata, audit/undo, and migrations.
- Acceptance: Active or unverifiable resources are never presented as safe deletion candidates; every row shows target, owner, evidence freshness, and consequence; scanning performs no mutations.
- Verification: Active/inactive fixtures, stale evidence, nested paths, multiple hosts, cancellation, large inventory, accessibility, and zero-mutation audit.
- Blocked by: none
- Blocks: S7-F6-T3

### S7-F6-T3: Add verified reversible workspace cleanup

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F6
- Outcome: Users remove only selected verified resources through staged cleanup with confirmation, recovery, and truthful partial results.
- Scope: Revalidation; dependency ordering; trash/quarantine where possible; Git worktree/branch rules; terminal/artifact/cache cleanup; retry journal; undo or explicit irreversible boundary.
- Start points: `src/main/lib/git/worktree.ts`, Chat/worktree cleanup paths, filesystem path-safety and trash helpers, saved-workspace metadata, audit/undo, and migrations.
- Acceptance: Cleanup revalidates every target immediately before mutation; ancestor/descendant selections cannot broaden deletion; failures preserve remaining resources and a retryable journal; irreversible Git effects require separate confirmation.
- Verification: Identity races, symlink swaps, nested targets, partial failure, process ownership, remote disconnect, trash/restore, retry/restart, permission, and audit tests.
- Blocked by: S7-F6-T2
- Blocks: S7-F7-T1

### S7-F7-T1: Close integrated Stage 7 acceptance

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S7 / Feature S7-F7
- Outcome: Account switching, usage, Quick Open, review comments, editing/previews, durable terminals, sparse checkout, and workspace cleanup work together on one exact candidate.
- Scope: Integrated matrix; migrations; security/privacy; performance; desktop/mobile compatibility; rollback; destructive-action recovery; package smoke; owner-test backlog.
- Start points: Stage 7 feature tests, package scripts, acceptance matrix, owner-testing backlog, and exact-candidate evidence.
- Acceptance: No P0/P1 or T2-core blocker; legacy/system-default auth remains usable; no data loss; all feature limits and deferred capabilities are explicit.
- Verification: `npm run check`, strict OpenSpec when tooling is available, focused integration/e2e, verified app path, preview package inspection/smoke.
- Blocked by: S7-F1-T2, S7-F1-T3, S7-F1-T4, S7-F2-T2, S7-F3-T2, S7-F3-T3, S7-F4-T2, S7-F4-T3, S7-F4-T4, S7-F5-T2, S7-F5-T3, S7-F5-T4, S7-F5-T5, S7-F6-T1, S7-F6-T3
- Blocks: S8-F1-T1, S8-F2-T1, S8-F3-T1, S8-F4-T1, S9-F1-T1
