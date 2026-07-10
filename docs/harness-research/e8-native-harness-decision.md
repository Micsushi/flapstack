# E8 — Native harness spike + defer/continue decision

Status (2026-07-09, scaffolding stage): **DEFERRED — sidecar is the Stage 2
path; native loop is not built now.**

## Question

After the OpenCode sidecar path exists, does Flapstack still need its own native
provider tool loop (direct OpenRouter/NanoGPT calls + Flapstack-owned tool
execution) for Stage 2?

## Current answer

No native loop for Stage 2. The sidecar gives Flapstack, for free:

- provider streaming (OpenRouter + OpenAI-compatible NanoGPT),
- a tool/continuation loop with real tool schemas,
- per-tool permission rules + an approval protocol Flapstack bridges,
- MCP support,
- an event stream Flapstack normalizes into its existing message/thinking model.

Building a native loop now would duplicate all of that plus tool-schema
maintenance and provider-quirk handling, for no Stage 2 product gain.

## Revisit triggers (would promote a native-loop plan)

Reconsider only if a concrete sidecar blocker appears:

1. OpenCode cannot express a permission control Flapstack needs (a toggle that
   must be enforced, not just asked).
2. Sidecar startup latency/reliability is unacceptable for interactive use.
3. A provider capability (reasoning controls, usage/cost fields) is reachable
   via direct API but not surfaced by OpenCode.
4. Packaging/distribution of the OpenCode binary proves impractical.

If any fires, write a later-stage plan using OpenCode's runner/tool-registry/
permission/provider abstractions as the reference design. Do NOT expand Stage 2
scope pre-emptively.

## Follow-up

Re-run this decision once one real OpenRouter/NanoGPT run has been persisted
through the sidecar (E6 live verification), and record the observed latency +
any capability gaps here.
