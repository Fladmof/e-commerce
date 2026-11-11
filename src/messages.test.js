import test from 'node:test'
import assert from 'node:assert/strict'
import { getUnreadConversationIds, isConversationUnread } from './messages.js'

test('marks only unseen messages from another user as unread', () => {
  const conversation = {
    id: 'conversation-1',
    lastMessageId: 'message-2',
    lastSenderId: 'user-2'
  }

  assert.equal(isConversationUnread(conversation, 'user-1', {}), true)
  assert.equal(isConversationUnread(conversation, 'user-2', {}), false)
  assert.equal(isConversationUnread(conversation, 'user-1', { 'conversation-1': 'message-2' }), false)
  assert.deepEqual(getUnreadConversationIds([
    conversation,
    { id: 'conversation-2', lastMessageId: null, lastSenderId: null }
  ], 'user-1', {}), ['conversation-1'])
})
