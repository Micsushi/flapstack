# Finding local automations

The Local automations page shows saved automations, their trigger, state and
approval status. Open a row to inspect its configuration and run history.

The first page contains up to 100 records. Use **Load more automations** to include
older records. Search and state filters apply to loaded records; the page says
when more remain. A failed next page keeps the existing rows visible and offers
Retry. **Include archived automations** makes archived entries discoverable
without restoring or running them.

Archived configuration is read-only; an already running occurrence can still be
stopped. Editing a current automation preserves local
typing when its saved definition changes in the background and asks for another
review. Confirmations apply only to the saved version and draft shown in their
preview; a changed version or draft requires a new preview.

The inbox and each automation's history have their own **Load more** controls.
Their stable ordering uses creation time and a unique ID, so read marking and
execution-state changes do not move the page boundary. Failed page loads retain
the existing items and offer retry. Changing the automation or unread filter
starts a separate feed.

The inbox badge counts all unread items in the selected scope, including unloaded
pages. Mark all read includes those unseen items. A failed read update keeps the
item selected and reports the error instead of opening a run as though it saved.
Keyboard selection stays on the same item when new items arrive. Read acknowledgements
do not overwrite a newer feed or unread count. After a successful read update,
a refresh failure keeps the confirmation visible while the feed offers retry.
