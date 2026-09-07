# Terminal session ownership

Exit events and delayed cleanup belong to a PTY instance, not just its pane ID.
Restarting a terminal in the same pane must not let the previous instance remove
the replacement, unregister its ports, or announce a stale exit. Fallback shell
creation is single-flight with renderer restart requests.

Detach accepts an explicitly empty serialized screen. Omitting the snapshot
preserves the existing value. This distinction prevents cleared terminal state
from being replaced by an older snapshot on reattach.

These repairs do not provide durable terminal journals or ordered snapshot-plus-
stream recovery. The current renderer-supplied detach snapshot still cannot
capture subsequent output while detached. App-restart process restoration,
acknowledged streaming, bounded journal retention and cold parking remain separate
S7 terminal work. Existing shutdown ownership and platform teardown checks remain
in force.
