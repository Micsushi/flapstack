UPDATE chats SET model = 'gpt-5.6-sol' || substr(model, 8)
WHERE (harness = 'codex' OR harness IS NULL)
  AND (model = 'gpt-5.5' OR model GLOB 'gpt-5.5/*' OR model LIKE 'gpt-5.5[%');
--> statement-breakpoint
UPDATE sub_chats SET model = 'gpt-5.6-sol' || substr(model, 8)
WHERE (harness = 'codex' OR harness IS NULL)
  AND (model = 'gpt-5.5' OR model GLOB 'gpt-5.5/*' OR model LIKE 'gpt-5.5[%');
--> statement-breakpoint
UPDATE automations SET model = 'gpt-5.6-sol' || substr(model, 8)
WHERE harness = 'codex' AND
  (model = 'gpt-5.5' OR model GLOB 'gpt-5.5/*' OR model LIKE 'gpt-5.5[%');
