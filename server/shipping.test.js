import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateDeliveryQuote,
  convertAoaToEurCents,
  getDrivingDistance,
  searchDeliveryLocations,
  validateCoordinates
} from './shipping.js'

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

test('searches Angola delivery locations and returns validated coordinates', async () => {
  let requestUrl
  const locations = await searchDeliveryLocations('Maianga, Luanda', {
    apiKey: 'server-google-key',
    fetchImpl: async (url) => {
      requestUrl = new URL(url)
      return new Response(JSON.stringify({
        status: 'OK',
        results: [
          {
            formatted_address: 'Maianga, Luanda, Angola',
            geometry: { location: { lat: -8.8383, lng: 13.2344 } },
            address_components: [{ short_name: 'AO', types: ['country'] }]
          },
          {
            formatted_address: 'Invalid result',
            geometry: { location: { lat: 100, lng: 300 } },
            address_components: [{ short_name: 'AO', types: ['country'] }]
          },
          {
            formatted_address: 'Result outside Angola',
            geometry: { location: { lat: -8.8, lng: 13.2 } },
            address_components: [{ short_name: 'PT', types: ['country'] }]
          }
        ]
      }), { status: 200 })
    }
  })

  assert.equal(requestUrl.origin, 'https://maps.googleapis.com')
  assert.equal(requestUrl.pathname, '/maps/api/geocode/json')
  assert.equal(requestUrl.searchParams.get('address'), 'Maianga, Luanda')
  assert.equal(requestUrl.searchParams.get('components'), 'country:AO')
  assert.equal(requestUrl.searchParams.get('language'), 'pt')
  assert.equal(requestUrl.searchParams.get('key'), 'server-google-key')
  assert.deepEqual(locations, [{
    label: 'Maianga, Luanda, Angola',
    latitude: -8.8383,
    longitude: 13.2344
  }])
})

test('caches only geocoding coordinates and reports invalid input or service failures', async () => {
  await assert.rejects(searchDeliveryLocations('  '), {
    status: 400
  })
  let requestCount = 0
  const cachedSearch = (query) => searchDeliveryLocations(query, {
    apiKey: 'test-key',
    fetchImpl: async () => {
      requestCount += 1
      return new Response(JSON.stringify({
        status: 'OK',
        results: [{
          formatted_address: 'Google formatted address',
          geometry: { location: { lat: -8.8, lng: 13.2 } },
          address_components: [{ short_name: 'AO', types: ['country'] }]
        }]
      }), { status: 200 })
    }
  })
  await cachedSearch('Maianga cache test')
  const secondResult = await cachedSearch('Maianga cache test')
  assert.equal(requestCount, 1)
  assert.deepEqual(secondResult, [{
    label: 'Maianga cache test',
    latitude: -8.8,
    longitude: 13.2
  }])

  await assert.rejects(
    searchDeliveryLocations('Maianga, Luanda forbidden test', {
      apiKey: 'test-key',
      fetchImpl: async () => new Response(JSON.stringify({ status: 'REQUEST_DENIED' }), { status: 200 })
    }),
    { status: 503, message: /Geocoding API/ }
  )
})

test('gets driving distances from Google Routes API without exposing the API key', async () => {
  let requestUrl
  let requestOptions
  const fetchImpl = async (url, options) => {
    requestUrl = String(url)
    requestOptions = options
    return new Response(JSON.stringify({
      routes: [{ distanceMeters: 3750 }]
    }), { status: 200 })
  }
  const origin = { latitude: -8.83831, longitude: 13.23441 }
  const destination = { latitude: -8.9, longitude: 13.3 }

  assert.equal(await getDrivingDistance(origin, destination, { apiKey: 'server-key', fetchImpl }), 3750)
  assert.equal(requestUrl, 'https://routes.googleapis.com/directions/v2:computeRoutes')
  assert.equal(requestOptions.headers['X-Goog-Api-Key'], 'server-key')
  assert.equal(requestOptions.headers['X-Goog-FieldMask'], 'routes.distanceMeters')
  assert.deepEqual(JSON.parse(requestOptions.body), {
    origin: {
      location: { latLng: { latitude: -8.83831, longitude: 13.23441 } }
    },
    destination: {
      location: { latLng: { latitude: -8.9, longitude: 13.3 } }
    },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE',
    computeAlternativeRoutes: false,
    languageCode: 'pt',
    units: 'METRIC'
  })
})

test('reports when the Google Maps key is missing', async () => {
  await assert.rejects(searchDeliveryLocations('Maianga'), {
    status: 503,
    message: /GOOGLE_MAPS_API_KEY/
  })
  await assert.rejects(getDrivingDistance(
    { latitude: -8.8, longitude: 13.2 },
    { latitude: -8.9, longitude: 13.3 }
  ), {
    status: 503,
    message: /GOOGLE_MAPS_API_KEY/
  })
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
