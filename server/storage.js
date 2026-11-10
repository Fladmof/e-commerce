import crypto from 'crypto'
import dotenv from 'dotenv'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

dotenv.config()

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

export async function storeImage(file) {
  if (!configured || !client) {
    const error = new Error('Armazenamento de imagens S3 não está configurado.')
    error.status = 503
    throw error
  }

  const key = `uploads/${crypto.randomUUID()}${extensions.get(file.mimetype)}`
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
  if (!configured || !client) {
    const error = new Error('Armazenamento de imagens S3 não está configurado.')
    error.status = 503
    throw error
  }
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}
