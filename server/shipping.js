export const deliveryBaseFeeAoa = 500
export const deliveryFeePerKmAoa = 100
const geocodeCache = new Map()
const cacheLimit = 1000
const geocodeCacheTtlMs = 24 * 60 * 60 * 1000

const getCachedValue = (cache, key) => {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return undefined
  }
  return entry.value
}

const cacheValue = (cache, key, value, ttlMs) => {
  if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value)
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
  return value
}

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

export async function searchDeliveryLocations(query, { apiKey, fetchImpl = fetch } = {}) {
  const text = typeof query === 'string' ? query.trim() : ''
  if (text.length < 3 || text.length > 200) {
    const error = new Error('Indica uma morada ou localidade com 3 a 200 caracteres.')
    error.status = 400
    throw error
  }
  if (!apiKey) {
    const error = new Error('A pesquisa de moradas requer GOOGLE_MAPS_API_KEY no servidor.')
    error.status = 503
    throw error
  }
  const normalizedQuery = text.replace(/\s+/g, ' ').toLocaleLowerCase('pt-AO')
  const cachedResults = getCachedValue(geocodeCache, normalizedQuery)
  if (cachedResults) return cachedResults.map((location) => ({ label: text, ...location }))

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', text)
  url.searchParams.set('components', 'country:AO')
  url.searchParams.set('language', 'pt')
  url.searchParams.set('key', apiKey)

  let response
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(10000) })
  } catch (cause) {
    const error = new Error('Não foi possível contactar o serviço de pesquisa de moradas.')
    error.status = 502
    error.cause = cause
    throw error
  }
  if (!response.ok) {
    const error = new Error('O serviço de pesquisa de moradas está indisponível. Tenta novamente mais tarde.')
    error.status = response.status === 429 || response.status === 403 ? 503 : 502
    throw error
  }

  let data
  try {
    data = await response.json()
  } catch (cause) {
    const error = new Error('O serviço de pesquisa de moradas devolveu uma resposta inválida.')
    error.status = 502
    error.cause = cause
    throw error
  }

  if (!['OK', 'ZERO_RESULTS'].includes(data?.status)) {
    const error = new Error(data?.status === 'OVER_QUERY_LIMIT'
      ? 'O limite de pedidos do Google Maps foi atingido. Tenta novamente mais tarde.'
      : 'O Google Maps não conseguiu pesquisar esta morada. Verifica a configuração da Geocoding API.')
    error.status = data?.status === 'OVER_QUERY_LIMIT' ? 429 : 503
    throw error
  }

  const locations = (Array.isArray(data?.results) ? data.results : [])
    .map((result) => {
      const label = typeof result?.formatted_address === 'string' ? result.formatted_address.trim() : ''
      const country = result?.address_components?.find((component) =>
        component.types?.includes('country')
      )?.short_name
      if (!label || country?.toUpperCase() !== 'AO') return null
      try {
        const location = validateCoordinates({
          longitude: Number(result.geometry?.location?.lng),
          latitude: Number(result.geometry?.location?.lat)
        })
        return { label, ...location }
      } catch {
        return null
      }
    })
    .filter(Boolean)
  const limitedLocations = locations.slice(0, 5)
  cacheValue(
    geocodeCache,
    normalizedQuery,
    limitedLocations.map(({ latitude, longitude }) => ({ latitude, longitude })),
    geocodeCacheTtlMs
  )
  return limitedLocations
}

export async function getDrivingDistance(origin, destination, { apiKey, fetchImpl = fetch } = {}) {
  const start = validateCoordinates(origin)
  const end = validateCoordinates(destination)
  if (!apiKey) {
    const error = new Error('O cálculo de envio requer GOOGLE_MAPS_API_KEY no servidor.')
    error.status = 503
    throw error
  }
  let response
  try {
    response = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters'
      },
      body: JSON.stringify({
        origin: {
          location: { latLng: { latitude: start.latitude, longitude: start.longitude } }
        },
        destination: {
          location: { latLng: { latitude: end.latitude, longitude: end.longitude } }
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        computeAlternativeRoutes: false,
        languageCode: 'pt',
        units: 'METRIC'
      }),
      signal: AbortSignal.timeout(10000)
    })
  } catch (cause) {
    const error = new Error('Não foi possível contactar o serviço de rotas Google Maps.')
    error.status = 502
    error.cause = cause
    throw error
  }
  if (!response.ok) {
    const error = new Error(response.status === 403
      ? 'O Google Maps Routes API não está disponível. Verifica a ativação da API e a chave do servidor.'
      : 'O serviço de rotas Google Maps está indisponível. Tenta novamente mais tarde.')
    error.status = response.status === 429 ? 503 : 502
    if (response.status === 403) error.status = 503
    throw error
  }

  let data
  try {
    data = await response.json()
  } catch (cause) {
    const error = new Error('O serviço de rotas Google Maps devolveu uma resposta inválida.')
    error.status = 502
    error.cause = cause
    throw error
  }
  const distance = data?.routes?.[0]?.distanceMeters
  if (!Number.isFinite(distance) || distance < 0) {
    const error = new Error('O Google Maps não encontrou um percurso válido entre as localizações.')
    error.status = 422
    throw error
  }
  return distance
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
