# Runtime timeline UI qualification

Run `npm run test:runtime-timeline-ui` with the pinned Node/npm toolchain. The
guarded command bundles the production timeline component and repository styles,
then opens hidden Electron fixture windows with a unique owned profile. It does
not open the main app, connect a provider, or read an existing profile.

The fixture starts with 10,000 ordered events across the three Runtime labels,
including private payload sentinels. It checks bounded mounted rows, top/middle/end
scrolling, complete ordered export of public content, private-content exclusion,
one appended event, storage-event synchronization between two windows, reload and
window reopening. Stable mounted event keys must survive reload/reopen.

The local regression ceilings are 5 seconds for initial window/render, 2 seconds
for each sampled scroll and the two-window update, and 40 mounted rows. These are
fixture regression limits, not certification of minimum hardware or the full
application's performance budgets. Each run retains measurements, sampled row
identities, a screenshot and cleanup status under `.local-evidence/runtime-timeline-ui/`.

Two-window synchronization here uses browser storage events in the fixture. It
does not prove production IPC invalidation, provider transport behavior, or
installed-package performance. Those checks require separate app evidence.

The 2026-09-21 run on Electron 41.10.7 passed: initial render 171 ms, five
scroll samples 71–153 ms with 13–19 mounted rows, and append plus second-window
observation 218 ms. Ordered export, private-content exclusion, reload and reopen
checks passed; both owned windows closed with exit code 0. The receipt is retained
locally in `1789975349904-23264` under the evidence directory above.

An earlier hidden-window run rendered in 199 ms but exceeded the scroll ceiling.
The fixture now uses the application's existing offscreen rendering mode, keeping
animation frames active without showing or focusing a window. The same ceilings
then passed; no production timeline change was needed.

The renderer bridge regression imports the real preload and query provider. Before
the fix, an idle observer remained at its old value after the main activity channel
fired. The fix subscribes each window's query provider and invalidates matching
Chat/run activity queries. The regression verifies that enabled idle observers
refresh, disabled observers become stale without fetching, unrelated Chats remain
untouched, and unmount removes the listener. This is query-boundary evidence;
actual app owner-window reload and separate observer-window consistency still
require the combined built-app replay.

The production launcher now captures the store's inserted-event cursor and emits
it only after the owning transaction commits. A launcher regression reads every
announced cursor from a separate SQLite connection and compares announcements
with all persisted activity sequences. Failed intent writes emit nothing, and a
closing renderer cannot fail a committed write or prevent other windows receiving
the update. Producer, receiver and broadcast suites pass together (40 tests).
