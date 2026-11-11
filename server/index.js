import express from 'express'
import cors from 'cors'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
import Stripe from 'stripe'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { initializeDatabase, mapOrder, mapProduct, pool, withTransaction } from './database.js'
import { resolveCartItems } from './shop.js'
import { deleteStoredImage, localStorageEnabled, storeImage } from './storage.js'
import { calculateDeliveryQuote, convertAoaToEurCents, validateCoordinates } from './shipping.js'
import { emptyStylePreferences, normalizeStylePreferences } from '../shared/style-preferences.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 4000)
const isProduction = process.env.NODE_ENV === 'production'
const JWT_SECRET = process.env.JWT_SECRET || (isProduction ? '' : 'shopco-local-development-secret')
if (isProduction && JWT_SECRET.length < 32) {
  throw new Error('Em produção, JWT_SECRET deve ter pelo menos 32 caracteres.')
}
if (isProduction && (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET)) {
  throw new Error('Em produção, configure STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET.')
}
if (isProduction) {
  let frontendUrl
  try {
    frontendUrl = new URL(process.env.FRONTEND_URL)
  } catch {
    throw new Error('Em produção, FRONTEND_URL deve conter a URL HTTPS publicada do frontend.')
  }
  if (frontendUrl.protocol !== 'https:') {
    throw new Error('Em produção, FRONTEND_URL deve usar HTTPS.')
  }
  if (process.env.DATABASE_SSL !== 'true') {
    throw new Error('Em produção, configure DATABASE_SSL=true para proteger a ligação PostgreSQL.')
  }
  if (
    !process.env.S3_BUCKET ||
    !process.env.S3_PUBLIC_BASE_URL ||
    !process.env.S3_ACCESS_KEY_ID ||
    !process.env.S3_SECRET_ACCESS_KEY
  ) {
    throw new Error('Em produção, configure o bucket S3, as credenciais e S3_PUBLIC_BASE_URL.')
  }
}

const app = express()
const configuredOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => {
    try {
      return new URL(origin.trim()).origin
    } catch {
      throw new Error(`Origem inválida em CORS_ORIGINS: ${origin}`)
    }
  })

app.use(cors({
  origin(origin, callback) {
    const localDevelopmentOrigin = !isProduction &&
      typeof origin === 'string' &&
      /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)
    if (!origin || configuredOrigins.includes(origin) || localDevelopmentOrigin) {
      callback(null, true)
      return
    }
    callback(new Error('Origem não autorizada pelo CORS'))
  }
}))
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }))
app.use(express.json({ limit: '1mb' }))
if (localStorageEnabled) {
  app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    immutable: true,
    maxAge: '1y'
  }))
}

const allowedImageTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif']
])
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = allowedImageTypes.has(file.mimetype)
    if (!allowed) {
      const error = new Error('Formato de imagem não suportado')
      error.status = 400
      callback(error)
      return
    }
    callback(null, true)
  }
})

const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next)

const signToken = (user) =>
  jwt.sign({ sub: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' })

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  profileImage: user.profile_image || user.profileImage || null,
  stylePreferences: normalizeStylePreferences(user.style_preferences || user.stylePreferences) || emptyStylePreferences
})

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) {
    return res.status(401).json({ message: 'Token de autenticação obrigatório' })
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET)
    return next()
  } catch {
    return res.status(401).json({ message: 'Token inválido' })
  }
}

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Acesso restrito ao administrador' })
  }
  return next()
}

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Não tens permissão para executar esta operação.' })
  }
  return next()
}

const productColumns = `
  id, name, category, price, price_aoa, old_price, old_price_aoa,
  rating, image, description, featured, stock, seller_id, approved
`

const validateProductPayload = (payload, existing = {}) => {
  const priceCurrency = payload.priceCurrency ?? existing.priceCurrency ?? 'EUR'
  const price = Number(payload.price ?? existing.price)
  const oldPrice = Number(payload.oldPrice ?? existing.oldPrice ?? 0)
  const product = {
    id: payload.id || existing.id || crypto.randomUUID(),
    name: String(payload.name ?? existing.name ?? '').trim(),
    category: String(payload.category ?? existing.category ?? 'camisetas').trim(),
    price,
    priceCurrency,
    oldPrice,
    rating: Number(payload.rating ?? existing.rating ?? 4),
    image: String(payload.image ?? existing.image ?? '/image/roupas/t_shert.png').trim(),
    description: String(payload.description ?? existing.description ?? ''),
    featured: Boolean(payload.featured ?? existing.featured ?? false),
    stock: Number(payload.stock ?? existing.stock ?? 0)
  }
  if (
    !product.name ||
    product.name.length > 200 ||
    !product.category ||
    product.category.length > 80 ||
    !['EUR', 'AOA'].includes(product.priceCurrency) ||
    !Number.isFinite(product.price) ||
    product.price <= 0 ||
    (product.priceCurrency === 'EUR' && Math.round(product.price * 100) !== product.price * 100) ||
    (product.priceCurrency === 'AOA' && !Number.isInteger(product.price)) ||
    !Number.isFinite(product.oldPrice) ||
    product.oldPrice < 0 ||
    (product.priceCurrency === 'EUR' && Math.round(product.oldPrice * 100) !== product.oldPrice * 100) ||
    (product.priceCurrency === 'AOA' && !Number.isInteger(product.oldPrice)) ||
    !Number.isInteger(product.rating) ||
    product.rating < 0 ||
    product.rating > 5 ||
    !product.image ||
    product.image.length > 2048 ||
    product.description.length > 5000 ||
    !Number.isInteger(product.stock) ||
    product.stock < 0
  ) {
    const error = new Error('Os dados do produto são inválidos')
    error.status = 400
    throw error
  }
  product.priceEur = product.priceCurrency === 'EUR' ? product.price : null
  product.priceAoa = product.priceCurrency === 'AOA' ? product.price : null
  product.oldPriceEur = product.priceCurrency === 'EUR' ? product.oldPrice : 0
  product.oldPriceAoa = product.priceCurrency === 'AOA' && product.oldPrice ? product.oldPrice : null
  return product
}

