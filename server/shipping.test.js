import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateDeliveryQuote, convertAoaToEurCents, validateCoordinates } from './shipping.js'

test('validates buyer and seller coordinates before calculating delivery', () => {
  assert.deepEqual(validateCoordinates({ latitude: -8.8, longitude: 13.2 }), {
    latitude: -8.8,
    longitude: 13.2
  })
  assert.throws(() => validateCoordinates({ latitude: 91, longitude: 13 }), { status: 400 })
  assert.throws(() => validateCoordinates({ latitude: 0, longitude: Number.NaN }), { status: 400 })
})

test('converts the AOA shipping total to Stripe EUR cents', () => {
  assert.equal(convertAoaToEurCents(1500, 1000), 150)
  assert.throws(() => convertAoaToEurCents(-1, 1000), /Não é possível converter/)
})

test('charges the base plus per-kilometre fee once for each seller', async () => {
  const products = [
    { id: 'a', name: 'Camisa', sellerId: 'seller-1', sellerName: 'Vendedor 1' },
    { id: 'b', name: 'Calças', sellerId: 'seller-1', sellerName: 'Vendedor 1' },
    { id: 'c', name: 'Casaco', sellerId: 'seller-2', sellerName: 'Vendedor 2' },
    { id: 'd', name: 'Acessório', sellerId: null }
  ]
  const sellers = new Map([
    ['seller-1', { latitude: -8.8, longitude: 13.2 }],
    ['seller-2', { latitude: -8.9, longitude: 13.3 }]
  ])
  const distances = new Map([['seller-1', 2500], ['seller-2', 10000]])
  const quote = await calculateDeliveryQuote(
    products.map((product) => ({ product })),
    { latitude: -8.9, longitude: 13.4 },
    sellers,
    async (origin) => distances.get(origin.latitude === -8.8 ? 'seller-1' : 'seller-2')
  )

  assert.equal(quote.totalAoa, 2750)
  assert.deepEqual(quote.sellers.map(({ sellerId, distanceKm, deliveryFeeAoa }) => ({
    sellerId,
    distanceKm,
    deliveryFeeAoa
  })), [
    { sellerId: 'seller-1', distanceKm: 2.5, deliveryFeeAoa: 750 },
    { sellerId: 'seller-2', distanceKm: 10, deliveryFeeAoa: 1500 },
    { sellerId: null, distanceKm: null, deliveryFeeAoa: 500 }
  ])
})

test('requires a pickup location for every marketplace seller', async () => {
  const item = [{ product: { name: 'Camisa', sellerId: 'seller-1', sellerName: 'Vendedor 1' } }]
  const destination = { latitude: 0, longitude: 0 }

  for (const seller of [undefined, { latitude: null, longitude: null }]) {
    await assert.rejects(
      calculateDeliveryQuote(
        item,
        destination,
        seller ? new Map([['seller-1', seller]]) : new Map(),
        async () => 0
      ),
      { status: 409, message: /ainda não configurou/ }
    )
  }
})
