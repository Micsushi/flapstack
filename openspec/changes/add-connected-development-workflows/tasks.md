# S8: Connected Development Workflows

### S8-F1-T1: Define provider, credential, and rate-limit contracts

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F1
- Outcome: Forge/task adapters share bounded identity, pagination, rate-limit, error, and secret contracts without flattening provider-specific fields.
- Scope: DTOs; adapter registry; credential references; cache/freshness; capability negotiation; fixtures.
- Start points: Existing GitHub/Git/worktree helpers, provider-extension contracts, new forge/task adapters, hosted-review UI, credential service, mobile DTOs, and migrations.
- Acceptance: Secrets stay main-only; unsupported actions are absent; partial/rate-limited state is visible; adapter failures isolate by provider.
- Verification: Contract, credential exposure, pagination, 401/403/429, stale cache, schema drift, and registry tests.
- Blocked by: S7-F7-T1
- Blocks: S8-F1-T2, S8-F1-T3, S8-F1-T4, S8-F1-T5

### S8-F1-T2: Add GitHub and GitLab issue/review adapters

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F1
- Outcome: Users browse issues, PRs/MRs, reviews, checks, branches, and comments from GitHub and GitLab.
- Scope: Auth/probe; list/search/detail; checks/review/comments; existing GitHub helper migration; GitLab adapter; refresh/backoff.
- Start points: Existing GitHub/Git/worktree helpers, provider-extension contracts, new forge/task adapters, hosted-review UI, credential service, mobile DTOs, and migrations.
- Acceptance: Existing clone/PR behavior remains; provider IDs round-trip; writes preview exact target; no implicit merge/push occurs.
- Verification: Fixtures, CLI/API parity, pagination, auth/rate limits, review writes, live low-risk account tests when available.
- Blocked by: S8-F1-T1
- Blocks: S8-F1-T4, S8-F1-T6, S8-F6-T1

### S8-F1-T3: Add Linear and Jira task adapters

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F1
- Outcome: Users browse assigned/project tasks and carry source identity into local worktrees and Chats.
- Scope: OAuth/token auth; teams/projects; search/detail; comments/status updates; pagination; provider links.
- Start points: Existing GitHub/Git/worktree helpers, provider-extension contracts, new forge/task adapters, hosted-review UI, credential service, mobile DTOs, and migrations.
- Acceptance: Missing scopes disable writes only; task updates show exact transition; no task is changed by merely opening local work.
- Verification: Scope, pagination, rate-limit, stale transition, duplicate, fixture, and credentialed low-risk tests when available.
- Blocked by: S8-F1-T1
- Blocks: S8-F1-T4, S8-F6-T1

### S8-F1-T4: Build task-to-worktree and review workspace flows

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F1
- Outcome: A provider item creates or opens exactly one linked worktree/Chat and PR review stays in the existing workbench.
- Scope: Unified provider browser; branch/worktree preview; idempotency; links; diff comments; checks; mobile projection.
- Start points: Existing GitHub/Git/worktree helpers, provider-extension contracts, new forge/task adapters, hosted-review UI, credential service, mobile DTOs, and migrations.
- Acceptance: Duplicate clicks do not duplicate work; collisions are resolved before Git mutation; provider links survive restart; destructive review actions remain explicit.
- Verification: UI/accessibility, idempotency, branch collision, restart, diff-comment integration, mobile, and end-to-end provider fixture tests.
- Blocked by: S8-F1-T1, S8-F1-T2, S8-F1-T3, S8-F1-T5
- Blocks: S8-F1-T6, S8-F6-T1, S9-F3-T4