const reservedQuantity = async (client, productId) => {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM((item->>'quantity')::integer), 0) AS quantity
       FROM pending_orders, jsonb_array_elements(items) AS item
      WHERE item->>'productId' = $1`,
    [productId]
  )
  return Number(rows[0].quantity)
}

const getProductsByIds = async (client, ids, { lock = false } = {}) => {
  const { rows } = await client.query(
    `SELECT ${productColumns} FROM products WHERE id = ANY($1::text[]) AND approved = TRUE ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
    [ids]
  )
  return rows.map(mapProduct)
}

const getDrivingDistance = async (origin, destination) => {
  const apiKey = process.env.OPENROUTESERVICE_API_KEY
  if (!apiKey) {
    const error = new Error('O cálculo de envio requer OPENROUTESERVICE_API_KEY.')
    error.status = 503
    throw error
  }
  let response
  try {
    response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        coordinates: [
          [origin.longitude, origin.latitude],
          [destination.longitude, destination.latitude]
        ],
        instructions: false
      }),
      signal: AbortSignal.timeout(10000)
    })
  } catch (error) {
    const routeError = new Error('Não foi possível contactar o serviço de rotas.')
    routeError.status = 502
    routeError.cause = error
    throw routeError
  }
  if (!response.ok) {
    const error = new Error('O serviço de rotas não conseguiu calcular o percurso.')
    error.status = 502
    throw error
  }
  let data
  try {
    data = await response.json()
  } catch (error) {
    const routeError = new Error('O serviço de rotas devolveu uma resposta inválida.')
    routeError.status = 502
    routeError.cause = error
    throw routeError
  }
  const distance = data?.features?.[0]?.properties?.summary?.distance
  if (!Number.isFinite(distance) || distance < 0) {
    const error = new Error('O serviço de rotas não encontrou um percurso válido entre as localizações.')
    error.status = 422
    throw error
  }
  return distance
}

const getShippingQuote = async (requestedItems, buyerLocation, { client = pool } = {}) => {
  if (
    !Array.isArray(requestedItems) ||
    requestedItems.length < 1 ||
    requestedItems.length > 50 ||
    requestedItems.some((item) => !item || typeof item.id !== 'string')
  ) {
    const error = new Error('O carrinho contém produtos inválidos.')
    error.status = 400
    throw error
  }
  const destination = validateCoordinates(buyerLocation)
  const { rate: aoaPerEur, isFallback } = await getExchangeRate()
  if (isFallback) {
    const error = new Error('É necessária uma cotação EUR/AOA atual para calcular o custo de envio.')
    error.status = 503
    throw error
  }
  const products = await getProductsByIds(client, requestedItems.map((item) => item.id))
  const items = resolveCartItems(requestedItems, products, { aoaPerEur })
  const sellerIds = [...new Set(items.map(({ product }) => product.sellerId).filter(Boolean))]
  const sellers = new Map()
  if (sellerIds.length) {
    const { rows } = await client.query(
      `SELECT id, name, pickup_latitude, pickup_longitude
         FROM users WHERE id = ANY($1::text[]) AND role = 'seller'`,
      [sellerIds]
    )
    for (const row of rows) {
      sellers.set(row.id, {
        name: row.name,
        latitude: row.pickup_latitude,
        longitude: row.pickup_longitude
      })
    }
  }
  const productsWithSellerNames = items.map((item) => ({
    ...item,
    product: {
      ...item.product,
      sellerName: sellers.get(item.product.sellerId)?.name || item.product.sellerName
    }
  }))
  const delivery = await calculateDeliveryQuote(
    productsWithSellerNames,
    destination,
    sellers,
    getDrivingDistance
  )
  const shippingEurCents = convertAoaToEurCents(delivery.totalAoa, aoaPerEur)
  return {
    ...delivery,
    items,
    exchangeRate: aoaPerEur,
    shippingEurCents,
    shippingEur: shippingEurCents / 100
  }
}

