const readMessagesKey = (userId) => `shopco-read-messages:${encodeURIComponent(String(userId))}`

export function getReadMessages(userId) {
  try {
    const stored = localStorage.getItem(readMessagesKey(userId))
    const messages = stored ? JSON.parse(stored) : {}
    return messages && typeof messages === 'object' && !Array.isArray(messages) ? messages : {}
  } catch {
    return {}
  }
}

export function markConversationRead(userId, conversationId, messageId) {
  if (!messageId) return
  const messages = getReadMessages(userId)
  messages[conversationId] = messageId
  localStorage.setItem(readMessagesKey(userId), JSON.stringify(messages))
}

export const isConversationUnread = (conversation, userId, readMessages) =>
  Boolean(
    conversation.lastMessageId &&
    String(conversation.lastSenderId) !== String(userId) &&
    readMessages[conversation.id] !== conversation.lastMessageId
  )

export const getUnreadConversationIds = (conversations, userId, readMessages) =>
  conversations.filter((conversation) => isConversationUnread(conversation, userId, readMessages))
    .map((conversation) => conversation.id)
