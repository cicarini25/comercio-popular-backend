-- Comércio Popular — Schema inicial do banco de dados (PostgreSQL)

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(150) NOT NULL,
  email           VARCHAR(150) UNIQUE NOT NULL,
  password_hash   VARCHAR(255),
  google_id       VARCHAR(255) UNIQUE,
  cpf             VARCHAR(14) UNIQUE,
  phone           VARCHAR(20),
  is_verified_face BOOLEAN DEFAULT FALSE,
  is_verified_sms  BOOLEAN DEFAULT FALSE,
  is_seller       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sellers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_name      VARCHAR(150) NOT NULL,
  plan            VARCHAR(50) NOT NULL DEFAULT 'basico', -- basico, plus, premium
  plan_status     VARCHAR(20) NOT NULL DEFAULT 'trial',  -- trial, ativo, atrasado, cancelado
  pix_key         VARCHAR(150),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID REFERENCES sellers(id) ON DELETE SET NULL, -- NULL = produto de afiliado
  source          VARCHAR(30) NOT NULL DEFAULT 'proprio',
  -- proprio, mercado_livre, shopee, amazon, aliexpress, netshoes, shein, tiktok_shop, magalu
  external_id     VARCHAR(150), -- id do produto na plataforma de afiliado, quando aplicável
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
  -- aguardando_pagamento, pago, enviado, entregue, cancelado
  subtotal          NUMERIC(10,2) NOT NULL,
  shipping_fee      NUMERIC(10,2) NOT NULL DEFAULT 0,
  total             NUMERIC(10,2) NOT NULL,
  payment_method    VARCHAR(30),
  mp_preference_id  VARCHAR(150), -- id da preferência de pagamento no Mercado Pago
  mp_payment_id     VARCHAR(150), -- id do pagamento confirmado no Mercado Pago
  tracking_code     VARCHAR(50),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    UUID REFERENCES products(id),
  seller_id     UUID REFERENCES sellers(id),
  title         VARCHAR(255) NOT NULL, -- guardamos o título no momento da compra
  unit_price    NUMERIC(10,2) NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1,
  seller_amount NUMERIC(10,2), -- quanto o vendedor recebe deste item
  platform_fee  NUMERIC(10,2) -- quanto fica pra plataforma
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- Login com Google: como a tabela "users" já existe em produção,
-- o CREATE TABLE IF NOT EXISTS acima não altera ela. Estes comandos
-- garantem que o banco já publicado também receba as mudanças.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
