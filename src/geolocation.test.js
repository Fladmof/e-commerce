import test from 'node:test'
import assert from 'node:assert/strict'
import { getCurrentCoordinates } from './geolocation.js'

test('rejects geolocation on non-secure pages with an actionable message', async () => {
  await assert.rejects(
    getCurrentCoordinates({ isSecureContext: false, geolocation: {} }),
    /HTTPS ou em localhost/
  )
})

test('requests location without requiring high-accuracy GPS', async () => {
  let receivedOptions
  const coordinates = await getCurrentCoordinates({
    isSecureContext: true,
    geolocation: {
      getCurrentPosition(success, _failure, options) {
        receivedOptions = options
        success({ coords: { latitude: -8.8383, longitude: 13.2344 } })
      }
    }
  })

  assert.deepEqual(coordinates, { latitude: -8.8383, longitude: 13.2344 })
  assert.deepEqual(receivedOptions, {
    enableHighAccuracy: false,
    timeout: 30000,
    maximumAge: 30000
  })
})

test('explains denied permission, unavailable position and timeouts', async () => {
  for (const [code, message] of [
    [1, /permissão de localização foi recusada/],
    [2, /não conseguiu determinar a localização/],
    [3, /demorou demasiado/]
  ]) {
    await assert.rejects(
      getCurrentCoordinates({
        isSecureContext: true,
        geolocation: {
          getCurrentPosition(_success, failure) {
            failure({ code })
          }
        }
      }),
      message
    )
  }
})
