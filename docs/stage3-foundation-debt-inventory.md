# Stage 3 Foundation Debt Inventory

Captured 2026-07-11 from `codex/stage3-f1-foundation` at planning seed
`f19dbec773ba1a7a5169fec3795dda1384171258` using Node 22.23.1 on macOS arm64.

## Entry-gate result

Stage 3 has no blocking TypeScript, native ABI, schema, lint, test, build, or CI
debt. The older TypeScript/native-debt claims are stale: the current baseline
already contains the required fixes and passes the supported gate.

| Area                | Evidence                                                                                                                                                                                        | Classification                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| TypeScript          | `npm run ts:check` passed with zero errors.                                                                                                                                                     | Already resolved                                                |
| Lint and formatting | `npm run check` passed ESLint and Prettier.                                                                                                                                                     | Already resolved                                                |
| Tests               | `npm run check` passed 357 tests with 3 intentional skips across 38 files.                                                                                                                      | Already resolved                                                |
| Production build    | `npm run check` completed all main, preload, and renderer bundles.                                                                                                                              | Already resolved                                                |
| Native ABI          | Electron ABI 140 and Node ABI 127 both rebuilt and passed real `better-sqlite3` and `node-pty` load probes. Switching Electron -> Node succeeded without manual marker editing.                 | Already resolved                                                |
| Schema              | `npm run db:generate` read 19 tables and reported no schema changes.                                                                                                                            | Already resolved                                                |
| CI                  | The macOS CI uses Node 22 and now invokes the same `npm run check` commit gate used locally. Provider-drift jobs also use Node 22.                                                              | Enforced by S3-F1                                               |
| MCP scaffold        | `src/main/lib/mcp-control` is the single starting point. The tRPC app-control router exposes scaffold metadata only; transport remains disabled. Thirteen focused native/scaffold tests passed. | Keep and adapt in S3-F2; do not rebuild from an obsolete branch |

## Proven non-blocking deferrals

| Item                                                                                    | Why it does not block Stage 3                                                                                                                     | Owner and destination                                                                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Vite reports that two modules are both statically and dynamically imported.             | Build succeeds; this only prevents those modules from moving into separate chunks. It does not weaken type safety or privileged-control behavior. | Build/performance maintenance; address only during a later bundle-optimization pass.                       |
| `gray-matter` uses `eval` internally.                                                   | The warning is in an existing dependency and the production build succeeds. No Stage 3 app-control code depends on changing it.                   | Dependency maintenance; reassess on `gray-matter` replacement or upgrade.                                  |
| `node-pty` emits two missing-field-initializer compiler warnings during native rebuild. | The dependency compiles, loads, and passes the real API probe under both required ABIs.                                                           | Native dependency maintenance; take an upstream `node-pty` fix when available.                             |
| Three tests are skipped by the existing suite.                                          | The full gate reports them as intentional skips, not failures; focused Stage 3 foundation tests pass.                                             | Owners of the credential/platform-specific suites; execute at their existing manual or credentialed gates. |

## MCP direction for S3-F2

- Keep `src/main/lib/mcp-control/types.ts`, `gate.ts`, and `registry.ts` as the
  canonical policy/registry scaffold.
- Adapt `src/main/lib/trpc/routers/app-control.ts` for management/status surfaces;
  do not treat tRPC as the MCP transport.
- Build the stdio transport in S3-F2 from the current scaffold and MCP SDK.
- Keep transport disabled until the S3-F2 transport tests and S3-F3 permission
  enforcement are present.
- Drop all assumptions that an unmerged historical branch or missing audit
  schema is a prerequisite. Audit persistence remains owned by S3-F4.

## Reproduction

```sh
npm ci --legacy-peer-deps
npm run ts:check
npm run check
node scripts/ensure-native-abi.mjs electron
node scripts/ensure-native-abi.mjs node
npm run db:generate
npx vitest run tests/native-abi-key.test.ts tests/future-scaffolds.test.ts
```
