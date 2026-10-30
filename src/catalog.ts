import type { Env } from './auth';
import { nonnegative, object, optional, positiveInteger, string } from './input';

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
  const rows = await env.DB.prepare('SELECT id, name, price_cents AS priceCents, kind, description, active FROM products ORDER BY name').all();
  return Response.json({ products: rows.results });
}

export async function getProduct(env: Env, id: string): Promise<Response> {
  const product = await env.DB.prepare('SELECT id, name, price_cents AS priceCents, kind, description, active FROM products WHERE id = ?').bind(id).first();
  if (!product) return Response.json({ error: 'Product not found' }, { status: 404 });
  const [ingredients, components] = await Promise.all([
    env.DB.prepare('SELECT ingredient_id AS id, servings FROM product_ingredients WHERE product_id = ?').bind(id).all(),
    env.DB.prepare('SELECT product_id AS id, quantity FROM combo_products WHERE combo_id = ?').bind(id).all()
  ]);
  return Response.json({ product: { ...product, ingredients: ingredients.results, components: components.results } });
}

export async function saveProduct(env: Env, raw: unknown, id?: string): Promise<Response> {
  const data = object(raw);
  const name = string(data.name, 'name');
  const priceCents = nonnegative(data.priceCents, 'priceCents');
  if (priceCents === null || !Number.isInteger(priceCents)) throw new Error('priceCents must be an integer');
  const kind = data.kind ?? 'individual';
  if (kind !== 'individual' && kind !== 'combo') throw new Error('Invalid product kind');
  const description = optional(data.description, 'description', 1000);
  const ingredients = relations(data.ingredients, 'ingredient');
  const components = relations(data.components, 'component');
  if (kind === 'combo' && !components.length) throw new Error('A combo needs at least one product');
  if (kind === 'individual' && components.length) throw new Error('Only combos can contain products');
  if (kind === 'combo' && ingredients.length) throw new Error('Add ingredients to the products inside the combo');
  const productId = id ?? crypto.randomUUID();
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
    id ? env.DB.prepare('UPDATE products SET name = ?, price_cents = ?, kind = ?, description = ? WHERE id = ?').bind(name, priceCents, kind, description, id)
      : env.DB.prepare('INSERT INTO products (id, name, price_cents, kind, description) VALUES (?, ?, ?, ?, ?)').bind(productId, name, priceCents, kind, description),
    env.DB.prepare('DELETE FROM product_ingredients WHERE product_id = ?').bind(productId),
    env.DB.prepare('DELETE FROM combo_products WHERE combo_id = ?').bind(productId),
    ...ingredients.map(row => env.DB.prepare('INSERT INTO product_ingredients (product_id, ingredient_id, servings) VALUES (?, ?, ?)').bind(productId, row.id, row.servings)),
    ...components.map(row => env.DB.prepare('INSERT INTO combo_products (combo_id, product_id, quantity) VALUES (?, ?, ?)').bind(productId, row.id, row.quantity))
  ];
  await env.DB.batch(statements);
  return Response.json({ id: productId }, { status: id ? 200 : 201 });
}
