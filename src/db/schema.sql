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
