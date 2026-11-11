import crypto from 'crypto'
import dotenv from 'dotenv'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

dotenv.config()

const localUploadDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads')
const bucket = process.env.S3_BUCKET
const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL?.replace(/\/+$/, '')
if (publicBaseUrl) {
  const parsedPublicBaseUrl = new URL(publicBaseUrl)
  if (parsedPublicBaseUrl.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new Error('Em produção, S3_PUBLIC_BASE_URL deve usar HTTPS.')
  }
}
const configured = Boolean(
  bucket &&
  publicBaseUrl &&
  process.env.S3_ACCESS_KEY_ID &&
  process.env.S3_SECRET_ACCESS_KEY
)
export const localStorageEnabled = !configured && process.env.NODE_ENV !== 'production'

const client = configured
  ? new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(process.env.S3_ENDPOINT),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
      }
    })
  : null

const extensions = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif']
])

const toFileNamePart = (value) => String(value)
  .normalize('NFKD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 60)
  .replace(/-$/g, '')

export function createImageKey(file, owner) {
  const extension = extensions.get(file.mimetype)
  if (!extension) {
    const error = new Error('Formato de imagem não suportado')
    error.status = 400
    throw error
  }

  if (owner?.name && owner?.id) {
    const name = toFileNamePart(owner.name) || 'utilizador'
    const id = toFileNamePart(owner.id) || crypto.randomUUID()
    return `uploads/perfis/${name}-${id}-${crypto.randomUUID()}${extension}`
  }

  return `uploads/${crypto.randomUUID()}${extension}`
}

const getLocalImagePath = (key) => {
  if (!key.startsWith('uploads/local/')) {
    throw new Error('Chave de imagem local inválida.')
  }
  const filePath = path.resolve(localUploadDirectory, key.slice('uploads/'.length))
  if (!filePath.startsWith(`${localUploadDirectory}${path.sep}`)) {
    throw new Error('Chave de imagem local inválida.')
  }
  return filePath
}

export async function storeImage(file, owner) {
  if (!configured && !localStorageEnabled) {
    const error = new Error('Armazenamento de imagens S3 não está configurado.')
    error.status = 503
    throw error
  }

  const imageKey = createImageKey(file, owner)
  if (localStorageEnabled) {
    const key = `uploads/local/${imageKey.slice('uploads/'.length)}`
    const filePath = getLocalImagePath(key)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, file.buffer, { flag: 'wx' })
    return { key, url: `/${key.split('/').map(encodeURIComponent).join('/')}` }
  }

  const key = imageKey
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    CacheControl: 'public, max-age=31536000, immutable'
  }))

  const base = publicBaseUrl.endsWith('/') ? publicBaseUrl : `${publicBaseUrl}/`
  return { key, url: new URL(key.split('/').map(encodeURIComponent).join('/'), base).toString() }
}

export async function deleteStoredImage(key) {
  if (key.startsWith('uploads/local/')) {
    const filePath = getLocalImagePath(key)
    try {
      await fs.unlink(filePath)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    return
  }

  if (!configured || !client) {
    const error = new Error('Armazenamento de imagens S3 não está configurado.')
    error.status = 503
    throw error
  }
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}
