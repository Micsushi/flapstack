# Saved workspace conflict recovery

Each saved layout has a version. When another window saves first, a rejected
save keeps this window's layout and pauses autosave. A newer saved snapshot
replaces the local layout only when it has no pending layout edits. Previously
retained drafts with an older version reopen as drafts needing a decision.

The recovery controls are available in the main workspace and popout windows:

- **Retry save** retries the retained draft against its original version. It
  cannot overwrite a newer version by bypassing the conflict check.
- **Save a copy** saves a manual workspace draft as a separate manual workspace
  in the same scope. The original draft remains open. A confirmed copy of the
  current revision permits closing; any later edits need saving again.
  Operation-owned workspaces cannot be copied as manual workspaces.
- **Discard changes and reload** asks for confirmation and reads the latest
  saved layout before clearing this window's layout draft. Failed reads or
  edits made while the read is pending preserve the draft.

Closing with unsaved changes focuses the recovery controls. After a successful
save, a confirmed copy of the current revision, or an explicit successful reload,
closing is permitted. Reloading layout does not discard a separately typed name.
Draft recovery uses the existing tab session storage and is not a durable backup.

Selecting a tab in a popout or a window showing only part of the layout changes
that window's focus without saving a shared layout version. Existing chat and
process ownership rules are unchanged.
