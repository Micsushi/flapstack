UPDATE `usage_alert_arm_states`
SET `threshold_value` = ROUND(`threshold_value` * 1000000)
WHERE `threshold_value` IS NOT NULL;