### S8-F1-T5: Add Azure DevOps, Bitbucket, and Gitea adapters

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F1
- Outcome: Users browse and act on Azure DevOps, Bitbucket, and Gitea repositories, issues, and hosted reviews through the shared provider contract.
- Scope: Provider discovery; credential references; pagination; rate limits; repository mapping; issue and PR/MR reads/writes; capability gaps; self-hosted base URLs.
- Start points: Existing GitHub/Git/worktree helpers, provider-extension contracts, new forge/task adapters, hosted-review UI, credential service, mobile DTOs, and migrations.
- Acceptance: Each provider exposes only advertised capabilities; credentials stay provider/host scoped; unsupported fields remain visible rather than dropped; retries cannot duplicate mutations.
- Verification: Contract fixtures for all three providers, pagination/rate-limit/auth failures, self-hosted URLs, idempotent writes, redaction, and credentialed smoke when available.
- Blocked by: S8-F1-T1
- Blocks: S8-F1-T4, S8-F1-T6, S8-F6-T1

### S8-F1-T6: Complete hosted review lifecycle controls

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F1
- Outcome: Users create, link, inspect, comment on, review, update, merge, and unlink hosted reviews with checks, reviewers, conflicts, and auto-merge state shown truthfully.
- Scope: PR/MR creation and linking; checks/log detail; comments/replies; reviewers; conflict files; draft/ready; merge strategies; auto-merge; remote/base/head identity; mobile DTOs.
- Start points: Existing GitHub/Git/worktree helpers, provider-extension contracts, new forge/task adapters, hosted-review UI, credential service, mobile DTOs, and migrations.
- Acceptance: Every mutation previews provider, repository, base/head, and effect; stale review state is revalidated; merge/push remain separately permissioned; retries are idempotent; unsupported provider actions are absent.
- Verification: GitHub/GitLab/Azure DevOps/Bitbucket/Gitea fixtures, review identity drift, checks, comments, reviewers, conflicts, auto-merge, permissions, mobile projection, and credentialed smoke when available.
- Blocked by: S8-F1-T2, S8-F1-T4, S8-F1-T5
- Blocks: S8-F6-T1, S9-F3-T4

### S8-F2-T1: Add managed Chromium profiles and tabs

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F2
- Outcome: Browser panes use isolated managed Chromium tabs with durable profile/tab identity and bounded lifecycle.
- Scope: BrowserView/WebContents service; profiles; navigation; permissions; downloads; certificates; popup/scheme policy; restore.
- Start points: New main-process browser profile/tab service, Electron webContents/BrowserView boundaries, visual-capture pipeline, renderer browser panes, and package permissions.
- Acceptance: Browser content cannot access Node/Flapstack secrets; unsafe schemes/popups fail; closing profile/tab releases resources; saved bindings restore truthfully.
- Verification: Navigation/CSP/permission/download/certificate, crash/reload, restore, resource, and package tests.
- Blocked by: S7-F7-T1
- Blocks: S8-F2-T2, S8-F2-T3, S8-F2-T4

### S8-F2-T2: Add Design Mode selection and visual attachments

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F2
- Outcome: Users select a rendered element and attach bounded DOM/CSS/geometry/screenshot evidence to a prompt.
- Scope: CDP hit testing; overlay; selector/context bounds; cropped capture; stale identity; attachment provenance; responsive viewport.
- Start points: New main-process browser profile/tab service, Electron webContents/BrowserView boundaries, visual-capture pipeline, renderer browser panes, and package permissions.
- Acceptance: Capture matches the highlighted element/current frame; secrets and oversized DOM are redacted/bounded; stale selection never captures another target.
- Verification: Dynamic DOM, iframes/shadow DOM limits, responsive viewport, redaction, stale frame, image bounds, and UI accessibility tests.
- Blocked by: S8-F2-T1
- Blocks: S8-F2-T3, S8-F6-T1, S9-F3-T4

### S8-F2-T3: Expose browser tools through agent authority

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F2
- Outcome: Approved agents inspect and operate managed browser tabs through bounded tools with current-tab evidence.
- Scope: Snapshot/open/navigate/click/fill/screenshot tools; tab targeting; permissions; audit; cancellation; sensitive-field policy.
- Start points: New main-process browser profile/tab service, Electron webContents/BrowserView boundaries, visual-capture pipeline, renderer browser panes, and package permissions.
- Acceptance: Tools cannot target arbitrary external profiles; stale element references fail; password/payment fields require stronger approval; stop/cancel is immediate.
- Verification: Target/stale refs, sensitive fields, permission modes, cancellation, audit/redaction, multi-tab, and real managed-browser tests.
- Blocked by: S8-F2-T1, S8-F2-T2, S8-F2-T4
- Blocks: S8-F3-T3, S8-F5-T1, S8-F6-T1

