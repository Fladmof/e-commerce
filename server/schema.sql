CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'customer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC(12, 2) NOT NULL CHECK (price > 0),
  old_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (old_price >= 0),
  rating SMALLINT NOT NULL DEFAULT 4 CHECK (rating BETWEEN 0 AND 5),
  image TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0)
);

CREATE TABLE IF NOT EXISTS pending_orders (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  shipping NUMERIC(12, 2) NOT NULL CHECK (shipping >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  stripe_session_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('paid', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL,
  customer JSONB NOT NULL,
  shipping NUMERIC(12, 2) NOT NULL CHECK (shipping >= 0),
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array')
);

CREATE INDEX IF NOT EXISTS pending_orders_user_id_idx ON pending_orders(user_id);
CREATE INDEX IF NOT EXISTS orders_user_id_created_at_idx ON orders(user_id, created_at DESC);
