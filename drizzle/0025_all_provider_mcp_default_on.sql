-- Extend default-on product MCP to every Stage 3 provider harness.
-- Explicit user opt-outs remain off; this only backfills rows still at the legacy default.
UPDATE `chats`
SET `mcp_exposure_enabled` = true
WHERE `harness` IN ('cursor-agent', 'openrouter', 'nanogpt')
  AND `mcp_exposure_enabled` = false;
