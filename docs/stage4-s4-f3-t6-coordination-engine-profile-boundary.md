# S4-F3-T6 coordination engine and profile boundary

Historical implementation evidence. S4-F3 core is now accepted at Tier 2.

## Coordination engine contract

One orchestration resolves `workflow`, `codex-v2`, or `codex-v1` from
per-launch, project, global, then product default. `workflow` is the product
default. The resolved engine, version, capability probe, source, and initial
provider identity are written before queued/running intent and remain immutable.

- `workflow`: recommended deterministic mixed-Runtime control plane.
- `codex-v2`: capability-gated named task tree, mailbox, follow-up, selective
  context fork, interruption, wait, and residency semantics.
- `codex-v1`: advanced legacy provider-agent-ID, resume, and close semantics.

Unavailable or corrupt probes block launch with the exact reason. No engine is
substituted silently. Changing engine creates a new orchestration; active or
historical rows never switch.

## Profile promotion boundary

S4-F12 may promote Agent Profiles only after its T1 research gate locks scope,
precedence, trust, memory, compatibility, evaluation, import, and starter
catalog decisions. Persistence and launch preview must keep four layers
separate:

1. Capability profile: role, instructions, tools, skills, model ceiling,
   permissions, memory, worktree, and descendants.
2. Presentation style: tone, verbosity, formatting, response structure, and
   optional voice only.
3. Workflow binding: topology, phases, dependencies, schemas, gates, and
   bounded step overrides.
4. Runtime snapshot: immutable resolved harness, Agent Runtime, model,
   permissions, controls, and source versions for one launch.

Presentation cannot grant tools, permissions, secrets, memory, descendants, a
stronger model, Runtime compatibility, or coordination authority. Workflow
metadata cannot bypass capability, task/project/orchestration policy, or the
existing approval gate. Profiles may request an engine or Runtime preference,
but compatibility resolution can only narrow or block it.

Historical launches retain their exact resolved profile, workflow, engine, and
Runtime snapshots. Editing a source definition affects future launches only.