### S8-F2-T4: Add isolated browser identity and network controls

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F2
- Outcome: Users configure bounded user-agent, proxy, cookie/storage, WebAuthn, credential, HTTP-auth, and download behavior per managed browser profile.
- Scope: Per-profile user agent and proxy; cookie/storage inspect, set, clear, and disclosed import; WebAuthn identities; OS-protected credential references; HTTP authentication; download inventory, reveal, and verified removal.
- Start points: Main-process browser profile/tab service, Electron session/proxy/download/WebAuthn APIs, OS credential storage, browser settings, operator CLI, and audit/redaction services.
- Acceptance: Every import or identity change previews the target profile and data classes; credentials remain references; state never crosses profile boundaries; downloads use safe names and owned roots; unsupported platform controls are absent.
- Verification: Cookie/storage import and clearing, WebAuthn, HTTP authentication, proxy/user-agent, download traversal/collision/quarantine, cross-profile isolation, restart, redaction, CLI, and package tests.
- Blocked by: S8-F2-T1
- Blocks: S8-F2-T3, S8-F6-T1

### S8-F3-T1: Add authenticated local CLI transport

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F3
- Outcome: The installed `flapstack` command discovers and authenticates to the running app and receives typed streaming results.
- Scope: Endpoint discovery; local authentication; request/version contract; streaming/cancel; JSON and human output; no-app behavior.
- Start points: New `src/cli/` entrypoint and schemas, local authenticated transport, existing tRPC/product services, app-control/orchestration services, and packaging bin configuration.
- Acceptance: Another user/process cannot reuse trust material; state-changing commands never open SQLite directly; version mismatch is actionable.
- Verification: Auth/replay/permissions, no-app, mixed-version, stream/cancel, output/redaction, macOS/Windows/Linux launcher tests.
- Blocked by: S7-F7-T1
- Blocks: S8-F3-T2

### S8-F3-T2: Add worktree, Chat, terminal, automation, and skill commands

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F3
- Outcome: Scripts and agents invoke existing product workflows through stable CLI commands and machine-readable results.
- Scope: List/show/open/create/steer/cancel; worktree; terminal; automation; skill; snapshot; completion/help; idempotency and approvals.
- Start points: New `src/cli/` entrypoint and schemas, local authenticated transport, existing tRPC/product services, app-control/orchestration services, and packaging bin configuration.
- Acceptance: CLI and UI produce the same authority/audit result; destructive commands preview/confirm or require explicit noninteractive flags; retries are idempotent.
- Verification: Command contract, help/completion, exact-once, approval, cancellation, restart, and end-to-end local app tests.
- Blocked by: S8-F3-T1
- Blocks: S8-F3-T3, S8-F3-T4, S8-F6-T1, S9-F1-T2

### S8-F3-T3: Add complete operator resource commands

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F3
- Outcome: Scripts can inspect and operate files, artifacts, accounts, diagnostics, browser tabs, Computer Use, and server state through authenticated production services.
- Scope: File read/write with identity; artifact list/export; account redacted status/switch; diagnostics; browser profile/tab/navigation/capture; Computer Use state/action/stop; `serve`; JSON output and exit codes.
- Start points: New `src/cli/` entrypoint and schemas, local authenticated transport, existing tRPC/product services, app-control/orchestration services, and packaging bin configuration.
- Acceptance: CLI commands expose no secret material; mutations reuse permission, preview, audit, and undo contracts; capability-unavailable errors are stable; interactive login can be interrupted safely.
- Verification: Command/parser fixtures, JSON schemas, secret scans, file conflicts, browser/computer authority, interrupted login, diagnostics, server lifecycle, and packaged binary smoke.
- Blocked by: S8-F2-T3, S8-F3-T2, S8-F5-T1
- Blocks: S8-F3-T5, S8-F6-T1, S10-F2-T2

