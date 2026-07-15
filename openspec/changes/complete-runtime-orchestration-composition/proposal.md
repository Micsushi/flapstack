# Change: Complete Runtime and orchestration composition

## Why

Stage 4 deliberately separates F3 coordination from F11 provider Runtime
authority. Known optional/partial seams must compose before Stage 5 mobile,
swarm, profile, and integrated workflows rely on them.

## What Changes

- Route Codex coordination requests through F11's owned App Server authority.
- Forward workflow output schemas through supported Runtime structured-output options.
- Add capability-gated provider-neutral pause/resume without false state.
- Reconcile ordered activity, cancellation, recovery, and no-replay across F3/F11.
- Prove live provider, package, and platform compatibility.

## Impact

- Affected specs: new runtime-orchestration-composition capability.
- Affected code: F3 consumer ports, F11 coordinator/adapters, structured output,
  pause/resume/cascade, activity projection, recovery, diagnostics, and tests.
