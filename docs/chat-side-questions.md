# Replies and side questions

Choose **Reply** from a message's options to reference your message or an agent's message. The composer shows the reference before sending. Remove it with the close button. The selected text is captured when you choose Reply and stays with drafts and queued messages. Editing a sent reply preserves its reference.

Choose **Side question** to ask about the conversation while the main agent keeps working. Answers use a snapshot of the visible conversation and public activity at the moment you ask. They cannot inspect files, run tools, change the project, or redirect the main task. A snapshot may omit older or very long messages; the responder is told when context is shortened.

Follow-up questions stay in the side conversation. Stop cancels only that side answer. Closing the panel keeps its draft and does not stop the answer. Retry reuses the failed question's captured context. Choose **Continue in new chat** to keep the exchange as a separate chat, including its captured source context. Promotion does not start an agent automatically.

Side questions support Codex, Claude, and configured local Ollama models. They use the source conversation's provider/model selection. Unsupported providers show an error rather than silently switching providers. Provider usage limits and credentials still apply.

Side answers and captured context are stored locally with their source conversation. They are separate from the main transcript until explicitly promoted. The current limits are four concurrent side answers across the app, 200 side questions per source conversation, and three minutes per answer. An interrupted answer can be retried after restarting the app.
