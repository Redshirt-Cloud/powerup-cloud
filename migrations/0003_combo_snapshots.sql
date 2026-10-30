CREATE TABLE order_item_components (
  order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (order_item_id, product_id)
);