let exchangeRateCache = null
const exchangeRateCacheDuration = 6 * 60 * 60 * 1000
const fallbackExchangeRate = {
  rate: 1059.809072,
  updatedAt: '2026-11-10T00:02:31.000Z',
  isFallback: true
}
const getExchangeRate = async () => {
  if (exchangeRateCache && exchangeRateCache.expiresAt > Date.now()) {
    return exchangeRateCache
  }

  try {
    const response = await fetch('https://open.er-api.com/v6/latest/EUR', {
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) {
      throw new Error('O serviço de cotação EUR/AOA está indisponível.')
    }
    const data = await response.json()
    const rate = Number(data?.rates?.AOA)
    const updatedAt = Date.parse(data?.time_last_update_utc)
    if (data?.result !== 'success' || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(updatedAt)) {
      throw new Error('O serviço de cotação devolveu uma taxa EUR/AOA inválida.')
    }

    exchangeRateCache = {
      rate,
      updatedAt: new Date(updatedAt).toISOString(),
      isFallback: false,
      expiresAt: Date.now() + exchangeRateCacheDuration
    }
  } catch (error) {
    console.warn(`Cotação EUR/AOA indisponível; a apresentar a referência de ${fallbackExchangeRate.updatedAt}.`, error)
    exchangeRateCache = {
      ...fallbackExchangeRate,
      expiresAt: Date.now() + exchangeRateCacheDuration
    }
  }

  return exchangeRateCache
}

const seedDatabase = async () => {
  const products = JSON.parse(await fs.readFile(path.join(__dirname, 'products.json'), 'utf8'))
  for (const product of products) {
    await pool.query(
      `INSERT INTO products (${productColumns})
       VALUES ($1, $2, $3, $4, NULL, $5, NULL, $6, $7, $8, $9, $10, NULL, TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [
        product.id, product.name, product.category, product.price, product.oldPrice,
        product.rating, product.image, product.description, product.featured, product.stock
      ]
    )
  }

  if (isProduction) {
    await pool.query(
      `UPDATE users
          SET email = 'disabled+' || md5(id) || '@invalid.local',
              password_hash = $2,
              role = 'customer'
        WHERE lower(email) = ANY($1::text[])`,
      [['admin@shopco.com', 'cliente@shopco.com'], await bcrypt.hash(crypto.randomUUID(), 12)]
    )
    const { rows } = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
    if (!rows.length) {
      const email = typeof process.env.ADMIN_EMAIL === 'string' ? process.env.ADMIN_EMAIL.trim().toLowerCase() : ''
      const password = process.env.ADMIN_PASSWORD || ''
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 254 ||
        password.length < 12 ||
        Buffer.byteLength(password, 'utf8') > 72
      ) {
        throw new Error('Configure ADMIN_EMAIL e ADMIN_PASSWORD (12 a 72 bytes) para criar o administrador inicial.')
      }
      await pool.query(
        `INSERT INTO users (id, name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, 'admin')
         ON CONFLICT (email) DO UPDATE
           SET name = EXCLUDED.name,
               password_hash = EXCLUDED.password_hash,
               role = 'admin'`,
        [crypto.randomUUID(), 'Administrador', email, await bcrypt.hash(password, 12)]
      )
    }
    return
  }

  const { rows } = await pool.query('SELECT id FROM users LIMIT 1')
  if (!rows.length) {
    await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES
         ('admin-1', 'Administrador', 'admin@shopco.com', $1, 'admin'),
         ('customer-1', 'Cliente', 'cliente@shopco.com', $2, 'customer')
       ON CONFLICT (email) DO NOTHING`,
      [await bcrypt.hash('admin123', 10), await bcrypt.hash('cliente123', 10)]
    )
  }
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ ok: true, service: 'shopco-api', timestamp: new Date().toISOString() })
}))

app.get('/api/exchange-rate', asyncRoute(async (_req, res) => {
  const { rate, updatedAt, isFallback } = await getExchangeRate()
  return res.json({ rate, updatedAt, isFallback, base: 'EUR', currency: 'AOA' })
}))

