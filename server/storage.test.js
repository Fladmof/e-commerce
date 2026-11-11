import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { createImageKey, deleteStoredImage, localStorageEnabled, storeImage } from './storage.js'

test('names profile images from the account name and a unique user identifier', () => {
  const file = { mimetype: 'image/jpeg' }
  const first = createImageKey(file, { name: 'João da Silva', id: 'user-123' })
  const second = createImageKey(file, { name: 'João da Silva', id: 'user-123' })

  assert.match(first, /^uploads\/perfis\/joao-da-silva-user-123-[0-9a-f-]{36}\.jpg$/)
  assert.notEqual(first, second)
})

test('keeps product image keys random and rejects unsupported image types', () => {
  assert.match(createImageKey({ mimetype: 'image/png' }), /^uploads\/[0-9a-f-]{36}\.png$/)
  assert.throws(
    () => createImageKey({ mimetype: 'image/svg+xml' }),
    { message: 'Formato de imagem não suportado', status: 400 }
  )
})

test('stores and deletes images locally when S3 is not configured outside production', {
  skip: !localStorageEnabled
}, async () => {
  const image = await storeImage({
    mimetype: 'image/png',
    buffer: Buffer.from('local-image')
  })
  const localDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads')
  const imagePath = path.join(localDirectory, ...image.key.split('/').slice(1))

  assert.match(image.key, /^uploads\/local\/[0-9a-f-]{36}\.png$/)
  assert.equal(image.url, `/${image.key}`)
  assert.equal(await fs.readFile(imagePath, 'utf8'), 'local-image')

  await deleteStoredImage(image.key)
  await assert.rejects(fs.access(imagePath), { code: 'ENOENT' })
})
