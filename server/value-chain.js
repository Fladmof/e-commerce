export const fulfillmentStatuses = [
  'processing',
  'preparing',
  'ready_to_ship',
  'shipped',
  'delivered',
  'cancelled'
]

export const returnStatuses = ['none', 'requested', 'approved', 'rejected', 'received']

const fulfillmentTransitions = {
  processing: ['preparing'],
  preparing: ['ready_to_ship'],
  ready_to_ship: ['shipped'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: []
}

const returnTransitions = {
  none: ['requested'],
  requested: ['approved', 'rejected'],
  approved: ['received'],
  rejected: ['requested'],
  received: []
}

export function canUpdateFulfillment(current, next, isRefunded = false) {
  if (!fulfillmentStatuses.includes(next)) return false
  if (current === next) return true
  if (isRefunded) return false
  return fulfillmentTransitions[current]?.includes(next) || false
}

export function canUpdateReturn(current, next) {
  if (!returnStatuses.includes(next)) return false
  if (current === next) return true
  return returnTransitions[current]?.includes(next) || false
}

export function getPayoutSettlementStatus(current) {
  if (current === 'pending') return 'paid'
  if (current === 'recovery_required') return 'recovered'
  return null
}

export function getSellerPayouts(items) {
  const payouts = new Map()
  for (const item of items) {
    if (!item.sellerId) continue

    const quantity = Number(item.quantity)
    const unitPrice = Number(item.sellerUnitPrice)
    const currency = item.sellerCurrency || 'EUR'
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      !Number.isFinite(unitPrice) ||
      unitPrice <= 0 ||
      !['EUR', 'AOA'].includes(currency)
    ) {
      throw new Error('Os dados do repasse do vendedor são inválidos.')
    }

    const existing = payouts.get(item.sellerId)
    if (existing && existing.currency !== currency) {
      throw new Error('Um vendedor não pode receber moedas diferentes na mesma encomenda.')
    }
    payouts.set(item.sellerId, {
      sellerId: item.sellerId,
      currency,
      amount: (existing?.amount || 0) + unitPrice * quantity
    })
  }

  return [...payouts.values()].map((payout) => ({
    ...payout,
    amount: Math.round(payout.amount * 100) / 100
  }))
}
