import test from 'node:test'
import assert from 'node:assert/strict'
import { getCartStorageKey } from './cart.js'

test('uses separate cart storage keys for guests and each account', () => {
  assert.notEqual(getCartStorageKey(null), getCartStorageKey('user-1'))
  assert.notEqual(getCartStorageKey('user-1'), getCartStorageKey('user-2'))
  assert.equal(getCartStorageKey('user/1'), 'shopco-cart:user:user%2F1')
})
