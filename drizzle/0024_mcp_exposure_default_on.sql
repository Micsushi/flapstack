-- Product MCP is now available by default for every currently supported chat.
-- Users can still disable individual chats from the MCP widget.
UPDATE `chats`
SET `mcp_exposure_enabled` = true
WHERE `harness` IN ('codex', 'claude', 'claude-code');
