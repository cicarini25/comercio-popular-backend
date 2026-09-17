-- Comércio Popular — Schema inicial do banco de dados (PostgreSQL)

CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(150) NOT NULL,
  email             VARCHAR(150) UNIQUE,
  password_hash     VARCHAR(255),
  google_id         VARCHAR(255) UNIQUE,
  tiktok_open_id    VARCHAR(255) UNIQUE,
  tiktok_display_name VARCHAR(150),
  tiktok_avatar_url TEXT,
  cpf               VARCHAR(14) UNIQUE,
  phone             VARCHAR(20),
  is_verified_face   BOOLEAN DEFAULT FALSE,
  is_verified_sms    BOOLEAN DEFAULT FALSE,
  is_seller          BOOLEAN DEFAULT FALSE,
  legal_accepted_at  TIMESTAMPTZ,
  legal_version      VARCHAR(32),
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sellers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_name      VARCHAR(150) NOT NULL,
  plan            VARCHAR(50) NOT NULL DEFAULT 'basico',
  plan_status     VARCHAR(20) NOT NULL DEFAULT 'trial',
  pix_key         VARCHAR(150),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID REFERENCES sellers(id) ON DELETE SET NULL,
  source          VARCHAR(30) NOT NULL DEFAULT 'proprio',
  external_id     VARCHAR(150),
  affiliate_link  TEXT,
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  price           NUMERIC(10,2) NOT NULL,
  image_url       TEXT,
  category        VARCHAR(100),
  stock_units     INTEGER DEFAULT 0,
  is_achadinho    BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  status            VARCHAR(30) NOT NULL DEFAULT 'aguardando_pagamento',
  subtotal          NUMERIC(10,2) NOT NULL,
  shipping_fee      NUMERIC(10,2) NOT NULL DEFAULT 0,
  total             NUMERIC(10,2) NOT NULL,
  payment_method    VARCHAR(30),
  mp_preference_id  VARCHAR(150),
  mp_payment_id     VARCHAR(150),
  tracking_code     VARCHAR(50),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    UUID REFERENCES products(id),
  seller_id     UUID REFERENCES sellers(id),
  title         VARCHAR(255) NOT NULL,
  unit_price    NUMERIC(10,2) NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1,
  seller_amount NUMERIC(10,2),
  platform_fee  NUMERIC(10,2)
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- Migrações compatíveis com a produção.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok_open_id VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok_display_name VARCHAR(150);
ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok_avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_version VARCHAR(32);

CREATE TABLE IF NOT EXISTS tiktok_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS tiktok_oauth_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash VARCHAR(64) UNIQUE NOT NULL,
  tiktok_open_id VARCHAR(255) NOT NULL,
  display_name VARCHAR(150),
  avatar_url TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tiktok_oauth_states_expires ON tiktok_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_tiktok_oauth_handoffs_expires ON tiktok_oauth_handoffs(expires_at);
