## Context

Flapstack has a secure default-off LAN HTTPS/PWA bridge, durable device identities,
authority grants, sequenced events, bounded actions, and cross-platform packages.
It does not have a remote execution host or native mobile workspace. Orca's Expo
app is a useful interaction and component reference but speaks a different backend
protocol and assumes Orca's runtime/store model.

## Goals / Non-Goals

- Goals: explicit execution-host authority, SSH/WSL parity, resilient remote PTYs,
  a native companion that reuses Flapstack security and services, recipe-driven
  ephemeral VM runtimes, and an optional encrypted relay after direct paths work.
- Non-goals: mandatory hosted infrastructure, copying Orca's RPC protocol/store,
  public unauthenticated listeners, mobile secret export, or silent mixed-version behavior.

## Decisions

### Execution-host authority precedes clients

- Every workspace binds to a host identity and capability snapshot. File, Git,
  PTY, process, port, and provider-account operations execute on that host.
- Wire requests are versioned and additive by default. Removed/changed semantics
  raise the minimum compatible version and block with an upgrade path.
- Runtime truth uses `live`, `exited`, `unverifiable`, and `unreachable`; clients
  never infer process death from a dropped connection.

### SSH and WSL are target transports

- SSH secrets stay in OS-protected credential storage or user-owned SSH agents.
  Remote daemons use mutually authenticated, pinned connections.
- Port forwarding is explicit, scoped, revocable, and listed in one inventory.
- WSL uses the same host-target contracts with distro-specific paths and isolated
  provider homes, avoiding separate Windows-only business logic.

### Native mobile reuses the Flapstack bridge

- Add an Expo workspace in-repo. Adapt focused MIT-licensed Orca mobile modules
  only after dependency/license review.
- Keep Flapstack pairing, device public keys, grants, revocation, step-up, replay
  defense, and stale read-only state. Native secure storage holds only device and
  connection material required by that protocol.
- Ship vertical slices: host/workspace overview, Chat steering/notifications,
  terminal, files/diff/source control, browser/task/account surfaces.
- Mobile writes route through the same compare-and-save, Git, permission, audit,
  and undo services as desktop.

### Relay is optional transport, never authority

- Peer-bound end-to-end encryption keeps relay brokers and cells outside product
  authority. Revocation, replay defense, sequence, and backpressure remain
  enforced end to end.
- Direct LAN, VPN, and SSH routes work without a relay account or service. Relay
  assignment and regional placement are replaceable and self-hostable.
- Regional probes use an allowlisted broker catalog, bounded samples, and no
  credentials, pairing data, content, or phone-location measurement.

### Ephemeral VMs are owned execution hosts

- Recipes pin image/source identity, quotas, lifetime, bootstrap behavior, and
  capability requirements before provisioning starts.
- Created VMs, volumes, keys, and networks carry Flapstack ownership receipts.
  Stop, snapshot, resume, and cleanup revalidate those identities before mutation.
- Disconnect means unreachable, not deleted. Failed cleanup stays visible and
  retryable so an orphaned billable resource cannot disappear from inventory.
- A local emulator exercises lifecycle behavior but never counts as cloud/backend
  acceptance and ships without test credentials or mock authority.

## Migration Plan

1. Add host identity/capability fields with local-host defaults.
2. Move local files/Git/PTY calls behind host-aware interfaces without changing
   behavior, then add headless and SSH transports.
3. Extend the existing mobile protocol additively and keep the PWA supported
   during native rollout.
4. Add the Expo workspace and migrate one vertical slice at a time.
5. Add ephemeral VM recipes and emulator coverage, then certify one disposable
   backend before integrated acceptance.

## Risks / Trade-offs

- Remote execution enlarges the trust boundary. Pin host identity, scope grants,
  reject root/broad destructive targets, and preserve exact execution location.
- App Store lag creates mixed versions. Capability negotiation and kill switches
  must exist before public mobile builds.
- Full mobile terminal/editor can bypass the original bounded-companion intent.
  Require explicit device grants and keep high-risk operations step-up/desktop-only.
- VM provisioning can create billable resources. Show backend, recipe, quota,
  TTL/cost effect, and cleanup state for every lifecycle mutation.
