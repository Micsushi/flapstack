-- Preserve every existing chat's MCP exposure choice. New supported chats are
-- created with exposure enabled by their creation service; legacy false rows
-- cannot be distinguished safely from explicit user opt-outs.
SELECT 1;
