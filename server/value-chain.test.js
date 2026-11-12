import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canUpdateFulfillment,
  canUpdateReturn,
  getPayoutSettlementStatus,
  getSellerPayouts
} from './value-chain.js'

test('allows fulfillment to advance while preventing skipped or reversed stages', () => {
  assert.equal(canUpdateFulfillment('processing', 'preparing'), true)
  assert.equal(canUpdateFulfillment('preparing', 'ready_to_ship'), true)
  assert.equal(canUpdateFulfillment('processing', 'delivered'), false)
  assert.equal(canUpdateFulfillment('shipped', 'preparing'), false)
  assert.equal(canUpdateFulfillment('delivered', 'processing'), false)
  assert.equal(canUpdateFulfillment('processing', 'preparing', true), false)
})

test('allows return requests to be reviewed, received and reopened after rejection', () => {
  assert.equal(canUpdateReturn('none', 'requested'), true)
  assert.equal(canUpdateReturn('requested', 'approved'), true)
  assert.equal(canUpdateReturn('approved', 'received'), true)
  assert.equal(canUpdateReturn('requested', 'received'), false)
  assert.equal(canUpdateReturn('rejected', 'requested'), true)
  assert.equal(canUpdateReturn('received', 'requested'), false)
})

test('groups seller proceeds by seller and currency, excluding store-owned products', () => {
  assert.deepEqual(getSellerPayouts([
    { sellerId: 'seller-1', sellerUnitPrice: 1250, sellerCurrency: 'AOA', quantity: 2 },
    { sellerId: 'seller-1', sellerUnitPrice: 500, sellerCurrency: 'AOA', quantity: 1 },
    { sellerId: 'seller-2', sellerUnitPrice: 12.5, sellerCurrency: 'EUR', quantity: 2 },
    { sellerId: null, sellerUnitPrice: 10, sellerCurrency: 'EUR', quantity: 1 }
  ]), [
    { sellerId: 'seller-1', currency: 'AOA', amount: 3000 },
    { sellerId: 'seller-2', currency: 'EUR', amount: 25 }
  ])
})

test('rejects invalid seller payout data and mixed currencies for one seller', () => {
  assert.throws(() => getSellerPayouts([
    { sellerId: 'seller', sellerUnitPrice: -1, sellerCurrency: 'AOA', quantity: 1 }
  ]), /repasse/)
  assert.throws(() => getSellerPayouts([
    { sellerId: 'seller', sellerUnitPrice: 100, sellerCurrency: 'AOA', quantity: 1 },
    { sellerId: 'seller', sellerUnitPrice: 10, sellerCurrency: 'EUR', quantity: 1 }
  ]), /moedas diferentes/)
})

test('only settles outstanding seller payouts and requires recovery for paid refunds', () => {
  assert.equal(getPayoutSettlementStatus('pending'), 'paid')
  assert.equal(getPayoutSettlementStatus('recovery_required'), 'recovered')
  assert.equal(getPayoutSettlementStatus('paid'), null)
  assert.equal(getPayoutSettlementStatus('cancelled'), null)
})
