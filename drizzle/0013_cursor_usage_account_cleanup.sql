DELETE FROM `usage_provider_states`
WHERE `provider_id` = 'cursor'
  AND `account_tag` IN ('internal', 'admin', 'cli');
