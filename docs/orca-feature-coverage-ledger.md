# Orca feature coverage ledger

Audit baseline: Orca upstream `45c4823109bbd57f926f8b0c8bd843aa3d34818f`
on 2026-08-31.

This ledger classifies current user-facing feature families from Orca's README,
desktop component/service trees, CLI specs, mobile routes, and remote/relay
documentation. Internal refactors, fixtures, benchmarks, and one-off bug fixes
are implementation evidence, not separate product features.

Disposition meanings:

- Existing: Flapstack already has the material product behavior.
- Improve: keep Flapstack authority and add the named Orca behavior.
- Add: new Flapstack capability with an owning task.
- Exclude: reviewed and intentionally not part of the product plan.

## Agent and account workflows

| Orca family                                                                                                                                      | Disposition | Flapstack owner                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | --------------------------------------- |
| Claude/Codex structured Chats and native transcripts                                                                                             | Existing    | Current runtime/Chat services           |
| Parallel agents and Git worktrees                                                                                                                | Existing    | Current worktree/orchestration services |
| Agent activity, unread state, history, continuation, and resume                                                                                  | Existing    | Current Chat/run/history services       |
| Claude and Codex subscription/API account switching                                                                                              | Improve     | S7-F1-T1 through S7-F1-T4               |
| Grok, Copilot, Gemini, Amp, Antigravity, Command Code, Devin, Droid, Hermes, Kimi, MiMo, MiniMax, OpenClaude, Pi/oh-my-pi, and OpenCode adapters | Add         | S8-F4-T4                                |
| Every advertised terminal CLI-agent preset plus custom agents                                                                                    | Add         | S8-F4-T1 through S8-F4-T3               |
| Agent hooks and truthful status settlement                                                                                                       | Improve     | S8-F4-T1, S8-F4-T2, S8-F4-T4            |
| Agent profiles/personas                                                                                                                          | Existing    | Current Agent Profile services          |
| Provider usage, rate limits, resets, stats, and budgets                                                                                          | Improve     | S7-F1-T4 plus current usage database    |

## Workspace, files, review, and terminal

| Orca family                                                                                    | Disposition | Flapstack owner                                 |
| ---------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------- |
| Dashboard, project groups, workspace names/colors, saved layouts, and pane popouts             | Existing    | Current project/saved-workspace/window services |
| Unified Quick Open and command palette                                                         | Add         | S7-F2-T1 through S7-F2-T2                       |
| Editable source files, autosave, conflicts, and drag-to-prompt                                 | Improve     | S7-F4-T1 through S7-F4-T2                       |
| Structured/source Markdown editor                                                              | Add         | S7-F4-T3                                        |
| Markdown, image, PDF, notebook, HTML, and large-file previews                                  | Improve     | S7-F4-T4                                        |
| Inline diff comments sent to an agent                                                          | Add         | S7-F3-T1 through S7-F3-T2                       |
| Deferred large/image diffs plus stable progressive tree and navigation                         | Add/Improve | S7-F3-T3                                        |
| Source control, staging, commit, branch, and worktree basics                                   | Existing    | Current Git/worktree services                   |
| Hosted review creation, linking, checks, comments, reviewers, conflicts, merge, and auto-merge | Improve     | S8-F1-T4, S8-F1-T6                              |
| Sparse-checkout presets                                                                        | Add         | S7-F6-T1                                        |
| Workspace cleanup inventory and verified removal                                               | Add         | S7-F6-T2 through S7-F6-T3                       |
| Terminal WebGL fallback, themes, links, search, IME, and large paste                           | Existing    | Current xterm terminal surface                  |
| Restart-persistent PTYs, bounded serialized state, cold parking, and nested splits             | Improve     | S7-F5-T1 through S7-F5-T3                       |
| Terminal quick commands and launch profiles                                                    | Add         | S7-F5-T4                                        |
| Agent-aware Off/Automatic/On sleep prevention                                                  | Add         | S7-F5-T5                                        |

## Providers, browser, automation, and operator control

