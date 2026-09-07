# Terminal session ownership

Exit events and delayed cleanup belong to a PTY instance, not just its pane ID.
Restarting a terminal in the same pane must not let the previous instance remove
the replacement, unregister its ports, or announce a stale exit. Fallback shell
creation is single-flight with renderer restart requests.

Detach accepts an explicitly empty serialized screen. Omitting the snapshot
preserves the existing value. This distinction prevents cleared terminal state
from being replaced by an older snapshot on reattach.

Terminal Recovery is a default-off beta setting. It applies to new terminals;
existing terminals retain their creation mode when the setting changes. With the
setting off, the renderer keeps the legacy raw stream and serialized detach
screen. The main process chooses the mode, not renderer-supplied input.

With Terminal Recovery enabled, the renderer attaches to main-owned parsed terminal state. Output
continues to update that state while the view is detached. Each attachment starts
with an ordered snapshot, followed by acknowledged output. The browser acknowledges
only after xterm has parsed a delivery. A replacement snapshot waits for previous
parsing before resetting the screen, preventing old queued output from appearing
on the replacement terminal. Legacy detach and raw-stream endpoints remain for
compatibility; recovery-enabled terminals do not serialize their own detach screen.

Recovery views keep the main process's character grid, including when the same
terminal appears in differently sized panes. Container changes propose a PTY
resize without locally reflowing parsed output; the ordered snapshot applies
the resulting geometry to every view. Snapshots never trigger another fit or
resize request. A narrower recovery pane scrolls horizontally to retain access
to columns beyond its viewport. Legacy terminals retain local fit behavior.

The serializer does not retain all interpreter state. An attachment inside an
unfinished escape sequence or Unicode surrogate pair receives bounded snapshots
instead of interpreting the raw suffix as ordinary text. Non-default character
sets, saved cursor state, scroll margins and tab stops also keep the attachment
on snapshots until compatible state returns. Ordinary compatible attachments
keep low-latency raw output. The fallback is limited to one snapshot per 100 ms
and the same acknowledgement/byte bounds; complex terminal programs may refresh
more slowly while it is active.

This read-only compatibility probe is pinned to headless xterm 6.0.0. Unknown
dependency shapes fall back to snapshots. Its contract is verified against the
upstream [serializer](https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-serialize/src/SerializeAddon.ts),
[parser](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/common/parser/EscapeSequenceParser.ts)
and [Unicode decoder](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/common/input/TextDecoder.ts).
Cold parking cannot discard the interpreter merely because its screen was
serialized. No automatic cold parking is enabled by this implementation.

Recovery uses the official MIT-licensed [headless xterm](https://github.com/xtermjs/xterm.js/tree/6.0.0)
and the existing [serialization addon](https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-serialize/README.md).
It keeps the existing 10,000-row scrollback policy. Dimensions are bounded to 500
columns by 200 rows; input parsing has a 4 MiB queue limit, with owned-PTY
pause/resume above 256 KiB/below 64 KiB. Snapshots are capped at 8 MiB. Exceeding a
limit produces an explicit recovery failure rather than a false empty screen.

Each terminal permits eight attached views and one unacknowledged delivery per
view. A slow view receives a fresh snapshot after acknowledging, with at least
100 ms between recovery scheduling and delivery. It does not accumulate a second
output log or an unbounded IPC queue. A view that does not acknowledge for 30
seconds is disconnected; reopening it obtains current state. Exit follows the
last recovered output. Unsubscribing leaves the PTY and screen state alive.
The existing five-second exited-session cleanup remains in place. If that cleanup
closes an unresponsive view before it receives final status, the view reports the
closure explicitly and offers keyboard reattachment; it does not invent an exit
code or claim that all trailing output was recovered.

This state is currently in memory, not a durable terminal journal. App-restart
process restoration, persisted retention/garbage collection, cold parking and
mobile attachment acceptance remain separate S7 terminal work. No terminal input
or output is separately indexed or logged by this recovery service. Existing
shutdown ownership and platform teardown checks remain in force.

Verification includes the real renderer component attached to the production
recovery service over an isolated local test transport, with detach/reattach,
ANSI overwrite, Unicode and narrow-layout checks. A windowless Windows Electron
39.8.10 check also created a real owned fallback PTY, recovered output produced
before attachment, and verified both owned processes exited. These checks do not
claim Mac runtime, signed-package or durable app-restart acceptance.
