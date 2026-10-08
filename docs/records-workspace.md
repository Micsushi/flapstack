# Board, Setups, Fleet and Yap

Project Records owns task state, dependencies, saved Setups, worker claims and
Yap approvals. Flapstack displays its shared UI and connects through a local,
authenticated HTTP service. Task completion and worker completion are separate.

## Build and connect

Clean checkouts build with a pinned, generated UI snapshot from the companion
repository. Set `FLAPSTACK_PROJECT_RECORDS_SOURCE` to a compatible Project Records
checkout for joint development. To update the shipped snapshot after reviewing
and committing that UI, run `node scripts/sync-project-records-ui.mjs` with that
variable set. Commit the resulting `resources/project-records-ui.json.gz`.
The build prepares sources under ignored `.generated/project-records`; edit the
original `ui/shared` files in Project Records, never the generated copies.
The packaged renderer does not require either source checkout at runtime.

Run the Project Records service using its documented setup. Configure
`FLAPSTACK_PROJECT_RECORDS_URL` with its `http://127.0.0.1:PORT` address and
`FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE` with its desktop credential file. Keep
credentials outside source control. The desktop credential must not be given to
agents. Service data remains in its configured Records directory.

## Local SQL foundation

Without an external connection, Flapstack creates a standalone Records store by
default. This does not import, erase, or modify historical local tasks. The Board
already uses Records; historical task data remains in the separate Flapstack
database and is not copied into the new board. An old-task migration needs a
separate reviewed import, not an automatic conversion.

- Connected: set `FLAPSTACK_PROJECT_RECORDS_MODE=connected`, the existing
  `FLAPSTACK_PROJECT_RECORDS_URL`, and `FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE`.
  Flapstack does not start, migrate, or stop that service.
- Standalone: set `FLAPSTACK_PROJECT_RECORDS_MODE=standalone`. Do not set the
  connected URL or token variables. Flapstack starts its own bundled Records
  engine, with a local `records.sqlite3` database and private desktop token under
  its profile's `project-records` directory. Set `FLAPSTACK_PROJECT_RECORDS_DATA`
  to choose another local directory. This is a data directory, not a Git checkout.

Standalone currently requires an installed Python 3 interpreter. Set
`FLAPSTACK_PROJECT_RECORDS_PYTHON` to its executable path when `python` is not
available. Python is not installed automatically or bundled in this foundation.
An initialization, authentication, or startup failure does not switch to a
different task database. The configured Records mode continues blocking legacy
task writes. Fix the configuration and restart the application.

The compatible Records engine accepts documents up to 16 MiB. Flapstack bounds
service responses at 32 MiB to allow envelope and serialization overhead; a
larger response still fails explicitly. Individual changes remain limited to
256 KiB. Large histories should be imported through the service's documented
storage migration, then edited with small revision-checked patches, not posted
back as whole documents. Upgrade the engine and client together before using
documents beyond the earlier 4 MiB limit.

For example, in PowerShell for a development checkout:

```powershell
$env:FLAPSTACK_PROJECT_RECORDS_MODE = 'standalone'
$env:FLAPSTACK_PROJECT_RECORDS_PYTHON = 'C:\path\to\python.exe'
npm run dev
```

For a connected service instead:

```powershell
$env:FLAPSTACK_PROJECT_RECORDS_MODE = 'connected'
$env:FLAPSTACK_PROJECT_RECORDS_URL = 'http://127.0.0.1:47831'
$env:FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE = 'C:\private\records-token'
npm run dev
```

Use a fresh shell when switching examples. Both modes use the same HTTP contract;
the board never writes SQL directly. Flapstack keeps its chat/settings database
separate. Standalone stops only the service process it started. Its database
survives application exit. Do not synchronize a live SQLite file between computers.

Runtime maintainers pin the reviewed companion engine with
`node scripts/sync-project-records-runtime.mjs`, using the same
`FLAPSTACK_PROJECT_RECORDS_SOURCE` override as UI development. The generated
runtime archive includes source and UI, not owner data or credentials. The source
must be committed before pinning. Packaged apps do not need a Records Git clone.

