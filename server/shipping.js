export const deliveryBaseFeeAoa = 500
export const deliveryFeePerKmAoa = 100

export function convertAoaToEurCents(amountAoa, aoaPerEur) {
  if (!Number.isFinite(amountAoa) || amountAoa < 0 || !Number.isFinite(aoaPerEur) || aoaPerEur <= 0) {
    throw new Error('Não é possível converter o custo de envio para EUR.')
  }
  return Math.round(amountAoa / aoaPerEur * 100)
}

export function validateCoordinates(location) {
  if (
    !location ||
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude) ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    const error = new Error('A localização recebida é inválida.')
    error.status = 400
    throw error
  }
  return { latitude: location.latitude, longitude: location.longitude }
}

export async function calculateDeliveryQuote(items, buyerLocation, sellers, getDrivingDistance) {
  const destination = validateCoordinates(buyerLocation)
  const groups = new Map()
  for (const item of items) {
    const sellerId = item.product.sellerId || null
    const group = groups.get(sellerId) || {
      sellerId,
      sellerName: sellerId ? item.product.sellerName || 'Vendedor' : 'Loja',
      products: []
    }
    group.products.push(item.product.name)
    groups.set(sellerId, group)
  }

  const quotes = []
  for (const group of groups.values()) {
    if (!group.sellerId) {
      quotes.push({
        ...group,
        distanceKm: null,
        deliveryFeeAoa: deliveryBaseFeeAoa
      })
      continue
    }

    const seller = sellers.get(group.sellerId)
    if (
      !seller ||
      seller.latitude === null ||
      seller.latitude === undefined ||
      seller.longitude === null ||
      seller.longitude === undefined ||
      !Number.isFinite(Number(seller.latitude)) ||
      !Number.isFinite(Number(seller.longitude))
    ) {
      const error = new Error(
        `O vendedor ${group.sellerName} ainda não configurou a localização de recolha. O checkout não pode calcular o envio.`
      )
      error.status = 409
      throw error
    }
    const distanceMeters = await getDrivingDistance(
      { latitude: Number(seller.latitude), longitude: Number(seller.longitude) },
      destination
    )
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
      throw new Error('O serviço de rotas devolveu uma distância inválida.')
    }
    const distanceKm = distanceMeters / 1000
    quotes.push({
      ...group,
      distanceKm: Math.round(distanceKm * 100) / 100,
      deliveryFeeAoa: Math.round(deliveryBaseFeeAoa + distanceKm * deliveryFeePerKmAoa)
    })
  }

  return {
    sellers: quotes,
    totalAoa: quotes.reduce((total, quote) => total + quote.deliveryFeeAoa, 0)
  }
}
