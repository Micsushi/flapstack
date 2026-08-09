ALTER TABLE `chat_tags` ADD `icon` text;
--> statement-breakpoint
UPDATE `chat_tags`
SET `icon` = CASE `id`
  WHEN 'starter-important' THEN 'alert'
  WHEN 'starter-blocked' THEN 'ban'
  WHEN 'starter-follow-up' THEN 'reply'
  WHEN 'starter-review' THEN 'eye'
  WHEN 'starter-waiting' THEN 'clock'
END
WHERE `id` IN (
  'starter-important',
  'starter-blocked',
  'starter-follow-up',
  'starter-review',
  'starter-waiting'
);
