# Change: Validate Stage 3 release

## Why

Stage 3 spans MCP control, Settings reliability, Voice, credentials,
permissions, provider harnesses, Usage, reasoning, migrations, and packaging.
Feature-local green checks cannot prove their integrations or release identity.
Former Stage 2 task `7.2` and remaining integrated/manual regression work need
one authoritative Stage 3 gate before the user can squash-merge the branch.

## What Changes

- Promote former Stage 2 `7.2 OpenSpec change validated and archived` and all
  remaining integrated/manual regression ownership into S3-F17.
- Define one exact-SHA release manifest and evidence ledger covering every
  visible Stage 3 feature, migration, provider, permission, MCP, Usage,
  reasoning, Voice, secure credential, and package boundary.
- Run automated, migration, live-dev, package-preview, restart, failure,
  recovery, and cleanup matrices without using or dirtying `main`.
- Run independent review/fix cycles after integration; cap the planned loop at
  three complete review rounds and escalate unresolved blockers honestly.
- Reconcile task/spec/doc truth, strict-validate all active changes, and archive
  only after exact evidence passes.

## Impact

- Affected specs: new `integrated-stage3-release` capability.
- Affected code: no new product surface is required by the proposal itself;
  defects found by the gate may affect any Stage 3 integration, test, migration,
  packaging, or documentation path.
- Dependencies: MCP feature closeout S3-F6, Settings closeout S3-F13 including
  S3-F9 Voice, S3-F10 credentials, and S3-F12 permissions, plus S3-F14 Usage,
  S3-F15 provider harnesses, and S3-F16 reasoning.

## Migration of Existing Task Authority

- Former Stage 2 `7.2` maps to S3-F17-T1 and S3-F17-T5.
- Integrated and manual regression rows from prior Stage 2/Stage 3 matrices map
  to S3-F17-T1 through S3-F17-T4.
- Existing S3-F6-T4 remains the MCP-control feature closeout and S3-F13-T4
  remains the Settings feature closeout. S3-F17 is the sole integrated Stage 3
  release and archive authority.
