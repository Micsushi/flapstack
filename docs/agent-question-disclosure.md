# Agent question panel

Pending and restored questions start as a compact composer notice with a question
count and first-question preview. They do not automatically expand or take the
keyboard away from the composer. Choose **Answer questions** to open the existing
docked panel and focus its first answer control. Minimize preserves draft answers
for the same request. Changing requests or leaving the active pane closes it.

Answer, skip, answer-in-chat, expiry, and harness continuation behavior are
unchanged. Permission approvals remain separate. Every pane has distinct
accessible heading IDs; duplicate option labels retain their stable option IDs.

Component tests cover focus preservation, explicit opening, request changes,
pane activation, selection semantics, and separate accessible labels. These are
not credentialed provider-live delivery tests.
