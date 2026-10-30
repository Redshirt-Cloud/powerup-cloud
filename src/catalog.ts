import type { Env } from './auth';
import { nonnegative, object, optional, positiveInteger, string } from './input';
import { productVariations, parseVariationAssignments, variationStatements } from './variations';
import { validDate } from './recurrence';

const nutrition = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'sugarG', 'sodiumMg'] as const;

export async function listIngredients(env: Env): Promise<Response> {
  const rows = await env.DB.prepare('SELECT id, name, serving_size AS servingSize, serving_unit AS servingUnit, calories, protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG, fiber_g AS fiberG, sugar_g AS sugarG, sodium_mg AS sodiumMg, allergens, notes, active FROM ingredients ORDER BY name').all();
  return Response.json({ ingredients: rows.results });
}

export async function saveIngredient(env: Env, raw: unknown, id?: string): Promise<Response> {
  const data = object(raw);
  const name = string(data.name, 'name');
  const servingSize = nonnegative(data.servingSize ?? 1, 'servingSize');
  if (!servingSize) throw new Error('servingSize must be greater than zero');
  const servingUnit = string(data.servingUnit ?? 'serving', 'servingUnit', 40);
  const values = nutrition.map(key => nonnegative(data[key], key));
  const allergens = optional(data.allergens, 'allergens', 500);
  const notes = optional(data.notes, 'notes');
  const ingredientId = id ?? crypto.randomUUID();
  if (id) {
    const result = await env.DB.prepare('UPDATE ingredients SET name = ?, serving_size = ?, serving_unit = ?, calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?, sugar_g = ?, sodium_mg = ?, allergens = ?, notes = ? WHERE id = ?')
      .bind(name, servingSize, servingUnit, ...values, allergens, notes, id).run();
    if (!result.meta.changes) return Response.json({ error: 'Ingredient not found' }, { status: 404 });
  } else {
    await env.DB.prepare('INSERT INTO ingredients (id, name, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, allergens, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(ingredientId, name, servingSize, servingUnit, ...values, allergens, notes).run();
  }
  return Response.json({ id: ingredientId }, { status: id ? 200 : 201 });
}

type ProductRelation = { id: string; quantity?: number; servings?: number };

function relations(value: unknown, kind: 'ingredient' | 'component'): ProductRelation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error(`Invalid ${kind} list`);
  const rows = value.map(item => {
    const row = object(item);
    const id = string(row.id, `${kind} id`, 100);
    if (kind === 'ingredient') {
      const servings = nonnegative(row.servings, 'servings');
      if (!servings) throw new Error('servings must be greater than zero');
      return { id, servings };
    }
    return { id, quantity: positiveInteger(row.quantity, 'quantity') };
  });
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error(`Duplicate ${kind} id`);
  return rows;
}

export async function listProducts(env: Env): Promise<Response> {
  const rows = await env.DB.prepare('SELECT p.id, p.name, p.price_cents AS priceCents, p.weekly_price_cents AS weeklyPriceCents, p.kind, p.description, p.active, p.category_id AS categoryId, c.name AS categoryName, d.sku, (SELECT object_key FROM product_images WHERE product_id = p.id ORDER BY sort_order LIMIT 1) AS imageKey FROM products p LEFT JOIN product_categories c ON c.id = p.category_id LEFT JOIN product_details d ON d.product_id = p.id ORDER BY c.sort_order, p.name').all<{ imageKey: string | null }>();
  return Response.json({ products: rows.results.map(row => ({ ...row, imageUrl: row.imageKey ? `https://cdn.powerupwv.com/${row.imageKey}` : null })) });
}

export async function listCategories(env: Env): Promise<Response> {
  const rows = await env.DB.prepare('SELECT id, name, sort_order AS sortOrder, active FROM product_categories ORDER BY sort_order').all();
  return Response.json({ categories: rows.results });
}