## Workflow

Work board, Yap, Fleet and Setups are separate sidebar destinations. Work board
shows equal-height collapsed tickets; click a title to expand its context and
actions. Each ticket also shows a short reference such as `#42`. Expand a ticket
and edit Reference to replace that display with a text ID such as `FLAP-42`.
Save reference applies the change; leaving the field blank restores its original
automatic number. Custom references must be unique in the profile, ignoring case,
and cannot use the reserved `#number` format. Undo/Redo supports reference changes
without discarding newer unsaved text. Search either the custom reference or the
original automatic number to find the ticket. Numbers are assigned once per document path and
record ID, saved in the app/browser profile, and never reused when a ticket
leaves the board. They survive title, status, grouping and ordering changes.
They are local board references, not replacements for Project Records IDs;
other devices or profiles may assign different numbers. Clearing that profile's
site data removes the numbering. If local storage is unavailable, the board
shows the original IDs and an error instead of claiming a number was saved. Use Work board for checked task transitions and questions. Use Setups for saved graph
versions, execution policy and project assignments. Fleet shows worker attempts;
a finished worker does not by itself mark its task verified. Yap keeps source
material, proposed destinations and approval separate. Review each action before
applying it; unselected or uncertain actions remain available for correction.

Workers started by the Records Board receive their own scoped Records tools.
Ordinary desktop chats do not inherit the desktop's Records authority. Historical
SQLite task data is retained; when Records is connected, legacy task mutations
are refused so two editable task systems cannot diverge.

In Plan, use **Add Markdown plan** to register an existing file by its path relative
to the selected local project, such as `docs/plan.md`. Registration keeps the file
read-only; rejected paths remain available to correct and retry.

In Plan, promoting an incomplete item opens a Records project selector and then
the existing Yap review. The source is checked before capture; repeated requests
for the same source version and destination reopen one proposal. Approval in Yap
creates a planned task without starting a conversation, worktree or run. Local
project identities are not assumed to match Records projects: choose the Records
destination explicitly. Destinations combine existing task documents with
projects represented in task or feature documents.

Plan comparisons show captured proposal and canonical task provenance, including
later source changes. A proposal is a captured snapshot: editing the source after
capture does not modify or revoke it. Review the captured content in Yap before
approval; cancel it there if it is obsolete. Task documents and their revisions
remain owned by Records.

In the desktop Board, select a local project in the sidebar and use **Open
worktree Chat** on a claimed task. Review the local repository, branch, starting
commit and worktree path, then confirm creation. Cancel leaves no local link or
Git changes. A changed target requires a fresh preview. The task must belong to one canonical project
and have current authority, readiness and claim. The desktop checks its exact
document revision and claim before creating an isolated Git worktree. It creates
one ordinary project Chat and retains the canonical task, project, source
revision and claim association across restarts; no duplicate local task is made.
The idle Chat includes a quoted snapshot of the canonical task locator, revision,
description, work specification and acceptance checks. Re-read the Board before
acting; the snapshot grants no worker access. Reopening preserves conversation
history. Repeated clicks reopen that Chat. A different claim or local project cannot
silently take it over. Refresh the Board after a stale-state rejection.

Opening the Chat does not start an agent, copy the desktop Records credential,
push or merge. The Chat inherits local project permissions. Use normal Chat
archive/restore to hide or restore it; the association and worktree remain.
Failed isolation never falls back to the main checkout. An interrupted operation
retains its reserved worktree for retry. If interrupted before filesystem
registration, recovery requires the exact reserved branch, repository and
starting commit with a clean worktree. An occupied branch, changed target or
missing linked worktree reports a conflict without deleting user work.

For a saved Yap proposal with one new task action, **Create task and idle Chat**
opens an explicit review of its canonical destination and the selected local
repository. Confirmation creates the reviewed task and one read-only Chat with
its captured context. It starts no run and creates no Git worktree. Repeated
confirmation or recovery opens the same pair. Other actions and proposals already
approved for Records-only application retain **Apply approved changes**.
