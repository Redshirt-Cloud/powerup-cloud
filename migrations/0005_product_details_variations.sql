CREATE TABLE product_details (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT,
  specifications TEXT,
  taxable INTEGER NOT NULL DEFAULT 0 CHECK (taxable IN (0, 1)),
  shipping_exempt INTEGER NOT NULL DEFAULT 0 CHECK (shipping_exempt IN (0, 1)),
  exclude_discounts INTEGER NOT NULL DEFAULT 0 CHECK (exclude_discounts IN (0, 1)),
  visible_online INTEGER NOT NULL DEFAULT 0 CHECK (visible_online IN (0, 1)),
  visible_foh INTEGER NOT NULL DEFAULT 0 CHECK (visible_foh IN (0, 1)),
  ghost_visible INTEGER NOT NULL DEFAULT 0 CHECK (ghost_visible IN (0, 1)),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  publish_on_save INTEGER NOT NULL DEFAULT 1 CHECK (publish_on_save IN (0, 1)),
  preorder_enabled INTEGER NOT NULL DEFAULT 0 CHECK (preorder_enabled IN (0, 1)),
  active_until TEXT,
  backup_product_id TEXT REFERENCES products(id),
  tags_json TEXT NOT NULL DEFAULT '[]',
  nutrition_json TEXT
);

CREATE TABLE product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX product_images_product_idx ON product_images(product_id, sort_order);

CREATE TABLE variation_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  selection_type TEXT NOT NULL DEFAULT 'single' CHECK (selection_type IN ('single', 'multiple')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE TABLE variation_options (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES variation_groups(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sku TEXT,
  base_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (base_price_cents >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (group_id, label)
);
CREATE INDEX variation_options_group_idx ON variation_options(group_id, sort_order);

CREATE TABLE product_variation_groups (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES variation_groups(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  min_required INTEGER NOT NULL DEFAULT 0 CHECK (min_required >= 0),
  max_allowed INTEGER NOT NULL DEFAULT 1 CHECK (max_allowed >= 1),
  PRIMARY KEY (product_id, group_id),
  CHECK (min_required <= max_allowed)
);
CREATE TABLE product_variation_options (
  product_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  option_id TEXT NOT NULL REFERENCES variation_options(id),
  price_override_cents INTEGER CHECK (price_override_cents >= 0),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, group_id, option_id),
  FOREIGN KEY (product_id, group_id) REFERENCES product_variation_groups(product_id, group_id) ON DELETE CASCADE
);
CREATE INDEX product_variation_options_group_idx ON product_variation_options(product_id, group_id, sort_order);

CREATE TABLE order_item_variations (
  order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  option_id TEXT NOT NULL,
  option_name TEXT NOT NULL,
  price_delta_cents INTEGER NOT NULL,
  group_order INTEGER NOT NULL,
  option_order INTEGER NOT NULL,
  PRIMARY KEY (order_item_id, group_id, option_id)
);
CREATE TABLE subscription_lines (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  selections_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX subscription_lines_subscription_idx ON subscription_lines(subscription_id, sort_order);
INSERT INTO subscription_lines (id, subscription_id, product_id, quantity, sort_order)
SELECT subscription_id || ':' || product_id, subscription_id, product_id, quantity,
  ROW_NUMBER() OVER (PARTITION BY subscription_id ORDER BY product_id) - 1
FROM subscription_items;