export async function getProduct(env: Env, id: string): Promise<Response> {
  const product = await env.DB.prepare('SELECT p.id, p.name, p.price_cents AS priceCents, p.weekly_price_cents AS weeklyPriceCents, p.kind, p.description, p.active, p.category_id AS categoryId, c.name AS categoryName FROM products p LEFT JOIN product_categories c ON c.id = p.category_id WHERE p.id = ?').bind(id).first();
  if (!product) return Response.json({ error: 'Product not found' }, { status: 404 });
  const [ingredients, components, details, images, variations] = await Promise.all([
    env.DB.prepare('SELECT ingredient_id AS id, servings FROM product_ingredients WHERE product_id = ?').bind(id).all(),
    env.DB.prepare('SELECT product_id AS id, quantity FROM combo_products WHERE combo_id = ?').bind(id).all(),
    env.DB.prepare('SELECT sku, specifications, taxable, shipping_exempt AS shippingExempt, exclude_discounts AS excludeDiscounts, visible_online AS visibleOnline, visible_foh AS visibleFoh, ghost_visible AS ghostVisible, featured, publish_on_save AS publishOnSave, preorder_enabled AS preorderEnabled, active_until AS activeUntil, backup_product_id AS backupProductId, tags_json AS tagsJson, nutrition_json AS nutritionJson FROM product_details WHERE product_id = ?').bind(id).first<Record<string, unknown>>(),
    env.DB.prepare('SELECT id, object_key AS objectKey, sort_order AS sortOrder FROM product_images WHERE product_id = ? ORDER BY sort_order').bind(id).all<{ id: string; objectKey: string; sortOrder: number }>(),
    productVariations(env, id)
  ]);
  const info: Record<string, unknown> | null = details ? { ...details, tags: JSON.parse(String(details.tagsJson || '[]')), nutrition: details.nutritionJson ? JSON.parse(String(details.nutritionJson)) : null } : null;
  if (info) { delete info.tagsJson; delete info.nutritionJson; }
  return Response.json({ product: { ...product, ingredients: ingredients.results, components: components.results, details: info, images: images.results.map(image => ({ ...image, url: `https://cdn.powerupwv.com/${image.objectKey}` })), variations } });
}

export async function saveProduct(env: Env, raw: unknown, id?: string): Promise<Response> {
  const data = object(raw);
  const name = string(data.name, 'name');
  const priceCents = nonnegative(data.priceCents, 'priceCents');
  if (priceCents === null || !Number.isInteger(priceCents)) throw new Error('priceCents must be an integer');
  const weeklyPriceCents = nonnegative(data.weeklyPriceCents, 'weeklyPriceCents');
  if (weeklyPriceCents !== null && !Number.isInteger(weeklyPriceCents)) throw new Error('weeklyPriceCents must be an integer');
  const categoryId = optional(data.categoryId, 'categoryId', 100);
  if (categoryId) {
    const category = await env.DB.prepare('SELECT id FROM product_categories WHERE id = ? AND active = 1').bind(categoryId).first();
    if (!category) throw new Error('Invalid categoryId');
  }
  const kind = data.kind ?? 'individual';
  if (kind !== 'individual' && kind !== 'combo') throw new Error('Invalid product kind');
  const description = optional(data.description, 'description', 1000);
  const ingredients = relations(data.ingredients, 'ingredient');
  const components = relations(data.components, 'component');
  if (kind === 'combo' && !components.length) throw new Error('A combo needs at least one product');
  if (kind === 'individual' && components.length) throw new Error('Only combos can contain products');
  if (kind === 'combo' && ingredients.length) throw new Error('Add ingredients to the products inside the combo');
  const productId = id ?? crypto.randomUUID();
  const assignments = data.variations === undefined ? null : await parseVariationAssignments(env, data.variations);
  const details = data.details === undefined ? null : object(data.details);
  let detailStatement: D1PreparedStatement | null = null;
  if (details) {
    const flags = ['taxable', 'shippingExempt', 'excludeDiscounts', 'visibleOnline', 'visibleFoh', 'ghostVisible', 'featured', 'publishOnSave', 'preorderEnabled'] as const;
    const values = flags.map(key => {
      if (details[key] !== true && details[key] !== false) throw new Error(`Invalid ${key}`);
      return details[key] ? 1 : 0;
    });
    const activeUntil = optional(details.activeUntil, 'activeUntil', 10);
    if (activeUntil && !validDate(activeUntil)) throw new Error('Invalid activeUntil');
    const backupProductId = optional(details.backupProductId, 'backupProductId', 100);
    if (backupProductId) {
      if (backupProductId === productId || !await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(backupProductId).first()) throw new Error('Invalid backupProductId');
    }
    if (!Array.isArray(details.tags) || details.tags.length > 30 || details.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 40)) throw new Error('Invalid tags');
    const nutrition = details.nutrition === null || details.nutrition === undefined ? null : object(details.nutrition);
    const nutritionJson = nutrition ? JSON.stringify(nutrition) : null;
    if (nutritionJson && nutritionJson.length > 5000) throw new Error('Invalid nutrition');
    detailStatement = env.DB.prepare('INSERT INTO product_details (product_id, sku, specifications, taxable, shipping_exempt, exclude_discounts, visible_online, visible_foh, ghost_visible, featured, publish_on_save, preorder_enabled, active_until, backup_product_id, tags_json, nutrition_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET sku = excluded.sku, specifications = excluded.specifications, taxable = excluded.taxable, shipping_exempt = excluded.shipping_exempt, exclude_discounts = excluded.exclude_discounts, visible_online = excluded.visible_online, visible_foh = excluded.visible_foh, ghost_visible = excluded.ghost_visible, featured = excluded.featured, publish_on_save = excluded.publish_on_save, preorder_enabled = excluded.preorder_enabled, active_until = excluded.active_until, backup_product_id = excluded.backup_product_id, tags_json = excluded.tags_json, nutrition_json = excluded.nutrition_json')
      .bind(productId, optional(details.sku, 'sku', 80), optional(details.specifications, 'specifications', 4000), ...values, activeUntil, backupProductId, JSON.stringify(details.tags.map(tag => (tag as string).trim())), nutritionJson);
  }
  if (components.some(row => row.id === productId)) throw new Error('A combo cannot contain itself');
  if (components.length) {
    const found = await env.DB.prepare(`SELECT id FROM products WHERE kind = 'individual' AND active = 1 AND id IN (${components.map(() => '?').join(',')})`).bind(...components.map(row => row.id)).all();
    if (found.results.length !== components.length) throw new Error('Combo components must be active individual products');
  }
  if (ingredients.length) {
    const found = await env.DB.prepare(`SELECT id FROM ingredients WHERE active = 1 AND id IN (${ingredients.map(() => '?').join(',')})`).bind(...ingredients.map(row => row.id)).all();
    if (found.results.length !== ingredients.length) throw new Error('Product ingredients must be active');
  }
  if (id) {
    const exists = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first();
    if (!exists) return Response.json({ error: 'Product not found' }, { status: 404 });
  }
  const statements = [
    id ? env.DB.prepare('UPDATE products SET name = ?, price_cents = ?, weekly_price_cents = ?, category_id = ?, kind = ?, description = ? WHERE id = ?').bind(name, priceCents, weeklyPriceCents, categoryId, kind, description, id)
      : env.DB.prepare('INSERT INTO products (id, name, price_cents, weekly_price_cents, category_id, kind, description) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(productId, name, priceCents, weeklyPriceCents, categoryId, kind, description),
    ...(detailStatement ? [detailStatement] : []),
    env.DB.prepare('DELETE FROM product_ingredients WHERE product_id = ?').bind(productId),
    env.DB.prepare('DELETE FROM combo_products WHERE combo_id = ?').bind(productId),
    ...ingredients.map(row => env.DB.prepare('INSERT INTO product_ingredients (product_id, ingredient_id, servings) VALUES (?, ?, ?)').bind(productId, row.id, row.servings)),
    ...components.map(row => env.DB.prepare('INSERT INTO combo_products (combo_id, product_id, quantity) VALUES (?, ?, ?)').bind(productId, row.id, row.quantity)),
    ...(assignments ? await variationStatements(env, productId, assignments) : [])
  ];
  await env.DB.batch(statements);
  return Response.json({ id: productId }, { status: id ? 200 : 201 });
}

