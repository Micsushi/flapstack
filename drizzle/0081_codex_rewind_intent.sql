ALTER TABLE sub_chats ADD COLUMN codex_rewind_intent TEXT;--> statement-breakpoint
ALTER TABLE sub_chats ADD COLUMN codex_rewind_discarded TEXT;--> statement-breakpoint
CREATE TRIGGER sub_chats_codex_rewind_changes
BEFORE UPDATE OF messages, session_id, harness ON sub_chats
WHEN OLD.codex_rewind_intent IS NOT NULL AND NEW.codex_rewind_intent IS NOT NULL
  AND (OLD.messages IS NOT NEW.messages OR OLD.session_id IS NOT NEW.session_id OR OLD.harness IS NOT NEW.harness)
BEGIN
  SELECT RAISE(ABORT, 'This conversation has an unconfirmed Codex rewind.');
END;--> statement-breakpoint
CREATE TRIGGER agent_runs_codex_rewind_guard
BEFORE INSERT ON agent_runs
WHEN EXISTS (
  SELECT 1 FROM sub_chats WHERE id = NEW.sub_chat_id AND codex_rewind_intent IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Confirm the pending Codex rewind before sending another turn.');
END;
