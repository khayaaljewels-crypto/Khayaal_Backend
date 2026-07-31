-- Khayaal Jewels — customer/order database schema
--
-- Design note: the original spec sketched `default_address`, `city`, `state`,
-- `pincode` as columns directly on `customers`, alongside a separate
-- requirement for multiple labeled saved addresses (Home/Office/Other).
-- Storing a "default address" twice (once flattened on customers, once in
-- the addresses table) would require keeping two copies in sync on every
-- edit and invites bugs. Instead, `addresses.is_default` is the single
-- source of truth — the customer's default address is simply the row where
-- is_default = true. Fewer places for the data to drift apart.
--
-- Design note 2: the original spec sketched `orders` with one row per
-- product (a single `product_id` + `quantity` + `price` column). A real
-- checkout can contain multiple products in one order, and a single overall
-- `status` naturally belongs to the whole order, not to each product line.
-- So this schema uses a standard orders + order_items split instead —
-- one `orders` row per checkout, with an `order_items` row per product in
-- that order. This also matches how the existing WhatsApp-based order flow
-- already models an order (see PROJECT_DOCUMENTATION/16_DATABASE_STRUCTURE.md).

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  profile_image TEXT,
  phone VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active | disabled
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS addresses (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label VARCHAR(50) NOT NULL DEFAULT 'Home', -- Home | Office | Other | custom
  recipient_name VARCHAR(255) NOT NULL,
  recipient_phone VARCHAR(20) NOT NULL,
  address_line TEXT NOT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  landmark VARCHAR(255),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_addresses_customer_id ON addresses(customer_id);

CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number VARCHAR(20) UNIQUE NOT NULL, -- e.g. KH0001
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  recipient_name VARCHAR(255) NOT NULL,
  recipient_phone VARCHAR(20) NOT NULL,
  address_line TEXT NOT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  landmark VARCHAR(255),
  subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0,
  discount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  shipping_fee NUMERIC(10, 2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(10, 2) NOT NULL DEFAULT 0,
  coupon VARCHAR(50),
  notes TEXT,
  -- Status vocabulary as specified for the customer-facing order system.
  -- Note: this differs from the admin dashboard's existing (localStorage-based)
  -- order status list — see PROJECT_DOCUMENTATION for the unification TODO.
  status VARCHAR(20) NOT NULL DEFAULT 'Pending', -- Pending | Confirmed | Processing | Ready | Completed | Cancelled
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id VARCHAR(50) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  product_image TEXT,
  variant_label VARCHAR(100),
  quantity INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(10, 2) NOT NULL,
  line_total NUMERIC(10, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- Design note: products/categories/collections used to live only in the
-- browser (ProductsContext/CategoriesContext/CollectionsContext +
-- localStorage), with product_id columns below as a loose string reference
-- (e.g. "kj-abc123") to that client-side id and no products table to
-- foreign-key against.
--
-- (An earlier attempt at this same table briefly existed and was reverted —
-- a `pg`/Neon connection-string incompatibility, `channel_binding=require`,
-- made every DB call hang before any SQL executed, so it was pulled back out
-- rather than risk it silently applying later against a database it was
-- never actually tested on. That connection issue is fixed now — see
-- src/db/pool.js — so this is a fresh, verified attempt.)
--
-- id is kept as VARCHAR(50), not SERIAL, to match the existing client-side
-- "kj-xxxxxxx" id format already used by product_images.product_id/
-- order_items.product_id above, and by any localStorage catalogue data being
-- imported via POST /api/admin/import — this avoids a data-type migration
-- on those two existing columns.
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(150) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  image TEXT, -- Cloudinary URL
  hidden BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collections (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(150) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  image TEXT, -- Cloudinary URL
  hidden BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(50) PRIMARY KEY,
  slug VARCHAR(200) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  sku VARCHAR(100),
  brand VARCHAR(150) DEFAULT 'Khayaal Jewels',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
  occasion VARCHAR(50),
  price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  old_price NUMERIC(10, 2),
  cost_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  material VARCHAR(100),
  stone VARCHAR(100),
  color VARCHAR(100),
  rating NUMERIC(2, 1) NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  short_description TEXT,
  care_instructions TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  specs JSONB NOT NULL DEFAULT '{}',
  delivery_days INTEGER NOT NULL DEFAULT 5,
  return_days INTEGER NOT NULL DEFAULT 7,
  cod_available BOOLEAN NOT NULL DEFAULT true,
  variants JSONB NOT NULL DEFAULT '[]',
  ring_sizes JSONB,
  is_best_seller BOOLEAN NOT NULL DEFAULT false,
  is_new_arrival BOOLEAN NOT NULL DEFAULT false,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_trending BOOLEAN NOT NULL DEFAULT false,
  is_coming_soon BOOLEAN NOT NULL DEFAULT false,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_collection ON products(collection_id);
CREATE INDEX IF NOT EXISTS idx_products_published ON products(is_published);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);

CREATE TABLE IF NOT EXISTS product_images (
  id SERIAL PRIMARY KEY,
  product_id VARCHAR(50) NOT NULL,
  image_path TEXT NOT NULL, -- opaque, driver-owned: local relative path or Cloudinary public_id
  is_thumbnail BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);

-- Added NOT VALID so this can't fail on rows already in product_images from
-- before the products table existed — it only enforces the FK for rows
-- inserted/updated from now on, without a (possibly failing) scan of
-- existing data. Run `VALIDATE CONSTRAINT` manually later once you've
-- confirmed every existing product_images.product_id has a matching row in
-- products (e.g. after the one-time localStorage import).
DO $$ BEGIN
  ALTER TABLE product_images
    ADD CONSTRAINT fk_product_images_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