type MediaEnv = Env & { PUBLIC_ASSETS: R2Bucket };

export async function uploadProductImage(request: Request, env: MediaEnv, productId: string): Promise<Response> {
  if (Number(request.headers.get('Content-Length') ?? 0) > 5_000_000) return Response.json({ error: 'Image exceeds 5 MB' }, { status: 413 });
  const product = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first();
  if (!product) return Response.json({ error: 'Product not found' }, { status: 404 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > 5_000_000) return Response.json({ error: 'Image must be under 5 MB' }, { status: 413 });
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!jpeg && !png && !webp) throw new Error('Invalid image format');
  const extension = jpeg ? 'jpg' : png ? 'png' : 'webp';
  const contentType = jpeg ? 'image/jpeg' : png ? 'image/png' : 'image/webp';
  const imageId = crypto.randomUUID();
  const objectKey = `products/${productId}/${imageId}.${extension}`;
  await env.PUBLIC_ASSETS.put(objectKey, bytes, { httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' } });
  try {
    await env.DB.prepare('INSERT INTO product_images (id, product_id, object_key, sort_order) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM product_images WHERE product_id = ?))').bind(imageId, productId, objectKey, productId).run();
  } catch (error) {
    await env.PUBLIC_ASSETS.delete(objectKey);
    throw error;
  }
  return Response.json({ image: { id: imageId, objectKey, url: `https://cdn.powerupwv.com/${objectKey}` } }, { status: 201 });
}

export async function deleteProductImage(env: MediaEnv, productId: string, imageId: string): Promise<Response> {
  const image = await env.DB.prepare('SELECT object_key AS objectKey FROM product_images WHERE id = ? AND product_id = ?').bind(imageId, productId).first<{ objectKey: string }>();
  if (!image) return Response.json({ error: 'Image not found' }, { status: 404 });
  await env.PUBLIC_ASSETS.delete(image.objectKey);
  await env.DB.prepare('DELETE FROM product_images WHERE id = ?').bind(imageId).run();
  return Response.json({ deleted: true });
}