| Orca family                                                                                                                                  | Disposition | Flapstack owner                   |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------- |
| GitHub repository and basic PR actions                                                                                                       | Existing    | Current GitHub/Git services       |
| GitLab, Linear, and Jira workflows                                                                                                           | Add         | S8-F1-T1 through S8-F1-T4         |
| Azure DevOps, Bitbucket, and Gitea workflows                                                                                                 | Add         | S8-F1-T5                          |
| Embedded Chromium profiles and tabs                                                                                                          | Add         | S8-F2-T1                          |
| Browser user-agent, proxy, cookies/storage, WebAuthn, credentials, HTTP auth, and downloads                                                  | Add         | S8-F2-T4                          |
| Design Mode DOM/CSS/screenshot capture                                                                                                       | Add         | S8-F2-T2                          |
| Agent browser tools                                                                                                                          | Add         | S8-F2-T3                          |
| Visible Computer Use                                                                                                                         | Add         | S8-F5-T1                          |
| Automations                                                                                                                                  | Existing    | Current automation services       |
| Plugins, MCP, skills, and skill management                                                                                                   | Existing    | Current plugin/skill/MCP services |
| Full operator CLI for worktrees, Chats, terminals, automation, skills, files, artifacts, accounts, browser, computer, diagnostics, and serve | Add         | S8-F3-T1 through S8-F3-T3         |
| CLI orchestration workers, dependencies, inbox, questions, and gates                                                                         | Add         | S8-F3-T4                          |
| Bundled operator/browser/computer/orchestration skill guides                                                                                 | Add         | S8-F3-T5                          |

## Remote, mobile, and platform

| Orca family                                                                                                 | Disposition | Flapstack owner                          |
| ----------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------- |
| Cross-platform desktop menus, dock state, windows, and packages                                             | Existing    | Current platform/window/release services |
| System tray continuity                                                                                      | Add         | S10-F5-T3                                |
| Headless execution service                                                                                  | Add         | S9-F1-T1 through S9-F1-T4                |
| SSH workspaces, remote PTYs, reconnect, and ports                                                           | Add         | S9-F2-T1 through S9-F2-T3                |
| WSL execution and provider-home parity                                                                      | Add         | S9-F4-T1                                 |
| Recipe-driven ephemeral VM runtime, provisioning, resume, emulator, and cleanup                             | Add         | S9-F7-T1 through S9-F7-T4                |
| Optional encrypted relay and regional placement                                                             | Add         | S9-F6-T1 through S9-F6-T4                |
| Secure PWA pairing, grants, revocation, and stale read-only state                                           | Existing    | Current mobile-control services          |
| Native Expo iOS/Android client                                                                              | Add         | S9-F3-T1 through S9-F3-T7                |
| Native host, workspace, Chat, terminal, files, diff, Git, PR, browser, tasks, accounts, usage, and settings | Add         | S9-F3-T2 through S9-F3-T5                |
| Native dictation, notifications, accessibility, and diagnostics                                             | Add         | S9-F3-T6                                 |
| Desktop mobile emulator pane                                                                                | Add         | S9-F3-T7                                 |
| Mobile protocol skew, offline recovery, Android/iOS builds and release paths                                | Add         | S9-F5-T1 through S9-F5-T2                |

## Knowledge, sharing, distribution, and support

| Orca family                                                              | Disposition | Flapstack owner                              |
| ------------------------------------------------------------------------ | ----------- | -------------------------------------------- |
| AI/project vault and knowledge graph                                     | Existing    | Current project-vault and knowledge services |
| Chat attachments and task artifacts                                      | Existing    | Current attachment/artifact services         |
| Versioned cross-host skill install/update/rollback/removal               | Add         | S10-F1-T1 through S10-F1-T2                  |
| Revocable unlisted skill share links                                     | Add         | S10-F1-T3                                    |
| Revocable artifact publishing links                                      | Add         | S10-F2-T1 through S10-F2-T2                  |
| Desktop speech, dictation, playback, and voice history                   | Existing    | Current speech/voice services                |
| Consent-gated analytics                                                  | Existing    | Current main-process analytics service       |
| Crash survival and redacted local support bundles                        | Add         | S10-F5-T1                                    |
| Separately consented crash/support upload                                | Add         | S10-F5-T2                                    |
| Localization catalogs and six initial language packs                     | Add         | S10-F3-T1 through S10-F3-T2                  |
| Signed preview/stable updater, staged rollout, health gate, and rollback | Add         | S10-F4-T1 through S10-F4-T3                  |

## Reviewed exclusions

| Orca surface              | Disposition                       | Reason                                                                          |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| Desktop pet               | Exclude                           | Novelty surface, not a development capability                                   |
| Star prompt               | Exclude                           | Repository marketing prompt, not product functionality                          |
| Promotional feature wall  | Exclude                           | Marketing content; Flapstack keeps contextual onboarding and feature visibility |
| Codex reset-credit action | Exclude pending official contract | Provider-internal behavior is not a stable OpenAI product API                   |

## Completeness rule

A newly discovered Orca user-facing family must receive one of four recorded
dispositions before parity planning can be called current: Existing, Improve,
Add with an owning task, or Exclude with a reason. Orca upstream must be checked
again immediately before each stage begins because it changes daily.
