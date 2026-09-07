# Durable run queue

The main-owned queue records a pending run before dispatch. Queueing alone does
not start a provider process. The existing dispatcher waits for running work in
the same conversation, claims through the usage-budget gate, and uses the frozen
runtime and permission snapshot.

Internal callers may select an owned `subChatId`. An explicit missing or foreign
conversation fails instead of falling back. Callers that omit it retain the
first-conversation default, ordered by creation time and ID. The selected
conversation supplies its harness, model and permission mode, with existing
Chat defaults where the conversation has no override.

Queueing behind an active run keeps the conversation's status `running`. It does
not replace active work or weaken launch permissions. Pending runs remain visible
in durable run state until the dispatcher can claim them.

Retries use the same Chat and idempotency key. Reusing a key with a different
conversation, prompt or vault selection fails rather than returning an unrelated
earlier run. Existing native/direct-runtime recovery and cancellation policies
are unchanged.

The Claude router preserves explicit prompt-message identity: distinct IDs remain
distinct turns even with identical text, and an already persisted ID is reused
without appending it again. Changed text under that ID fails before provider
dispatch. Callers without an ID retain the legacy last-message text fallback.
This transcript check does not make provider execution replay-safe by itself.

`tests/chat-run-queue-target.test.ts` covers explicit targets, foreign/missing
targets, per-conversation harness choice, active status, exact retry and conflicting
reuse. Mutation-service, Chat-wait and main-launcher tests cover the existing
callers. Diff feedback still requires its own durable comment-to-turn linkage;
the queue alone does not establish send-to-agent acceptance.
