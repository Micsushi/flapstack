# Scoped search recovery

Workspace context search distinguishes loading, successful empty results, and
failure. A failed query shows a Retry search button rather than “No results”.
Previously loaded results remain navigable and are explicitly labeled when a
refresh fails. Raw database errors are not displayed in the panel.

The same feedback component drives file discovery and context search. File
discovery retains its actionable bounded-discovery error and keyboard-safe retry.

Project, task, and chat scopes require a nonempty selected ID at the server
boundary. A missing ID is rejected, never treated as permission to search all
context. Whitespace-only queries are rejected. Archive filtering, message
visibility rules and client-side result paging are preserved. Queries match
literal text, including percent signs, underscores and decoded message JSON.

The sidebar search field drives context search directly. Project scope is
available from a selected project without requiring an open chat. Opening a chat
or message result resolves its current project and conversation before changing
selection, including archived and global chats. Failed lookups and denied window
claims preserve the current selection, query and drafts. Arrow keys navigate
results; Escape dismisses the panel without clearing the query. Project and
historical task metadata results remain informational.

This repair does not implement streamed search or unified Quick Open. It does not
claim a bound on the legacy database scan or introduce silently truncated results.
