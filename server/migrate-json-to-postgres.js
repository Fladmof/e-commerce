import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { initializeDatabase, pool, withTransaction } from './database.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, 'data', 'db.json')

try {
  const legacy = JSON.parse(await fs.readFile(sourcePath, 'utf8'))
  for (const collection of ['users', 'products', 'orders', 'pendingOrders']) {
    if (legacy[collection] !== undefined && !Array.isArray(legacy[collection])) {
      throw new Error(`O campo "${collection}" no JSON legado deve ser uma lista.`)
    }
  }
  await initializeDatabase()

  const result = await withTransaction(async (client) => {
    let users = 0
    let products = 0
    let orders = 0
    let pendingOrders = 0
    const userIds = new Map()

    for (const user of legacy.users || []) {
      if (
        !user.id ||
        !user.name ||
        typeof user.email !== 'string' ||
        !user.email.trim() ||
        !user.passwordHash ||
        !['admin', 'customer'].includes(user.role)
      ) {
        throw new Error('Foi encontrado um utilizador legado sem os campos obrigatórios.')
      }
      const email = user.email.trim().toLowerCase()
      const inserted = await client.query(
        `INSERT INTO users (id, name, email, password_hash, role, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [user.id, user.name, email, user.passwordHash, user.role, user.createdAt || new Date().toISOString()]
      )
      users += inserted.rowCount
      let existingUser = inserted.rows[0]
      if (!existingUser) {
        const { rows } = await client.query(
          'SELECT id FROM users WHERE id = $1 OR lower(email) = $2 LIMIT 1',
          [user.id, email]
        )
        existingUser = rows[0]
      }
      if (!existingUser) {
        throw new Error(`Não foi possível resolver o utilizador legado ${user.id}.`)
      }
      userIds.set(user.id, existingUser.id)
    }

    for (const product of legacy.products || []) {
      if (!product.id || !product.name || !product.category || !product.image) {
        throw new Error('Foi encontrado um produto legado sem os campos obrigatórios.')
      }
      const inserted = await client.query(
        `INSERT INTO products
           (id, name, category, price, old_price, rating, image, description, featured, stock)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT DO NOTHING`,
        [
          product.id, product.name, product.category, product.price, product.oldPrice || 0,
          product.rating || 4, product.image, product.description || '', Boolean(product.featured),
          Number.isInteger(product.stock) && product.stock >= 0 ? product.stock : 0
        ]
      )
      products += inserted.rowCount
    }

    for (const pendingOrder of legacy.pendingOrders || []) {
      const userId = userIds.get(pendingOrder.userId) || pendingOrder.userId
      if (!pendingOrder.sessionId || !userId || !Array.isArray(pendingOrder.items)) {
        throw new Error('Foi encontrada uma reserva de pagamento legada inválida.')
      }
      const inserted = await client.query(
        `INSERT INTO pending_orders (session_id, user_id, items, shipping, created_at)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         ON CONFLICT DO NOTHING`,
        [
          pendingOrder.sessionId, userId, JSON.stringify(pendingOrder.items),
          pendingOrder.shipping || 0, pendingOrder.createdAt || new Date().toISOString()
        ]
      )
      pendingOrders += inserted.rowCount
    }

    for (const order of legacy.orders || []) {
      const userId = userIds.get(order.userId) || order.userId
      if (!order.id || !userId || !Array.isArray(order.items)) {
        throw new Error('Foi encontrada uma encomenda legada inválida.')
      }
      if (!['paid', 'refunded'].includes(order.status)) {
        throw new Error(`A encomenda ${order.id} tem um estado não suportado: ${order.status}.`)
      }
      const sessionId = order.stripeSessionId || `legacy-${order.id}`
      const inserted = await client.query(
        `INSERT INTO orders
           (id, stripe_session_id, user_id, status, created_at, customer, shipping, total, items)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          order.id, sessionId, userId, order.status,
          order.createdAt || new Date().toISOString(),
          JSON.stringify(order.customer || {}), order.shipping || 0, order.total || 0,
          JSON.stringify(order.items || [])
        ]
      )
      orders += inserted.rowCount
    }

    return { users, products, orders, pendingOrders }
  })

  console.log(`Migração concluída: ${result.users} utilizadores, ${result.products} produtos, ${result.orders} encomendas e ${result.pendingOrders} pagamentos pendentes importados.`)
  console.log(`Ficheiro original preservado em ${sourcePath}.`)
} finally {
  await pool.end()
}
