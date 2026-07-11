DELETE FROM `attachments`
WHERE `operation_id` IS NOT NULL
  AND `id` NOT IN (
    SELECT COALESCE(
      MAX(CASE WHEN `attachments`.`id` = `flapshot_operations`.`result_attachment_id`
        THEN `attachments`.`id` END),
      MIN(`attachments`.`id`)
    )
    FROM `attachments`
    LEFT JOIN `flapshot_operations`
      ON `flapshot_operations`.`operation_id` = `attachments`.`operation_id`
    WHERE `attachments`.`operation_id` IS NOT NULL
    GROUP BY `attachments`.`operation_id`
  );--> statement-breakpoint
UPDATE `flapshot_operations`
SET `result_attachment_id` = (
  SELECT `id` FROM `attachments`
  WHERE `attachments`.`operation_id` = `flapshot_operations`.`operation_id`
)
WHERE `result_attachment_id` IS NULL
  AND EXISTS (
    SELECT 1 FROM `attachments`
    WHERE `attachments`.`operation_id` = `flapshot_operations`.`operation_id`
  );--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_operation_id_unique` ON `attachments` (`operation_id`);
