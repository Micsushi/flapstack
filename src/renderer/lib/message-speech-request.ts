export type MessageSpeechRequestInput = {
  text: string
  chatId?: string
  subChatId?: string
  messageId?: string
}

export function buildMessageSpeechRequest({
  text,
  chatId,
  subChatId,
  messageId,
}: MessageSpeechRequestInput) {
  return {
    text,
    // Message playback speed is controlled by the audio element so it can be
    // changed while playing. Keep synthesis at 1x to avoid applying speed twice.
    rate: 1,
    ...(chatId ? { chatId } : {}),
    ...(subChatId ? { subChatId } : {}),
    ...(messageId ? { messageId } : {}),
  }
}
