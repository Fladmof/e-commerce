import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'crypto'
import {
  calculateProxyPayTotals,
  createProxyPayClient,
  formatAoaAmount,
  parseAoaCents,
  parseProxyPayReferenceId,
  proxypayVersion,
  verifyProxyPaySignature
} from './proxypay.js'

test('formats AOA amounts using two decimal places', () => {
  assert.equal(formatAoaAmount(1234), '1234.00')
  assert.equal(formatAoaAmount(1234.567), '1234.57')
  assert.throws(() => formatAoaAmount(0), /inválido/)
})

test('parses ProxyPay amounts into exact cents', () => {
  assert.equal(parseAoaCents('1234.5'), 123450)
  assert.equal(parseAoaCents(27000), 2700000)
  assert.equal(parseAoaCents('1.234'), null)
  assert.equal(parseAoaCents('1e3'), null)
})

test('parses numeric ProxyPay reference IDs from documented response shapes', () => {
  assert.equal(parseProxyPayReferenceId('475545250'), '475545250')
  assert.equal(parseProxyPayReferenceId('{"id":475545250}'), '475545250')
  assert.throws(() => parseProxyPayReferenceId('"invalid"'), /referência inválida/)
})

test('verifies ProxyPay webhook HMAC signatures against the raw body', () => {
  const body = Buffer.from('{"reference_id":123,"amount":"500.00"}')
  const signature = crypto.createHmac('sha256', 'test-api-key').update(body).digest('hex')

  assert.equal(verifyProxyPaySignature(body, signature, 'test-api-key'), true)
  assert.equal(verifyProxyPaySignature(body, signature.toUpperCase(), 'test-api-key'), false)
  assert.equal(verifyProxyPaySignature(Buffer.from('{}'), signature, 'test-api-key'), false)
})

test('calculates ProxyPay subtotal, commission and delivery in AOA', () => {
  const totals = calculateProxyPayTotals([
    { product: { id: 'camisa', name: 'Camisa', price: 10000, priceCurrency: 'AOA' }, quantity: 2 },
    { product: { id: 'bone', name: 'Boné', price: 5, priceCurrency: 'EUR' }, quantity: 1 }
  ], 1000, 1500)

  assert.deepEqual(totals, {
    subtotalAoa: 25000,
    commissionAoa: 500,
    shippingAoa: 1500,
    lineItems: [
      { productId: 'camisa', quantity: 2, unitPriceAoa: 10000, commissionUnitPriceAoa: 200 },
      { productId: 'bone', quantity: 1, unitPriceAoa: 5000, commissionUnitPriceAoa: 100 }
    ],
    totalAoa: 27000
  })
})

test('creates RPS references with the v2 API and validates HTTPS', async () => {
  const requests = []
  const client = createProxyPayClient({
    apiKey: 'secret',
    baseUrl: 'https://api.sandbox.proxypay.co.ao',
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options })
      if (String(url).endsWith('/reference_ids')) {
        return new Response('123456789', { status: 200 })
      }
      return new Response(null, { status: 204 })
    }
  })

  assert.equal(await client.generateReferenceId(), '123456789')
  await client.createReference('123456789', {
    amount: 27000,
    endDatetime: '2026-11-16T00:00:00Z',
    orderId: 'internal-order-id',
    callbackUrl: 'https://shop.example/api/webhooks/proxypay'
  })

  assert.equal(requests[0].options.headers.Authorization, 'Token secret')
  assert.equal(requests[0].options.headers.Accept, proxypayVersion)
  assert.equal(requests[1].options.method, 'PUT')
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    amount: '27000.00',
    end_datetime: '2026-11-16T00:00:00Z',
    custom_fields: {
      order_id: 'internal-order-id',
      callback_url: 'https://shop.example/api/webhooks/proxypay'
    }
  })
  assert.throws(
    () => createProxyPayClient({ apiKey: 'secret', baseUrl: 'http://api.example' }),
    /HTTPS/
  )
  assert.throws(
    () => createProxyPayClient({ apiKey: 'secret', baseUrl: 'https://api.example' }),
    /domínio oficial ProxyPay/
  )
})
