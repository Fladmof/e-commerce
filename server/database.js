import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg
const __dirname = path.dirname(fileURLToPath(import.meta.url))

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não está configurada.')
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(process.env.DATABASE_SSL === 'true'
    ? {
        ssl: {
          rejectUnauthorized: true,
          ...(process.env.DATABASE_SSL_CA ? { ca: process.env.DATABASE_SSL_CA } : {})
        }
      }
    : {})
})

export async function initializeDatabase() {
  const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8')
  await pool.query(schema)
}

export async function withTransaction(operation) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      error.rollbackError = rollbackError
    }
    throw error
  } finally {
    client.release()
  }
}

export const mapProduct = (row) => ({
  id: row.id,
  name: row.name,
  category: row.category,
  price: Number(row.price),
  oldPrice: Number(row.old_price),
  rating: Number(row.rating),
  image: row.image,
  description: row.description,
  featured: row.featured,
  stock: Number(row.stock)
})

export const mapOrder = (row) => ({
  id: row.id,
  userId: row.user_id,
  status: row.status,
  createdAt: row.created_at,
  customer: row.customer,
  shipping: Number(row.shipping),
  total: Number(row.total),
  items: row.items
})
