CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'customer', 'seller')),
  profile_image TEXT,
  profile_image_key TEXT,
  style_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS style_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pickup_latitude DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pickup_longitude DOUBLE PRECISION;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'customer', 'seller'));

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC(12, 2) CHECK (price > 0),
  price_aoa NUMERIC(14, 2) CHECK (price_aoa > 0),
  old_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (old_price >= 0),
  old_price_aoa NUMERIC(14, 2) CHECK (old_price_aoa >= 0),
  rating SMALLINT NOT NULL DEFAULT 4 CHECK (rating BETWEEN 0 AND 5),
  image TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  seller_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE products ALTER COLUMN price DROP NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_aoa NUMERIC(14, 2) CHECK (price_aoa > 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS old_price_aoa NUMERIC(14, 2) CHECK (old_price_aoa >= 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS seller_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_price_currency_check;
ALTER TABLE products ADD CONSTRAINT products_price_currency_check
  CHECK ((price IS NOT NULL) <> (price_aoa IS NOT NULL));

CREATE TABLE IF NOT EXISTS pending_orders (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  shipping NUMERIC(12, 2) NOT NULL CHECK (shipping >= 0),
  commission NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (commission >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS commission NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (commission >= 0);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  stripe_session_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('paid', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL,
  customer JSONB NOT NULL,
  shipping NUMERIC(12, 2) NOT NULL CHECK (shipping >= 0),
  commission NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (commission >= 0),
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array')
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (commission >= 0);

CREATE TABLE IF NOT EXISTS purchase_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  comment TEXT NOT NULL CHECK (char_length(comment) BETWEEN 3 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, customer_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pending_orders_user_id_idx ON pending_orders(user_id);
CREATE INDEX IF NOT EXISTS orders_user_id_created_at_idx ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS products_seller_id_idx ON products(seller_id);
CREATE INDEX IF NOT EXISTS chat_conversations_customer_id_idx ON chat_conversations(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_conversations_seller_id_idx ON chat_conversations(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_conversation_id_idx ON chat_messages(conversation_id, created_at);
