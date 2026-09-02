## Context

Flapstack already has GitHub clone/PR status/merge helpers, visual context,
saved browser references, structured agent runtimes, product MCP, permission
modes, reversible actions, and a path-installed directory opener. These become
the foundations instead of parallel implementations.

## Goals / Non-Goals

- Goals: complete task/review flow across supported providers, in-app browser
  debugging, complete agent/script control, broad CLI-agent launch/status reach,
  and explicit visible computer operation.
- Non-goals: hosted SaaS sync, invisible desktop control, weakening structured
  runtimes, storing provider secrets in renderer state, or automatic merge/deploy.

## Decisions

- Provider adapters expose normalized task, issue, branch, PR/MR, review, and
  pagination/rate-limit contracts. Provider-specific fields remain namespaced.
- GitHub and GitLab establish the forge contract. Linear and Jira establish task
  behavior. Azure DevOps, Bitbucket, and Gitea then use the same capability,
  credential, pagination, rate-limit, and idempotency boundaries.
- Embedded browser state belongs to a main-process profile/tab service. Renderer
  panes receive redacted tab state and bounded frame/control events.
- User agents, proxies, cookies/storage, WebAuthn identities, credential
  references, HTTP authentication, and downloads are profile-scoped. Import
  previews source and data classes and never grants access to personal browser
  profiles implicitly.
- Design Mode captures selector, bounded DOM/CSS context, viewport, and cropped
  screenshot through the existing visual-context attachment pipeline.
- The CLI authenticates to the local running app and calls existing services.
  It owns no database or provider process.
- Bundled operator guides are generated or checked against current command and
  permission schemas. Packaging never silently replaces a user-modified skill.
- Generic TUI agents run in durable terminal sessions and advertise explicit
  limitations. Structured runtimes remain preferred whenever available.
- Computer Use requires a visible target, per-action permission, current-frame
  evidence, audit, and a user-accessible stop. Reversible product actions use the
  existing undo history; external UI effects are labeled potentially irreversible.

## Risks / Trade-offs

- Embedded Chromium expands attack surface. Isolate profiles, deny unsafe
  navigation/schemes, enforce permission handlers, and package-test native code.
- Provider schemas drift. Keep raw provider IDs and typed failure/rate-limit state.
- Generic TUIs cannot promise structured permissions, usage, resume, or status.
  Never infer capabilities from terminal text alone.