app.get('/api/reviews', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT reviews.id, reviews.comment, reviews.created_at, users.name AS customer_name
       FROM purchase_reviews AS reviews
       JOIN users ON users.id = reviews.user_id
      ORDER BY reviews.created_at DESC`
  )
  return res.json({
    reviews: rows.map((row) => ({
      id: row.id,
      comment: row.comment,
      customerName: row.customer_name.trim().split(/\s+/)[0],
      createdAt: row.created_at
    }))
  })
}))

app.post('/api/reviews', requireAuth, asyncRoute(async (req, res) => {
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : ''
  if (comment.length < 3 || comment.length > 2000) {
    return res.status(400).json({ message: 'O comentário deve ter entre 3 e 2000 caracteres.' })
  }

  const { rows: customers } = await pool.query(
    'SELECT id, name, role FROM users WHERE id = $1',
    [req.user.sub]
  )
  const customer = customers[0]
  if (!customer || customer.role !== 'customer') {
    return res.status(403).json({ message: 'Apenas clientes podem publicar comentários.' })
  }

  const { rows: paidOrders } = await pool.query(
    "SELECT 1 FROM orders WHERE user_id = $1 AND status = 'paid' LIMIT 1",
    [customer.id]
  )
  if (!paidOrders.length) {
    return res.status(403).json({ message: 'Só clientes com uma encomenda paga podem publicar comentários.' })
  }

  const { rows } = await pool.query(
    `INSERT INTO purchase_reviews (id, user_id, comment)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING id, comment, created_at`,
    [crypto.randomUUID(), customer.id, comment]
  )
  if (!rows[0]) {
    return res.status(409).json({ message: 'Já publicaste um comentário.' })
  }

  const row = rows[0]
  return res.status(201).json({
    review: {
      id: row.id,
      comment: row.comment,
      customerName: customer.name.trim().split(/\s+/)[0],
      createdAt: row.created_at
    }
  })
}))

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { name, email, password } = req.body || {}
  const role = req.body?.role
  const stylePreferences = normalizeStylePreferences(req.body?.stylePreferences)
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const normalizedName = typeof name === 'string' ? name.trim() : ''
  if (!stylePreferences) {
    return res.status(400).json({ message: 'As preferências de estilo contêm opções inválidas.' })
  }
  if (
    !normalizedName ||
    normalizedName.length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
    normalizedEmail.length > 254 ||
    !['customer', 'seller'].includes(role) ||
    typeof password !== 'string' ||
    password.length < 8 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    return res.status(400).json({ message: 'Indica um nome, email válido e palavra-passe entre 8 caracteres e 72 bytes' })
  }

  const user = {
    id: crypto.randomUUID(),
    name: normalizedName,
    email: normalizedEmail,
    role,
    stylePreferences: role === 'customer' ? stylePreferences : normalizeStylePreferences()
  }
  try {
    await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role, style_preferences)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        user.id,
        user.name,
        user.email,
        await bcrypt.hash(password, 10),
        user.role,
        JSON.stringify(user.stylePreferences)
      ]
    )
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Este email já está registado' })
    }
    throw error
  }

  return res.status(201).json({ token: signToken(user), user: sanitizeUser(user) })
}))

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body || {}
  if (
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    !email.trim() ||
    !password ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    return res.status(400).json({ message: 'Email e password são obrigatórios' })
  }

  const { rows } = await pool.query(
    `SELECT id, name, email, password_hash, role, profile_image, style_preferences
       FROM users WHERE lower(email) = lower($1)`,
    [email.trim()]
  )
  const user = rows[0]
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ message: 'Credenciais inválidas' })
  }
  const safeUser = sanitizeUser(user)
  return res.json({ token: signToken(safeUser), user: safeUser })
}))

app.get('/api/auth/me', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, email, role, profile_image, style_preferences FROM users WHERE id = $1',
    [req.user.sub]
  )
  if (!rows[0]) {
    return res.status(404).json({ message: 'Utilizador não encontrado' })
  }
  return res.json({ user: sanitizeUser(rows[0]) })
}))

app.patch('/api/auth/profile-image', requireAuth, upload.single('image'), asyncRoute(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Seleciona uma imagem de perfil.' })
  }

  const image = await storeImage(req.file, { name: req.user.name, id: req.user.sub })
  let previousImageKey
  let user
  try {
    user = await withTransaction(async (client) => {
      const { rows: currentUsers } = await client.query(
        'SELECT profile_image_key FROM users WHERE id = $1 FOR UPDATE',
        [req.user.sub]
      )
      if (!currentUsers[0]) return null

      previousImageKey = currentUsers[0].profile_image_key
      const { rows } = await client.query(
        `UPDATE users
            SET profile_image = $1, profile_image_key = $2
          WHERE id = $3
            RETURNING id, name, email, role, profile_image, style_preferences`,
        [image.url, image.key, req.user.sub]
      )
      return rows[0]
    })
  } catch (error) {
    try {
      await deleteStoredImage(image.key)
    } catch (cleanupError) {
      console.error('Não foi possível limpar a imagem de perfil após falha na atualização.', cleanupError)
    }
    throw error
  }

  if (!user) {
    await deleteStoredImage(image.key)
    return res.status(404).json({ message: 'Utilizador não encontrado.' })
  }

  let warning
  if (previousImageKey) {
    try {
      await deleteStoredImage(previousImageKey)
    } catch (error) {
      console.error('A foto de perfil foi atualizada, mas a imagem anterior não pôde ser removida.', error)
      warning = 'A foto foi atualizada, mas não foi possível remover a imagem anterior.'
    }
  }

  return res.json({ user: sanitizeUser(user), ...(warning ? { warning } : {}) })
}))

app.get('/api/products', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT products.*, seller.name AS seller_name
       FROM products
       LEFT JOIN users AS seller ON seller.id = products.seller_id
      WHERE products.approved = TRUE
      ORDER BY products.name`
  )
  return res.json(rows.map(mapProduct))
}))

app.get('/api/products/:id', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT products.*, seller.name AS seller_name
       FROM products
       LEFT JOIN users AS seller ON seller.id = products.seller_id
      WHERE products.id = $1 AND products.approved = TRUE`,
    [req.params.id]
  )
  if (!rows[0]) {
    return res.status(404).json({ message: 'Produto não encontrado' })
  }
  return res.json(mapProduct(rows[0]))
}))

app.get('/api/seller/products', requireAuth, requireRole('seller'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT products.*, seller.name AS seller_name
       FROM products
       LEFT JOIN users AS seller ON seller.id = products.seller_id
      WHERE products.seller_id = $1
       ORDER BY products.name`,
    [req.user.sub]
  )
  return res.json(rows.map(mapProduct))
}))

app.get('/api/seller/location', requireAuth, requireRole('seller'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT pickup_latitude, pickup_longitude FROM users WHERE id = $1 AND role = $2',
    [req.user.sub, 'seller']
  )
  return res.json({
    hasPickupLocation: Number.isFinite(rows[0]?.pickup_latitude) &&
      Number.isFinite(rows[0]?.pickup_longitude)
  })
}))

app.put('/api/seller/location', requireAuth, requireRole('seller'), asyncRoute(async (req, res) => {
  const location = validateCoordinates({
    latitude: req.body?.latitude,
    longitude: req.body?.longitude
  })
  await pool.query(
    `UPDATE users SET pickup_latitude = $1, pickup_longitude = $2
      WHERE id = $3 AND role = 'seller'`,
    [location.latitude, location.longitude, req.user.sub]
  )
  return res.json({ hasPickupLocation: true })
}))

