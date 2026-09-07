ALTER TABLE `diff_annotations` ADD `last_feedback_batch_id` text REFERENCES diff_feedback_batches(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `diff_annotations` ADD `last_feedback_version` integer;
--> statement-breakpoint
WITH selections AS (
  SELECT a.id AS comment_id, b.id AS batch_id, json_extract(j.value, '$.version') AS version,
    row_number() OVER (PARTITION BY a.id ORDER BY json_extract(j.value, '$.version') DESC, b.created_at DESC, b.id DESC) AS rank
  FROM diff_feedback_batches b,
    json_each(CASE WHEN json_valid(b.selection) THEN b.selection ELSE '[]' END) j
  JOIN diff_annotations a ON a.id = json_extract(j.value, '$.id')
    AND a.chat_id = b.chat_id AND a.project_id = b.project_id
  WHERE j.type = 'object' AND json_type(j.value, '$.version') = 'integer'
    AND json_extract(j.value, '$.version') BETWEEN 1 AND a.version
)
UPDATE diff_annotations SET (last_feedback_batch_id, last_feedback_version) = (
  SELECT batch_id, version FROM selections WHERE comment_id = diff_annotations.id AND rank = 1
)
WHERE EXISTS (SELECT 1 FROM selections WHERE comment_id = diff_annotations.id AND rank = 1);
