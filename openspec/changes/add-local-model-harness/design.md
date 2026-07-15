## Context

`ollama.ts` supports status, model listing, and non-streaming title/commit helper
requests. The OpenCode sidecar owns its provider tool loop, but its normalized
events, permission mapping, persistence, and usage patterns can be reused without
requiring OpenCode for Ollama.

## Goals / Non-Goals

- Goals: local persisted chat, honest capability probing, streaming, bounded
  tools, permission parity where enforceable, evidence, usage, and orchestration.
- Non-goals: bundled model downloads, training/fine-tuning, arbitrary OpenAI-
  compatible endpoints, claiming every Ollama model supports tools, or silent
  fallback to cloud.

## Decisions

- First provider is local Ollama at configurable loopback URL; remote Ollama is
  disabled by default and requires explicit network/credential policy later.
- Use Ollama `/api/chat` streaming and tool-call support. Models without declared
  tool support run chat-only and show that limitation.
- Build one small Flapstack-owned loop around provider-neutral tools. Reuse
  normalized event, approval, persistence, context, checkpoint, and usage seams.
- Tool promotion order: read/list/search -> project-scoped edit/write -> shell/git
  -> network. Each tier has independent tests and may remain unavailable.
- Read-only is the default permission. Unknown tools fail closed. Exact project-
  only writes revalidate registered roots and symlinks at commit time.
- Store prompt/context/tool/result records, not hidden reasoning. Usage records
  provider-reported tokens when available and `unknown` otherwise; local cost is zero
  only as compute billing metadata, never as proof of no resource use.

## Risks / Trade-offs

- Model tool behavior is inconsistent. Probe per model/version and degrade to
  chat-only; do not infer support from model name.
- App-owned loops can recurse or stall. Cap iterations, tool calls, context size,
  output, wall time, and cancellation latency.
- Local is not automatically safe. Preserve permissions, path safety, approval,
  MCP controls, and audit just like remote harnesses.

## Migration Plan

Add `local` harness values additively. Existing Ollama helper settings remain.
No model is selected or launched automatically.

## Open Questions

- None blocking. Ollama loopback and read-only default are fixed for first delivery.