app.get('/api/admin/products/pending', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT products.*, seller.name AS seller_name
       FROM products
       LEFT JOIN users AS seller ON seller.id = products.seller_id
      WHERE products.approved = FALSE
      ORDER BY products.name`
  )
  return res.json(rows.map(mapProduct))
}))

app.get('/api/admin/dashboard', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const [ordersResult, inventoryResult, pendingResult, dailyResult, topProductsResult, recentOrdersResult] =
    await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'paid') AS paid_orders,
           COUNT(*) FILTER (WHERE status = 'refunded') AS refunded_orders,
           COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0) AS revenue,
           COALESCE(SUM(commission) FILTER (WHERE status = 'paid'), 0) AS commission,
           COALESCE(SUM(shipping) FILTER (WHERE status = 'paid'), 0) AS shipping,
           COUNT(*) FILTER (WHERE status = 'paid' AND created_at >= NOW() - INTERVAL '7 days') AS paid_orders_last_7_days
         FROM orders`
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE approved = TRUE) AS approved_products,
           COUNT(*) FILTER (WHERE approved = FALSE) AS pending_products,
           COALESCE(SUM(stock) FILTER (WHERE approved = TRUE), 0) AS stock_units,
           COUNT(*) FILTER (WHERE approved = TRUE AND stock = 0) AS out_of_stock,
           COUNT(*) FILTER (WHERE approved = TRUE AND stock BETWEEN 1 AND 5) AS low_stock,
           (SELECT COUNT(*) FROM users WHERE role = 'seller') AS sellers
         FROM products`
      ),
      pool.query(
        `SELECT COUNT(*) AS checkouts_awaiting_confirmation
           FROM pending_orders`
      ),
      pool.query(
        `WITH days AS (
           SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
         ), daily_orders AS (
           SELECT created_at::date AS day,
                  COUNT(*) FILTER (WHERE status = 'paid') AS paid_orders,
                  COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0) AS revenue
             FROM orders
            WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'
               AND created_at < CURRENT_DATE + INTERVAL '1 day'
            GROUP BY created_at::date
         )
         SELECT TO_CHAR(days.day, 'YYYY-MM-DD') AS day,
                COALESCE(daily_orders.paid_orders, 0) AS paid_orders,
                COALESCE(daily_orders.revenue, 0) AS revenue
           FROM days
           LEFT JOIN daily_orders ON daily_orders.day = days.day
          ORDER BY days.day`
      ),
      pool.query(
        `SELECT item->>'productId' AS product_id,
                COALESCE(products.name, 'Produto removido') AS name,
                SUM((item->>'quantity')::integer) AS units_sold
           FROM orders
           CROSS JOIN LATERAL jsonb_array_elements(orders.items) AS elements(item)
           LEFT JOIN products ON products.id = item->>'productId'
          WHERE orders.status = 'paid'
          GROUP BY item->>'productId', products.name
          ORDER BY units_sold DESC, name
          LIMIT 5`
      ),
      pool.query(
        `SELECT id, status, created_at, total, customer->>'name' AS customer_name
           FROM orders
          ORDER BY created_at DESC
          LIMIT 8`
      )
    ])

  const orders = ordersResult.rows[0]
  const inventory = inventoryResult.rows[0]
  return res.json({
    summary: {
      paidOrders: Number(orders.paid_orders),
      refundedOrders: Number(orders.refunded_orders),
      revenue: Number(orders.revenue),
      commission: Number(orders.commission),
      shipping: Number(orders.shipping),
      paidOrdersLast7Days: Number(orders.paid_orders_last_7_days),
      approvedProducts: Number(inventory.approved_products),
      pendingProducts: Number(inventory.pending_products),
      stockUnits: Number(inventory.stock_units),
      outOfStock: Number(inventory.out_of_stock),
      lowStock: Number(inventory.low_stock),
      sellers: Number(inventory.sellers),
      checkoutsAwaitingConfirmation: Number(pendingResult.rows[0].checkouts_awaiting_confirmation)
    },
    dailyOrders: dailyResult.rows.map((row) => ({
      day: row.day,
      paidOrders: Number(row.paid_orders),
      revenue: Number(row.revenue)
    })),
    topProducts: topProductsResult.rows.map((row) => ({
      id: row.product_id,
      name: row.name,
      unitsSold: Number(row.units_sold)
    })),
    recentOrders: recentOrdersResult.rows.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      total: Number(row.total),
      customerName: row.customer_name || 'Cliente'
    }))
  })
}))

app.post('/api/products', requireAuth, asyncRoute(async (req, res) => {
  if (!['admin', 'seller'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Apenas vendedores podem publicar produtos.' })
  }
  const product = validateProductPayload({
    ...req.body,
    priceCurrency: req.user.role === 'seller' ? 'AOA' : req.body?.priceCurrency
  })
  const sellerId = req.user.role === 'seller' ? req.user.sub : null
  const approved = req.user.role === 'admin'
  const featured = req.user.role === 'seller' ? true : product.featured
  const rating = req.user.role === 'seller' ? 0 : product.rating
  try {
    const { rows } = await pool.query(
      `INSERT INTO products (${productColumns})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING ${productColumns}`,
      [
        product.id, product.name, product.category, product.priceEur, product.priceAoa,
        product.oldPriceEur, product.oldPriceAoa, rating, product.image, product.description,
        featured, product.stock, sellerId, approved
      ]
    )
    return res.status(201).json(mapProduct({ ...rows[0], seller_name: req.user.name }))
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Já existe um produto com este ID' })
    }
    throw error
  }
}))

app.put('/api/products/:id', requireAuth, requireRole('admin', 'seller'), asyncRoute(async (req, res) => {
  const updated = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${productColumns} FROM products WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    )
    if (!rows[0]) return null

    const currentProduct = mapProduct(rows[0])
    if (req.user.role === 'seller' && currentProduct.sellerId !== req.user.sub) {
      const error = new Error('Só podes alterar os teus próprios produtos.')
      error.status = 403
      throw error
    }
    const product = validateProductPayload({
      ...req.body,
      id: currentProduct.id,
      priceCurrency: req.user.role === 'seller' ? 'AOA' : req.body?.priceCurrency
    }, currentProduct)
    if (product.stock !== currentProduct.stock && await reservedQuantity(client, product.id) > 0) {
      const error = new Error('Não é possível alterar o stock enquanto houver pagamentos pendentes para este produto.')
      error.status = 409
      throw error
    }
    const approved = req.user.role === 'seller' ? false : currentProduct.approved
    const featured = req.user.role === 'seller' ? true : product.featured
    const rating = req.user.role === 'seller' ? currentProduct.rating : product.rating
    const result = await client.query(
      `UPDATE products SET
         name = $2, category = $3, price = $4, price_aoa = $5, old_price = $6,
         old_price_aoa = $7, rating = $8, image = $9, description = $10,
         featured = $11, stock = $12, approved = $13
       WHERE id = $1 RETURNING ${productColumns}`,
      [
        product.id, product.name, product.category, product.priceEur, product.priceAoa,
        product.oldPriceEur, product.oldPriceAoa, rating, product.image,
        product.description, featured, product.stock, approved
      ]
    )
    return mapProduct(result.rows[0])
  })
  if (!updated) return res.status(404).json({ message: 'Produto não encontrado' })
  return res.json(updated)
}))

app.patch('/api/admin/products/:id/approval', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const approved = req.body?.approved
  if (typeof approved !== 'boolean') {
    return res.status(400).json({ message: 'Indica se o produto deve ser aprovado.' })
  }
  const { rows } = await pool.query(
    `UPDATE products SET approved = $2
      WHERE id = $1 AND seller_id IS NOT NULL
      RETURNING ${productColumns}`,
    [req.params.id, approved]
  )
  if (!rows[0]) return res.status(404).json({ message: 'Produto de vendedor não encontrado.' })
  return res.json(mapProduct(rows[0]))
}))

app.delete('/api/products/:id', requireAuth, requireRole('admin', 'seller'), asyncRoute(async (req, res) => {
  const deleted = await withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT ${productColumns} FROM products WHERE id = $1 FOR UPDATE`, [req.params.id])
    if (!rows[0]) return false
    if (req.user.role === 'seller' && rows[0].seller_id !== req.user.sub) {
      const error = new Error('Só podes eliminar os teus próprios produtos.')
      error.status = 403
      throw error
    }
    if (await reservedQuantity(client, req.params.id)) {
      const error = new Error('Não é possível eliminar um produto com unidades reservadas para pagamento.')
      error.status = 409
      throw error
    }
    await client.query('DELETE FROM products WHERE id = $1', [req.params.id])
    return true
  })
  if (!deleted) return res.status(404).json({ message: 'Produto não encontrado' })
  return res.status(204).send()
}))

