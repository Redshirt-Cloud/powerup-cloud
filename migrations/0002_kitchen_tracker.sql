ALTER TABLE products ADD COLUMN kind TEXT NOT NULL DEFAULT 'individual' CHECK (kind IN ('individual', 'combo'));
ALTER TABLE products ADD COLUMN description TEXT;

CREATE TABLE ingredients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  serving_size REAL NOT NULL DEFAULT 1 CHECK (serving_size > 0),
  serving_unit TEXT NOT NULL DEFAULT 'serving',
  calories REAL,
  protein_g REAL,
  carbs_g REAL,
  fat_g REAL,
  fiber_g REAL,
  sugar_g REAL,
  sodium_mg REAL,
  allergens TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_ingredients (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  servings REAL NOT NULL CHECK (servings > 0),
  PRIMARY KEY (product_id, ingredient_id)
);

CREATE TABLE combo_products (
  combo_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (combo_id, product_id),
  CHECK (combo_id <> product_id)
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  cadence TEXT NOT NULL CHECK (cadence IN ('weekly', 'monthly')),
  fulfillment_method TEXT NOT NULL CHECK (fulfillment_method IN ('pickup', 'delivery')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subscription_items (
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (subscription_id, product_id)
);

ALTER TABLE orders ADD COLUMN subscription_id TEXT REFERENCES subscriptions(id);
CREATE UNIQUE INDEX orders_subscription_occurrence_idx ON orders(subscription_id, fulfillment_date) WHERE subscription_id IS NOT NULL;
CREATE INDEX subscriptions_status_idx ON subscriptions(status, start_date);

CREATE TABLE staff_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE staff_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX staff_sessions_expiry_idx ON staff_sessions(expires_at);

CREATE TABLE login_attempts (
  email TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);
