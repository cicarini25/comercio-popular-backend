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

-- ============================================================
-- HUB DE PRODUTOS: catálogo próprio + ofertas afiliadas
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS product_kind VARCHAR(20) NOT NULL DEFAULT 'proprio';
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand VARCHAR(120);
ALTER TABLE products ADD COLUMN IF NOT EXISTS ean VARCHAR(32);
ALTER TABLE products ADD COLUMN IF NOT EXISTS slug VARCHAR(280);
ALTER TABLE products ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ativo';
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE products ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_products_kind ON products(product_kind);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_ean ON products(ean);

CREATE TABLE IF NOT EXISTS affiliate_platforms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(40) UNIQUE NOT NULL,
  name            VARCHAR(100) NOT NULL,
  logo_url        TEXT,
  website_url     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_offers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  offer_type            VARCHAR(20) NOT NULL DEFAULT 'afiliada',
  platform_id           UUID REFERENCES affiliate_platforms(id) ON DELETE SET NULL,
  external_id           VARCHAR(180),
  product_url           TEXT,
  affiliate_url         TEXT,
  price                 NUMERIC(12,2),
  original_price        NUMERIC(12,2),
  currency              VARCHAR(3) NOT NULL DEFAULT 'BRL',
  stock_units           INTEGER,
  availability          VARCHAR(30) NOT NULL DEFAULT 'desconhecida',
  commission_rate       NUMERIC(7,3),
  seller_name           VARCHAR(180),
  is_free_shipping      BOOLEAN,
  is_fast_shipping      BOOLEAN,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  sync_status            VARCHAR(30) NOT NULL DEFAULT 'manual',
  last_synced_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_product_offer_type CHECK (offer_type IN ('propria', 'afiliada'))
);

CREATE INDEX IF NOT EXISTS idx_product_offers_product ON product_offers(product_id);
CREATE INDEX IF NOT EXISTS idx_product_offers_platform ON product_offers(platform_id);
CREATE INDEX IF NOT EXISTS idx_product_offers_active ON product_offers(is_active);
CREATE INDEX IF NOT EXISTS idx_product_offers_external ON product_offers(platform_id, external_id);

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_id        UUID NOT NULL REFERENCES product_offers(id) ON DELETE CASCADE,
  platform_id     UUID REFERENCES affiliate_platforms(id) ON DELETE SET NULL,
  clicked_at      TIMESTAMPTZ DEFAULT now(),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_user ON affiliate_clicks(user_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_offer ON affiliate_clicks(offer_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_platform ON affiliate_clicks(platform_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_date ON affiliate_clicks(clicked_at);

-- Plataformas previstas para o hub. A integração individual será feita em etapas
-- e cada plataforma deverá respeitar suas próprias regras de afiliado/API.
INSERT INTO affiliate_platforms (code, name)
VALUES
  ('mercadolivre', 'Mercado Livre'),
  ('shopee', 'Shopee'),
  ('amazon', 'Amazon'),
  ('aliexpress', 'AliExpress'),
  ('shein', 'SHEIN'),
  ('magalu', 'Magalu')
ON CONFLICT (code) DO NOTHING;

 
-- ============================================================
-- HUB DE INTEGRAÇÕES / IMPORTAÇÃO / PAREAMENTO
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS normalized_title TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS model VARCHAR(180);
ALTER TABLE products ADD COLUMN IF NOT EXISTS canonical_key VARCHAR(220);

CREATE INDEX IF NOT EXISTS idx_products_normalized_title
  ON products USING gin (to_tsvector('simple', COALESCE(normalized_title, title)));
CREATE INDEX IF NOT EXISTS idx_products_model ON products(model);
CREATE INDEX IF NOT EXISTS idx_products_canonical_key ON products(canonical_key);

ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS canonical_url TEXT;
ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_offers_platform_external
  ON product_offers(platform_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS integration_connections (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id             UUID NOT NULL REFERENCES affiliate_platforms(id) ON DELETE CASCADE,
  account_label           VARCHAR(150) NOT NULL,
  auth_type               VARCHAR(30) NOT NULL DEFAULT 'oauth2',
  credential_ref          VARCHAR(180),
  status                  VARCHAR(30) NOT NULL DEFAULT 'configured',
  last_sync_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_integration_connections_platform
  ON integration_connections(platform_id);

CREATE TABLE IF NOT EXISTS catalog_import_jobs (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id               UUID REFERENCES affiliate_platforms(id) ON DELETE SET NULL,
  integration_connection_id UUID REFERENCES integration_connections(id) ON DELETE SET NULL,
  source_type               VARCHAR(40) NOT NULL,
  status                    VARCHAR(30) NOT NULL DEFAULT 'queued',
  requested_count           INTEGER NOT NULL DEFAULT 0,
  discovered_count          INTEGER NOT NULL DEFAULT 0,
  imported_count            INTEGER NOT NULL DEFAULT 0,
  updated_count             INTEGER NOT NULL DEFAULT 0,
  matched_count             INTEGER NOT NULL DEFAULT 0,
  review_count              INTEGER NOT NULL DEFAULT 0,
  error_count               INTEGER NOT NULL DEFAULT 0,
  started_at                TIMESTAMPTZ,
  finished_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ DEFAULT now(),
  metadata                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at                TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_import_jobs_status
  ON catalog_import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_catalog_import_jobs_platform
  ON catalog_import_jobs(platform_id);

CREATE TABLE IF NOT EXISTS catalog_import_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                UUID NOT NULL REFERENCES catalog_import_jobs(id) ON DELETE CASCADE,
  external_id           VARCHAR(180),
  source_url            TEXT,
  normalized_url        TEXT,
  raw_payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  product_id            UUID REFERENCES products(id) ON DELETE SET NULL,
  import_status         VARCHAR(30) NOT NULL DEFAULT 'pending',
  error_message         TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_import_items_job
  ON catalog_import_items(job_id);
CREATE INDEX IF NOT EXISTS idx_catalog_import_items_external
  ON catalog_import_items(external_id);

CREATE TABLE IF NOT EXISTS product_match_candidates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_offer_id       UUID NOT NULL REFERENCES product_offers(id) ON DELETE CASCADE,
  candidate_product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  score                 NUMERIC(7,4) NOT NULL,
  decision              VARCHAR(20) NOT NULL DEFAULT 'revisao',
  match_basis           JSONB NOT NULL DEFAULT '[]'::jsonb,
  contradictions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  reviewed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_offer_id, candidate_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_match_candidates_offer
  ON product_match_candidates(source_offer_id);
CREATE INDEX IF NOT EXISTS idx_product_match_candidates_score
  ON product_match_candidates(score DESC);
CREATE INDEX IF NOT EXISTS idx_product_match_candidates_decision
  ON product_match_candidates(decision);