app.post('/api/admin/upload', requireAuth, requireRole('admin', 'seller'), upload.single('image'), asyncRoute(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Nenhuma imagem recebida' })
  }
  const image = await storeImage(req.file)
  return res.status(201).json({ url: image.url })
}))

app.get('/api/chat/conversations', requireAuth, requireRole('customer', 'seller'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT conversations.id, conversations.product_id, products.name AS product_name,
            CASE WHEN conversations.customer_id = $1 THEN seller.name ELSE customer.name END AS other_name,
            latest.id AS last_message_id, latest.sender_id AS last_sender_id,
            latest.body AS last_message, latest.created_at AS last_message_at
       FROM chat_conversations AS conversations
       JOIN products ON products.id = conversations.product_id
       JOIN users AS customer ON customer.id = conversations.customer_id
       JOIN users AS seller ON seller.id = conversations.seller_id
       LEFT JOIN LATERAL (
         SELECT id, sender_id, body, created_at FROM chat_messages
          WHERE conversation_id = conversations.id
          ORDER BY created_at DESC LIMIT 1
       ) AS latest ON TRUE
      WHERE conversations.customer_id = $1 OR conversations.seller_id = $1
      ORDER BY COALESCE(latest.created_at, conversations.created_at) DESC`,
    [req.user.sub]
  )
  return res.json({
    conversations: rows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      otherName: row.other_name,
      lastMessageId: row.last_message_id || null,
      lastSenderId: row.last_sender_id || null,
      lastMessage: row.last_message || '',
      lastMessageAt: row.last_message_at || null
    }))
  })
}))

app.post('/api/chat/conversations', requireAuth, requireRole('customer'), asyncRoute(async (req, res) => {
  const productId = typeof req.body?.productId === 'string' ? req.body.productId : ''
  if (!productId) {
    return res.status(400).json({ message: 'Indica o produto sobre o qual queres falar.' })
  }
  const { rows: products } = await pool.query(
    `SELECT id, seller_id FROM products
      WHERE id = $1 AND approved = TRUE AND seller_id IS NOT NULL`,
    [productId]
  )
  const product = products[0]
  if (!product) {
    return res.status(404).json({ message: 'Produto de vendedor não encontrado.' })
  }
  const { rows } = await pool.query(
    `INSERT INTO chat_conversations (id, product_id, customer_id, seller_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (product_id, customer_id) DO UPDATE SET product_id = EXCLUDED.product_id
     RETURNING id`,
    [crypto.randomUUID(), product.id, req.user.sub, product.seller_id]
  )
  return res.status(201).json({ conversationId: rows[0].id })
}))

app.get('/api/chat/conversations/:id/messages', requireAuth, requireRole('customer', 'seller'), asyncRoute(async (req, res) => {
  const { rows: access } = await pool.query(
    `SELECT id FROM chat_conversations
      WHERE id = $1 AND (customer_id = $2 OR seller_id = $2)`,
    [req.params.id, req.user.sub]
  )
  if (!access.length) {
    return res.status(404).json({ message: 'Conversa não encontrada.' })
  }
  const { rows } = await pool.query(
    `SELECT messages.id, messages.sender_id, messages.body, messages.created_at, users.name AS sender_name
       FROM chat_messages AS messages
       JOIN users ON users.id = messages.sender_id
      WHERE messages.conversation_id = $1
      ORDER BY messages.created_at, messages.id`,
    [req.params.id]
  )
  return res.json({
    messages: rows.map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      body: row.body,
      createdAt: row.created_at
    }))
  })
}))

app.post('/api/chat/conversations/:id/messages', requireAuth, requireRole('customer', 'seller'), asyncRoute(async (req, res) => {
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : ''
  if (!body || body.length > 2000) {
    return res.status(400).json({ message: 'A mensagem deve ter entre 1 e 2000 caracteres.' })
  }
  const { rows: access } = await pool.query(
    `SELECT id FROM chat_conversations
      WHERE id = $1 AND (customer_id = $2 OR seller_id = $2)`,
    [req.params.id, req.user.sub]
  )
  if (!access.length) {
    return res.status(404).json({ message: 'Conversa não encontrada.' })
  }
  const { rows } = await pool.query(
    `INSERT INTO chat_messages (id, conversation_id, sender_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, sender_id, body, created_at`,
    [crypto.randomUUID(), req.params.id, req.user.sub, body]
  )
  const { rows: senders } = await pool.query('SELECT name FROM users WHERE id = $1', [req.user.sub])
  return res.status(201).json({
    message: {
      id: rows[0].id,
      senderId: rows[0].sender_id,
      senderName: senders[0].name,
      body: rows[0].body,
      createdAt: rows[0].created_at
    }
  })
}))

app.post('/api/shipping/quote', requireAuth, requireRole('customer'), asyncRoute(async (req, res) => {
  const quote = await getShippingQuote(req.body?.items, req.body?.buyerLocation)
  return res.json({
    sellers: quote.sellers,
    totalAoa: quote.totalAoa,
    exchangeRate: quote.exchangeRate,
    shippingEur: quote.shippingEur
  })
}))

app.post('/api/payments/create-checkout-session', requireAuth, requireRole('customer'), asyncRoute(async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ message: 'Pagamentos indisponíveis: STRIPE_SECRET_KEY não está configurada.' })
  }

  const shippingQuote = await getShippingQuote(req.body?.items, req.body?.buyerLocation)
  const { items, exchangeRate: aoaPerEur } = shippingQuote

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '')
  const shipping = {
    name: `Envio (${shippingQuote.totalAoa} AOA)`,
    amount: shippingQuote.shippingEurCents
  }
  const commissionTotal = items.reduce((sum, item) => sum + item.commissionAmount * item.quantity, 0)
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: req.user.email,
    client_reference_id: req.user.sub,
    metadata: { userId: req.user.sub },
    success_url: `${frontendUrl}/checkout/sucesso?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/checkout?cancelled=1`,
    shipping_address_collection: { allowed_countries: ['PT'] },
    line_items: [
      ...items.map(({ product, quantity, unitAmount }) => ({
        price_data: {
          currency: 'eur',
          product_data: { name: product.name },
          unit_amount: unitAmount
        },
        quantity
      })),
      ...(commissionTotal > 0 ? [{
          price_data: {
            currency: 'eur',
            product_data: { name: 'Custo de intermediação (2%)' },
            unit_amount: commissionTotal
          },
          quantity: 1
      }] : []),
      {
        price_data: {
          currency: 'eur',
          product_data: { name: shipping.name },
          unit_amount: shipping.amount
        },
        quantity: 1
      }
    ]
  })

  try {
    await withTransaction(async (client) => {
      const lockedProducts = await getProductsByIds(
        client,
        items.map(({ product }) => product.id),
        { lock: true }
      )
      const currentItems = resolveCartItems(
        items.map(({ product, quantity }) => ({ id: product.id, quantity })),
        lockedProducts,
        { aoaPerEur }
      )
      if (currentItems.some((item, index) =>
        item.unitAmount !== items[index].unitAmount ||
        item.commissionAmount !== items[index].commissionAmount
      )) {
        const error = new Error('O preço de um produto mudou. Atualiza o carrinho e tenta novamente.')
        error.status = 409
        throw error
      }

      for (const item of currentItems) {
        const result = await client.query(
          'UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2',
          [item.product.id, item.quantity]
        )
        if (result.rowCount !== 1) {
          const error = new Error(`Stock insuficiente para ${item.product.name}`)
          error.status = 409
          throw error
        }
      }
      const currentCommissionTotal = currentItems.reduce(
        (sum, item) => sum + item.commissionAmount * item.quantity, 0
      )
      await client.query(
        `INSERT INTO pending_orders (session_id, user_id, items, shipping, commission)
         VALUES ($1, $2, $3::jsonb, $4, $5)`,
        [
          session.id,
          req.user.sub,
          JSON.stringify(currentItems.map(({ product, quantity, unitAmount, commissionAmount }) => ({
            productId: product.id,
            sellerId: product.sellerId,
            name: product.name,
            quantity,
            unitPrice: unitAmount / 100,
            commissionUnitPrice: commissionAmount / 100,
            sellerUnitPrice: product.price,
            sellerCurrency: product.priceCurrency
          }))),
          shipping.amount / 100,
          currentCommissionTotal / 100
        ]
      )
    })
  } catch (error) {
    try {
      await stripe.checkout.sessions.expire(session.id)
    } catch (expirationError) {
      console.error('Não foi possível expirar sessão Stripe após falha ao reservar stock.', expirationError)
    }
    if (error.status === 409 || error.status === 400) {
      return res.status(error.status).json({ message: error.message })
    }
    throw error
  }

  return res.status(201).json({ sessionId: session.id, url: session.url })
}))

const finalizePaidOrder = async (session) => withTransaction(async (client) => {
  const { rows: existingOrders } = await client.query(
    'SELECT id, user_id, status, created_at, customer, shipping, commission, total, items FROM orders WHERE stripe_session_id = $1',
    [session.id]
  )
  if (existingOrders[0]) return mapOrder(existingOrders[0])
  if (session.payment_status !== 'paid') {
    const error = new Error('O pagamento ainda não foi confirmado.')
    error.status = 409
    throw error
  }

  const { rows: pendingRows } = await client.query(
    'SELECT session_id, user_id, items, shipping, commission FROM pending_orders WHERE session_id = $1 FOR UPDATE',
    [session.id]
  )
  const pendingOrder = pendingRows[0]
  if (!pendingOrder) {
    const { rows: completedOrders } = await client.query(
      'SELECT id, user_id, status, created_at, customer, shipping, commission, total, items FROM orders WHERE stripe_session_id = $1',
      [session.id]
    )
    if (completedOrders[0]) return mapOrder(completedOrders[0])
  }
  if (!pendingOrder || pendingOrder.user_id !== session.metadata?.userId) {
    const error = new Error('Não foi encontrada uma encomenda válida para este pagamento.')
    error.status = 404
    throw error
  }

  const expectedTotal = pendingOrder.items.reduce(
    (sum, item) => sum + Number(item.unitPrice) * Number(item.quantity),
    Number(pendingOrder.shipping) + Number(pendingOrder.commission || 0)
  )
  if (session.currency !== 'eur' || Number(session.amount_total) !== Math.round(expectedTotal * 100)) {
    throw new Error('O total pago não corresponde à encomenda.')
  }

  const shippingDetails = session.shipping_details || session.collected_information?.shipping_details
  const address = shippingDetails?.address || session.customer_details?.address || {}
  const order = {
    id: `order-${session.id}`,
    stripeSessionId: session.id,
    userId: pendingOrder.user_id,
    status: 'paid',
    createdAt: new Date().toISOString(),
    customer: {
      name: shippingDetails?.name || session.customer_details?.name || '',
      email: session.customer_details?.email || '',
      address: address.line1 || '',
      city: address.city || '',
      country: address.country || ''
    },
    shipping: Number(pendingOrder.shipping),
    commission: Number(pendingOrder.commission || 0),
    total: Number(session.amount_total) / 100,
    items: pendingOrder.items.map((item) => ({
      id: crypto.randomUUID(),
      productId: item.productId,
      sellerId: item.sellerId || null,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      commissionUnitPrice: Number(item.commissionUnitPrice || 0),
      sellerUnitPrice: Number(item.sellerUnitPrice ?? item.unitPrice),
      sellerCurrency: item.sellerCurrency || 'EUR'
    }))
  }

  const { rows } = await client.query(
    `INSERT INTO orders (id, stripe_session_id, user_id, status, created_at, customer, shipping, commission, total, items)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb)
     RETURNING id, user_id, status, created_at, customer, shipping, commission, total, items`,
    [
      order.id, order.stripeSessionId, order.userId, order.status, order.createdAt,
      JSON.stringify(order.customer), order.shipping, order.commission, order.total, JSON.stringify(order.items)
    ]
  )
  await client.query('DELETE FROM pending_orders WHERE session_id = $1', [session.id])
  return mapOrder(rows[0])
})

const releasePendingOrder = async (sessionId) => withTransaction(async (client) => {
  const { rows } = await client.query(
    'SELECT session_id, items FROM pending_orders WHERE session_id = $1 FOR UPDATE',
    [sessionId]
  )
  const pendingOrder = rows[0]
  if (!pendingOrder) return

  for (const item of pendingOrder.items) {
    await client.query(
      'UPDATE products SET stock = stock + $2 WHERE id = $1',
      [item.productId, Number(item.quantity)]
    )
  }
  await client.query('DELETE FROM pending_orders WHERE session_id = $1', [sessionId])
})

app.post('/api/payments/confirm', requireAuth, requireRole('customer'), asyncRoute(async (req, res) => {
  const { sessionId } = req.body || {}
  if (typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    return res.status(400).json({ message: 'Sessão de pagamento inválida.' })
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ message: 'Pagamentos indisponíveis: STRIPE_SECRET_KEY não está configurada.' })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  if (session.client_reference_id !== req.user.sub || session.metadata?.userId !== req.user.sub) {
    return res.status(403).json({ message: 'Esta sessão de pagamento pertence a outro utilizador.' })
  }
  return res.json(await finalizePaidOrder(session))
}))

app.post('/api/webhooks/stripe', asyncRoute(async (req, res) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ message: 'Webhook Stripe não está configurado.' })
  }

  let event
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch {
    return res.status(400).json({ message: 'Assinatura do webhook inválida.' })
  }

  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    if (event.type === 'checkout.session.completed' && event.data.object.payment_status !== 'paid') {
      return res.json({ received: true })
    }
    await finalizePaidOrder(event.data.object)
  } else if (['checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type)) {
    await releasePendingOrder(event.data.object.id)
  }
  return res.json({ received: true })
}))

app.get('/api/orders', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, user_id, status, created_at, customer, shipping, commission, total, items
       FROM orders ORDER BY created_at DESC`
  )
  return res.json(rows.map(mapOrder))
}))

app.use((error, _req, res, _next) => {
  console.error(error)
  const status = Number(error.status) || (error instanceof multer.MulterError ? 400 : 500)
  res.status(status).json({
    message: status === 500 ? 'Erro interno da API.' : error.message
  })
})

await initializeDatabase()
await seedDatabase()

const server = app.listen(PORT, () => {
  console.log(`API de e-commerce em http://localhost:${PORT}`)
})

const shutdown = async () => {
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
