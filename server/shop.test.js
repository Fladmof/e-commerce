import test from 'node:test'
import assert from 'node:assert/strict'
import { releaseInventory, reserveInventory, resolveCartItems } from './shop.js'

const products = [
  { id: 'shirt', name: 'T-shirt', price: 12.5, stock: 3 },
  { id: 'hat', name: 'Boné', price: 8, stock: 0 }
]

test('uses catalog prices instead of client-supplied prices', () => {
  const [item] = resolveCartItems([{ id: 'shirt', quantity: 2, price: 0.01 }], products)

  assert.equal(item.unitAmount, 1250)
  assert.equal(item.quantity, 2)
})

test('rejects empty carts and invalid quantities', () => {
  assert.throws(() => resolveCartItems([], products), /entre 1 e 50/)
  assert.throws(() => resolveCartItems([{ id: 'shirt', quantity: 0 }], products), /quantidade/)
  assert.throws(() => resolveCartItems([{ id: 'shirt', quantity: 1.5 }], products), /quantidade/)
})

test('rejects missing products, duplicate products, and insufficient stock', () => {
  assert.throws(() => resolveCartItems([{ id: 'missing', quantity: 1 }], products), /não encontrado/)
  assert.throws(() => resolveCartItems([{ id: 'hat', quantity: 1 }], products), /Stock insuficiente/)
  assert.throws(
    () => resolveCartItems([{ id: 'shirt', quantity: 1 }, { id: 'shirt', quantity: 1 }], products),
    /duplicado/
  )
})

test('reserves stock at checkout and restores it when checkout expires', () => {
  const checkoutItems = resolveCartItems([{ id: 'shirt', quantity: 2 }], products)

  reserveInventory(products, checkoutItems)
  assert.equal(products[0].stock, 1)
  assert.throws(() => reserveInventory(products, checkoutItems), /Stock insuficiente/)

  releaseInventory(products, [{ productId: 'shirt', quantity: 2 }])
  assert.equal(products[0].stock, 3)
})

test('does not partially reserve stock when any item is unavailable', () => {
  const checkoutItems = resolveCartItems([{ id: 'shirt', quantity: 1 }], products)
  checkoutItems.push({ product: products[1], quantity: 1 })

  assert.throws(() => reserveInventory(products, checkoutItems), /Stock insuficiente/)
  assert.equal(products[0].stock, 3)
})
