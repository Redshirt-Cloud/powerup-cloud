CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('staff', 'website', 'facebook', 'phone', 'other')),
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  fulfillment_date TEXT NOT NULL,
  fulfillment_method TEXT NOT NULL CHECK (fulfillment_method IN ('pickup', 'delivery')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'preparing', 'ready', 'fulfilled', 'cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'refunded')),
  notes TEXT,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0)
);

CREATE INDEX orders_fulfillment_date_idx ON orders(fulfillment_date, status);
CREATE INDEX order_items_order_id_idx ON order_items(order_id);
