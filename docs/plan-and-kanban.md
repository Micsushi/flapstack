# Plan and Kanban

Flapstack keeps plan sources read-only and turns reviewed plan candidates or AI
proposals into durable task/chat records. Opening **Tasks** in the main sidebar
shows the production Kanban board. Opening **Plan** for a selected project shows
registered OpenSpec and Markdown sources.

## Source and card truth

- Plan files remain the source for proposed, active, built, stale, and malformed
  plan state. Flapstack never writes task state back into those files.
- Normal Kanban cards are durable tasks. Archived tasks are hidden by default.
- A promoted plan candidate creates one task and one idle seeded chat. Retrying
  the same promotion returns the existing pair and never launches a run.
- An AI proposal is inert until a user approves its reviewed task/chat preview.
  Denial is terminal. Approval creates the reviewed pair and never launches a
  run.

## Recovery and concurrency

Task moves, proposal decisions, and source-linked actions use optimistic
versions. Reordering existing cards also advances their versions, so another
window cannot commit a move against stale board order. Conflicts fail closed and
refresh affected queries.

Plan-source refreshes are serialized and coalesced. When several file events
arrive during a read, Flapstack discards the intermediate snapshot, rereads the
latest source state, and emits one current refresh. Parse errors and stale
fingerprints stay visible instead of masquerading as current plans.

## Verification boundary

Headless coverage owns schema migration, source safety and recovery, renderer
route wiring, task-card ordering, promotion idempotency, approval gates, audit,
invalidation, and two-window conflict behavior. The Stage 4 matrix remains the
authority for live accessibility, real multi-window, packaged preview, and
manual UI evidence.