### S8-F3-T4: Add orchestration worker, inbox, and gate commands

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F3
- Outcome: Scripts and agents can create, observe, message, gate, wait for, and settle Flapstack orchestration workers without bypassing the existing coordination engine.
- Scope: Worker launch/show/wait; task dependencies; inbox send/check; questions; mutation requests; keepalive; timeouts; structured receipts; compatibility negotiation.
- Start points: New `src/cli/` entrypoint and schemas, local authenticated transport, existing tRPC/product services, app-control/orchestration services, and packaging bin configuration.
- Acceptance: Every command binds to one project/run identity; dependency cycles and invalid message types fail before dispatch; waiting is cancellable; retries cannot duplicate tasks/messages/mutations.
- Verification: CLI contract fixtures, dependency/cycle checks, concurrent workers, cancellation/timeouts, message exact-once, gate denial, compatibility, and packaged binary smoke.
- Blocked by: S8-F3-T2
- Blocks: S8-F3-T5, S8-F6-T1

### S8-F3-T5: Ship bundled operator skill guides

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F3
- Outcome: Installed Flapstack exposes version-matched skills and concise guides for the operator CLI, orchestration, browser, and Computer Use so agents can discover safe commands and limits.
- Scope: Bundled skill manifests; generated guides/stubs; CLI discovery; version compatibility; command/schema links; safety boundaries; package verification; update/removal ownership.
- Start points: Existing skill/plugin services, new operator CLI schemas, browser/computer/orchestration contracts, package resource manifest, and skill discovery paths.
- Acceptance: Guides are generated from current schemas or fail CI when stale; installed files carry version/source identity; Computer Use and mutations retain explicit permission warnings; packaging never overwrites modified user skills silently.
- Verification: Manifest generation/check, schema drift, install/update/remove ownership, modified-file conflict, CLI discovery, package content audit, and agent-readable smoke.
- Blocked by: S8-F3-T3, S8-F3-T4
- Blocks: S8-F6-T1

### S8-F4-T1: Add the generic TUI runtime contract

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F4
- Outcome: A configured terminal CLI can launch as a lower-fidelity agent with explicit command/env/cwd and capability declarations.
- Scope: Runtime type; preset/custom definitions; environment/secret references; durable terminal binding; status hook interface; permission warnings.
- Start points: `src/main/lib/agent-runtime/`, provider adapters/extensions, terminal authority, account/usage services, renderer runtime settings, and mobile runtime projections.
- Acceptance: Structured runtimes remain preferred; custom command values are validated; secrets are references; unsupported capabilities never appear enabled.
- Verification: Resolver, command/env validation, secret redaction, compatibility, missing binary, exit/cancel/restart, and migration tests.
- Blocked by: S7-F5-T2, S7-F7-T1
- Blocks: S8-F4-T2, S8-F4-T3, S8-F4-T4

### S8-F4-T2: Add generic agent presets and terminal supervision

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F4
- Outcome: Users launch common CLI agents or a custom preset, see truthful process state, and steer through terminal input.
- Scope: Preset catalog; setup/probe; picker/settings; terminal attach; optional hook adapters; limitations; mobile projection.
- Start points: `src/main/lib/agent-runtime/`, provider adapters/extensions, terminal authority, account/usage services, renderer runtime settings, and mobile runtime projections.
- Acceptance: No preset silently adds bypass flags; global permission choice is respected where expressible; terminal-only agents are labeled as such.
- Verification: Preset fixtures, manual/yolo args, probe/setup, terminal attach, status hook, mobile, and low-risk live CLI tests when installed.
- Blocked by: S8-F4-T1
- Blocks: S8-F4-T3, S8-F4-T4, S8-F6-T1

