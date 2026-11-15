import crypto from 'crypto'

export const proxypayVersion = 'application/vnd.proxypay.v2+json'
const allowedProxyPayHosts = new Set(['api.proxypay.co.ao', 'api.sandbox.proxypay.co.ao'])

export function formatAoaAmount(amount) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('O valor do pagamento ProxyPay é inválido.')
  }
  return (Math.round(amount * 100) / 100).toFixed(2)
}

export function parseAoaCents(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!match) return null
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

export function parseProxyPayReferenceId(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  const id = typeof parsed === 'number' ? parsed : Number(parsed?.id)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('O ProxyPay devolveu uma referência inválida.')
  }
  return String(id)
}

export function verifyProxyPaySignature(rawBody, signature, apiKey) {
  if (
    !Buffer.isBuffer(rawBody) ||
    typeof signature !== 'string' ||
    !/^[0-9a-f]{64}$/.test(signature) ||
    !apiKey
  ) return false
  const expected = crypto.createHmac('sha256', apiKey).update(rawBody).digest()
  let received
  try {
    received = Buffer.from(signature, 'hex')
  } catch {
    return false
  }
  return received.length === expected.length && crypto.timingSafeEqual(expected, received)
}

export function calculateProxyPayTotals(items, aoaPerEur, shippingAoa) {
  if (!Array.isArray(items) || !items.length || !Number.isFinite(aoaPerEur) || aoaPerEur <= 0) {
    throw new Error('Não foi possível calcular o total em AOA.')
  }
  if (!Number.isFinite(shippingAoa) || shippingAoa < 0) {
    throw new Error('O custo de envio em AOA é inválido.')
  }

  const lineItems = []
  const totals = items.reduce((result, item) => {
    const price = Number(item.product.price)
    const baseAoa = item.product.priceCurrency === 'AOA'
      ? Math.round(price)
      : Math.round(price * aoaPerEur)
    if (!Number.isFinite(baseAoa) || baseAoa <= 0) {
      throw new Error(`O preço em AOA de ${item.product.name} é inválido.`)
    }
    const commissionAoa = Math.round(baseAoa * 0.02)
    result.subtotalAoa += baseAoa * item.quantity
    result.commissionAoa += commissionAoa * item.quantity
    lineItems.push({
      productId: item.product.id,
      quantity: item.quantity,
      unitPriceAoa: baseAoa,
      commissionUnitPriceAoa: commissionAoa
    })
    return result
  }, { subtotalAoa: 0, commissionAoa: 0 })

  return {
    ...totals,
    lineItems,
    shippingAoa,
    totalAoa: totals.subtotalAoa + totals.commissionAoa + shippingAoa
  }
}

export function createProxyPayClient({
  apiKey,
  baseUrl = 'https://api.sandbox.proxypay.co.ao',
  fetchImpl = fetch
}) {
  const base = new URL(baseUrl)
  if (
    base.protocol !== 'https:' ||
    !allowedProxyPayHosts.has(base.hostname) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  ) {
    throw new Error('O endpoint ProxyPay deve usar HTTPS e um domínio oficial ProxyPay.')
  }

  const request = async (path, options = {}) => {
    let response
    try {
      response = await fetchImpl(new URL(path, base), {
        ...options,
        signal: AbortSignal.timeout(10000),
        headers: {
          Accept: proxypayVersion,
          Authorization: `Token ${apiKey}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers
        }
      })
    } catch (error) {
      const requestError = new Error('Não foi possível contactar o ProxyPay.')
      requestError.status = 502
      requestError.cause = error
      throw requestError
    }
    if (!response.ok) {
      const error = new Error(`O ProxyPay recusou o pedido (HTTP ${response.status}).`)
      error.status = 502
      throw error
    }
    return response
  }

  return {
    async generateReferenceId() {
      const response = await request('/reference_ids', { method: 'POST' })
      return parseProxyPayReferenceId(await response.text())
    },
    async createReference(referenceId, { amount, endDatetime, orderId, callbackUrl }) {
      return request(`/references/${encodeURIComponent(referenceId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          amount: formatAoaAmount(amount),
          end_datetime: endDatetime,
          custom_fields: {
            order_id: orderId,
            callback_url: callbackUrl
          }
        })
      })
    },
    async deleteReference(referenceId) {
      return request(`/references/${encodeURIComponent(referenceId)}`, { method: 'DELETE' })
    }
  }
}
