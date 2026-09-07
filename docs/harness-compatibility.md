# Harness compatibility boundaries

Flapstack keeps its own runtime, permission, and persistence contracts. The
following upstream mechanisms are useful compatibility references, not a claim
that their whole harness or security boundary has been adopted.

## ChatGPT web MCP

Checked against official documentation on 2026-09-07 UTC (2026-09-06 MDT).
[Developer mode](https://developers.openai.com/api/docs/guides/developer-mode)
supports read and write tools over SSE or streaming HTTP, with OAuth, anonymous,
or mixed authentication. Account and workspace policy still determine access.
[Connection guidance](https://developers.openai.com/plugins/deploy/connect-chatgpt)
also supports private servers through
[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels),
which forwards requests over an outbound connection and can reach local stdio or
HTTP servers. A public listener is therefore not required for private testing.

Flapstack is not yet a verified ChatGPT connection. Its product stdio entrypoint
(`src/main/mcp-control-stdio.ts`) requires launcher-provided Chat/run identity.
`mcp-control/identity.ts` revalidates that identity against active durable state,
exposure settings, and frozen permissions. The development HTTP server is a
separate test-control surface, not an external-user authorization layer.

Before connecting, provide a revocable external caller grant mapped to allowed
projects and operations, enforce it on each call through the existing gate/audit
path, and verify expiry, cancellation, reconnect, replay and scope denial. Do not
fabricate a live run identity or forward the development control server to satisfy
transport discovery. Public account-linked endpoints additionally need the
[documented OAuth discovery and token checks](https://developers.openai.com/plugins/build/auth).
No tunnel, external connection, OAuth registration, or public endpoint is enabled
by this evaluation. MCP exposes declared tools; it does not grant arbitrary
ChatGPT browser or desktop control.

## Account selection

Orca's [account selection implementation](https://github.com/stablyai/orca/blob/bf4e2705046cf9ef9c915929a9646da85717af07/src/main/codex-accounts/codex-account-selection.ts)
checks that an account belongs to the selected host or WSL runtime and persists
selection separately for each target. This supports Flapstack's decision to store
runtime target alongside account identity. Flapstack's current provenance records
do not yet provide managed account homes or host-specific account switching.

Orca is MIT licensed, with copyright attributed to Lovecast Inc. Any future code
copy must retain its license notice. No Orca implementation is copied here.

## Durability and lifecycle

DeepSeek Harness was inspected at `d347e703908d0406b7a7ef80e3a0e594d86b2215`.
Its [checkpoint policy](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-checkpoint-policy/src/index.ts)
flushes session state before dispatching model requests or top-level tools. A
failed flush prevents dispatch. Its [run settlement](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/subagent/subagent/src/run-settlement.ts)
waits for disposal before returning success and preserves disposal failures.
These are compatible review criteria for Flapstack's durable launch intents and
process cleanup; they do not require adopting Cordis or another event framework.
The upstream default branch still resolves to this revision on the check above.

The MIT-licensed project's [safety statement](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/SAFETY.md)
explicitly describes a developer preview without a security audit. Its sandbox
must not be treated as proof of isolation for Flapstack. No DeepSeek code is copied
here.

## Browser and computer use

[Official OpenAI guidance](https://developers.openai.com/api/docs/guides/tools-computer-use)
places environment execution, permission enforcement, cancellation, and outcome
verification in the integrating application. It recommends isolated environments
and allowlists, and treats page content as untrusted.

For Flapstack, a separate browser profile alone would not establish a complete
sandbox. A managed browser must enforce its own navigation/action authority and
resource lifecycle, keep account access explicit, and avoid controlling the
owner's desktop. Existing capture permissions do not imply browser-control
permission. This document does not certify a managed browser implementation.

## Model suitability

The OmniRoute catalog adapter validates discovery, not model quality. Advertised
tool calling and context length do not establish reliable coding. Qualification
must retain the exact model, quantization, host, runtime and task corpus alongside
correctness, tool/schema compliance, retries, latency and peak memory. Measure
classification, extraction, summarization and bounded code changes separately;
coding requires executable acceptance checks and preserved failure examples.
Until a route has that evidence, keep it unqualified for autonomous coding and
require an explicitly configured stronger-model fallback or stop. Archify's
validation-only adapter checks contract shape; it does not certify execution or
model suitability.