### S8-F4-T3: Ship the named CLI-agent preset catalog

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F4
- Outcome: Every CLI agent advertised by current Orca can be configured and launched through a versioned Flapstack preset or the generic custom-agent form.
- Scope: Presets for Claude, Codex, Grok, Cursor, Copilot, OpenCode, MiMo, Amp, OpenClaude, Antigravity, Pi, oh-my-pi, Hermes, Devin, Goose, Auggie, Autohand, Crush, Cline, Codebuff, Command Code, Continue, Droid, Kilocode, Kimi, Kiro, Mistral Vibe, Qwen Code, and Rovo Dev; install probes; flags; resume hints; capability labels.
- Start points: `src/main/lib/agent-runtime/`, provider adapters/extensions, terminal authority, account/usage services, renderer runtime settings, and mobile runtime projections.
- Acceptance: Missing binaries fail with exact setup guidance; preset launches preserve user flags and environment references; unsupported structured capabilities are visibly absent; custom presets survive upgrades.
- Verification: Manifest/schema tests, one fixture per preset, path/version probes on supported OSes, flags/escaping, custom preset migration, and selected live CLI smokes when available.
- Blocked by: S8-F4-T1, S8-F4-T2
- Blocks: S8-F6-T1

### S8-F4-T4: Add provider-specific hook, status, account, and usage adapters

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F4
- Outcome: Agents with stable integration points expose accurate running/waiting/completed status, resume identity, account state, approvals, and usage beyond generic terminal inference.
- Scope: Orca-parity adapters for Grok, Copilot, Gemini, Amp, Antigravity, Command Code, Devin, Droid, Hermes, Kimi, MiMo, MiniMax, OpenClaude, Pi/oh-my-pi, and supported OpenCode usage; versioned hooks and fallback.
- Start points: `src/main/lib/agent-runtime/`, provider adapters/extensions, terminal authority, account/usage services, renderer runtime settings, and mobile runtime projections.
- Acceptance: An adapter activates only for verified compatible versions; hook failure degrades to the labeled generic runtime; account and usage data stay target-scoped; stale hooks cannot keep a run falsely active.
- Verification: Transcript/hook fixtures per adapter, version mismatch, status settlement, resume, approval, account/usage redaction, fallback, concurrency, and selected live smokes when available.
- Blocked by: S8-F4-T1, S8-F4-T2
- Blocks: S8-F6-T1, S9-F3-T5

### S8-F5-T1: Add controlled visible Computer Use

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F5
- Outcome: Users explicitly authorize agents to inspect and operate a visible app/window with current target evidence, audit, and stop control.
- Scope: Target picker; screenshots/accessibility snapshot; click/type/scroll; preview identity; permission/step-up; sensitive targets; stop; audit; undo classification.
- Start points: Existing visual capture and permission/audit services, new platform computer-control helpers, renderer consent/stop UI, and package entitlements.
- Acceptance: No background/hidden target control; target changes invalidate approval; secrets are redacted; external irreversible effects are warned and never claimed undoable.
- Verification: Permission/step-up, stale target, screen lock, sensitive fields, stop/cancel, audit, accessibility, and real controlled-app smoke.
- Blocked by: S8-F2-T3
- Blocks: S8-F3-T3, S8-F6-T1

### S8-F6-T1: Close integrated Stage 8 acceptance

- [ ] Completion: Tier 2 acceptance passed
- Parent: Project Flapstack / Stage S8 / Feature S8-F6
- Outcome: Provider intake, browser/Design Mode, CLI, generic agents, and Computer Use interoperate through one authority model.
- Scope: Integrated matrix; security/privacy; permissions/undo/audit; provider/browser/CLI/runtime failures; performance; package smoke; owner backlog.
- Start points: Stage 8 provider/browser/CLI/runtime/computer integration suites, acceptance matrix, package smoke, and owner-testing backlog.
- Acceptance: No alternate state authority or secret path; provider and UI mutations are exact and reversible where promised; no P0/P1 or T2-core blocker.
- Verification: `npm run check`, strict OpenSpec when available, integrated e2e, verified app/browser/CLI paths, preview package inspection/smoke.
- Blocked by: S8-F1-T2, S8-F1-T3, S8-F1-T4, S8-F1-T5, S8-F1-T6, S8-F2-T2, S8-F2-T3, S8-F2-T4, S8-F3-T2, S8-F3-T3, S8-F3-T4, S8-F3-T5, S8-F4-T2, S8-F4-T3, S8-F4-T4, S8-F5-T1
- Blocks: S9-F1-T1
