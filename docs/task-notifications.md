# Task notifications

Completion, error and input alerts retain the originating Chat and sub-chat
identifiers. Rapid alerts are coalesced within each task's three-second cooldown,
with errors taking priority. A different task has its own delivery slot. Turning
notifications off or closing the notification owner cancels queued deliveries;
expired slots are released.

Clicking a notification loads lightweight Chat metadata, restores its project and
queues the exact sub-chat navigation. When clicks overlap, only the most recent
metadata result may navigate. Deleted Chats and responses received after listener
teardown do not reopen an earlier target.

Native clicks resolve the Chat's current window owner. If that owner is absent,
they use the original live window or another live window. Closing the originating
window or moving the Chat does not discard the target while another window is
available. No new window is created when all windows are closed.

Local component tests cover simultaneous tasks, priority, preference changes,
teardown, reversed metadata response order and window ownership/closure routing.
Native notification permissions, OS notification-center behavior and cross-device
delivery require separate installed-platform evidence.
