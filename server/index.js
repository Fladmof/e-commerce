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
import { storeImage } from './storage.js'

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
    callback(allowed ? null : new Error('Formato de imagem não suportado'), allowed)
  }
})

const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next)

const signToken = (user) =>
  jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' })

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role
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

const productColumns = `
  id, name, category, price, old_price, rating, image, description, featured, stock
`

const validateProductPayload = (payload, existing = {}) => {
  const product = {
    id: payload.id || existing.id || crypto.randomUUID(),
    name: String(payload.name ?? existing.name ?? '').trim(),
    category: String(payload.category ?? existing.category ?? 'camisetas').trim(),
    price: Number(payload.price ?? existing.price),
    oldPrice: Number(payload.oldPrice ?? existing.oldPrice ?? 0),
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
    !Number.isFinite(product.price) ||
    product.price <= 0 ||
    Math.round(product.price * 100) !== product.price * 100 ||
    !Number.isFinite(product.oldPrice) ||
    product.oldPrice < 0 ||
    Math.round(product.oldPrice * 100) !== product.oldPrice * 100 ||
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
    `SELECT ${productColumns} FROM products WHERE id = ANY($1::text[]) ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
    [ids]
  )
  return rows.map(mapProduct)
}

const seedDatabase = async () => {
  const products = JSON.parse(await fs.readFile(path.join(__dirname, 'products.json'), 'utf8'))
  for (const product of products) {
    await pool.query(
      `INSERT INTO products (${productColumns})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { name, email, password } = req.body || {}
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const normalizedName = typeof name === 'string' ? name.trim() : ''
  if (
    !normalizedName ||
    normalizedName.length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
    normalizedEmail.length > 254 ||
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
    role: 'customer'
  }
  try {
    await pool.query(
      'INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
      [user.id, user.name, user.email, await bcrypt.hash(password, 10), user.role]
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
    `SELECT id, name, email, password_hash, role FROM users WHERE lower(email) = lower($1)`,
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
    'SELECT id, name, email, role FROM users WHERE id = $1',
    [req.user.sub]
  )
  if (!rows[0]) {
    return res.status(404).json({ message: 'Utilizador não encontrado' })
  }
  return res.json({ user: sanitizeUser(rows[0]) })
}))

app.get('/api/products', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`SELECT ${productColumns} FROM products ORDER BY name`)
  return res.json(rows.map(mapProduct))
}))

app.get('/api/products/:id', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`SELECT ${productColumns} FROM products WHERE id = $1`, [req.params.id])
  if (!rows[0]) {
    return res.status(404).json({ message: 'Produto não encontrado' })
  }
  return res.json(mapProduct(rows[0]))
}))

app.post('/api/products', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const product = validateProductPayload(req.body || {})
  try {
    const { rows } = await pool.query(
      `INSERT INTO products (${productColumns})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${productColumns}`,
      [
        product.id, product.name, product.category, product.price, product.oldPrice,
        product.rating, product.image, product.description, product.featured, product.stock
      ]
    )
    return res.status(201).json(mapProduct(rows[0]))
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Já existe um produto com este ID' })
    }
    throw error
  }
}))

app.put('/api/products/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const updated = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${productColumns} FROM products WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    )
    if (!rows[0]) return null

    const currentProduct = mapProduct(rows[0])
    const product = validateProductPayload(req.body || {}, currentProduct)
    if (product.stock !== currentProduct.stock && await reservedQuantity(client, product.id) > 0) {
      const error = new Error('Não é possível alterar o stock enquanto houver pagamentos pendentes para este produto.')
      error.status = 409
      throw error
    }
    const result = await client.query(
      `UPDATE products SET
         name = $2, category = $3, price = $4, old_price = $5, rating = $6,
         image = $7, description = $8, featured = $9, stock = $10
       WHERE id = $1 RETURNING ${productColumns}`,
      [
        product.id, product.name, product.category, product.price, product.oldPrice,
        product.rating, product.image, product.description, product.featured, product.stock
      ]
    )
    return mapProduct(result.rows[0])
  })
  if (!updated) return res.status(404).json({ message: 'Produto não encontrado' })
  return res.json(updated)
}))

app.delete('/api/products/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const deleted = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [req.params.id])
    if (!rows[0]) return false
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

app.post('/api/admin/upload', requireAuth, requireAdmin, upload.single('image'), asyncRoute(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Nenhuma imagem recebida' })
  }
  const image = await storeImage(req.file)
  return res.status(201).json({ url: image.url })
}))

app.post('/api/payments/create-checkout-session', requireAuth, asyncRoute(async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ message: 'Pagamentos indisponíveis: STRIPE_SECRET_KEY não está configurada.' })
  }

  const requestedItems = req.body?.items
  if (
    !Array.isArray(requestedItems) ||
    requestedItems.length < 1 ||
    requestedItems.length > 50 ||
    requestedItems.some((item) => !item || typeof item.id !== 'string')
  ) {
    return res.status(400).json({ message: 'O carrinho contém produtos inválidos.' })
  }
  const initialProducts = await getProductsByIds(pool, requestedItems.map((item) => item.id))
  let items
  try {
    items = resolveCartItems(req.body?.items, initialProducts)
  } catch (error) {
    return res.status(400).json({ message: error.message })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '')
  const shipping = { name: 'Envio', amount: 1500 }
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
        lockedProducts
      )
      if (currentItems.some((item, index) => item.unitAmount !== items[index].unitAmount)) {
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
      await client.query(
        `INSERT INTO pending_orders (session_id, user_id, items, shipping)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [
          session.id,
          req.user.sub,
          JSON.stringify(currentItems.map(({ product, quantity, unitAmount }) => ({
            productId: product.id,
            name: product.name,
            quantity,
            unitPrice: unitAmount / 100
          }))),
          shipping.amount / 100
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
    'SELECT id, user_id, status, created_at, customer, shipping, total, items FROM orders WHERE stripe_session_id = $1',
    [session.id]
  )
  if (existingOrders[0]) return mapOrder(existingOrders[0])
  if (session.payment_status !== 'paid') {
    const error = new Error('O pagamento ainda não foi confirmado.')
    error.status = 409
    throw error
  }

  const { rows: pendingRows } = await client.query(
    'SELECT session_id, user_id, items, shipping FROM pending_orders WHERE session_id = $1 FOR UPDATE',
    [session.id]
  )
  const pendingOrder = pendingRows[0]
  if (!pendingOrder) {
    const { rows: completedOrders } = await client.query(
      'SELECT id, user_id, status, created_at, customer, shipping, total, items FROM orders WHERE stripe_session_id = $1',
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
    Number(pendingOrder.shipping)
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
    total: Number(session.amount_total) / 100,
    items: pendingOrder.items.map((item) => ({
      id: crypto.randomUUID(),
      productId: item.productId,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice)
    }))
  }

  const { rows } = await client.query(
    `INSERT INTO orders (id, stripe_session_id, user_id, status, created_at, customer, shipping, total, items)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb)
     RETURNING id, user_id, status, created_at, customer, shipping, total, items`,
    [
      order.id, order.stripeSessionId, order.userId, order.status, order.createdAt,
      JSON.stringify(order.customer), order.shipping, order.total, JSON.stringify(order.items)
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

app.post('/api/payments/confirm', requireAuth, asyncRoute(async (req, res) => {
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
    `SELECT id, user_id, status, created_at, customer, shipping, total, items
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
