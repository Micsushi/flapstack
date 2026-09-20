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

## Workflow

Use Board for checked task transitions and questions. Use Setups for saved graph
versions, execution policy and project assignments. Fleet shows worker attempts;
a finished worker does not by itself mark its task verified. Yap keeps source
material, proposed destinations and approval separate. Review each action before
applying it; unselected or uncertain actions remain available for correction.

Workers started by the Records Board receive their own scoped Records tools.
Ordinary desktop chats do not inherit the desktop's Records authority. Historical
SQLite task data is retained; when Records is connected, legacy task mutations
are refused so two editable task systems cannot diverge.

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
