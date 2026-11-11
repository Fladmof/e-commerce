import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyStylePreferences,
  normalizeStylePreferences,
  scoreStylePreference
} from './style-preferences.js'

test('normalizes missing preferences and rejects unsupported answers', () => {
  assert.deepEqual(normalizeStylePreferences(), emptyStylePreferences)
  assert.equal(normalizeStylePreferences({ categories: ['desconhecida'] }), null)
  assert.equal(normalizeStylePreferences({ budget: 'free' }), null)
})

test('scores products that match selected category, style, color and budget', () => {
  const product = {
    category: 'camisetas',
    name: 'T-shirt Preta',
    description: 'Peça casual para uso diário.'
  }

  assert.equal(scoreStylePreference(product, {
    categories: ['camisetas'],
    styles: ['casual'],
    colors: ['preto'],
    budget: '50-100'
  }, 75), 8)
  assert.equal(scoreStylePreference(product, emptyStylePreferences, 75), 0)
})
