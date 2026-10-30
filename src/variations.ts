import type { Env } from './auth';
import { nonnegative, object, optional, positiveInteger, string } from './input';

export type Selection = Record<string, string[]>;
export type ProductVariation = {
  groupId: string; name: string; selectionType: 'single' | 'multiple'; sortOrder: number;
  minRequired: number; maxAllowed: number;
  options: { id: string; label: string; sku: string | null; priceCents: number; basePriceCents: number; isDefault: boolean; sortOrder: number }[];
};

type GroupRow = { groupId: string; name: string; selectionType: 'single' | 'multiple'; sortOrder: number; minRequired: number; maxAllowed: number };
type OptionRow = { groupId: string; id: string; label: string; sku: string | null; priceCents: number; basePriceCents: number; isDefault: number; sortOrder: number };

export async function productVariations(env: Env, productId: string): Promise<ProductVariation[]> {
  const [groups, options] = await Promise.all([
    env.DB.prepare('SELECT pg.group_id AS groupId, g.name, g.selection_type AS selectionType, pg.sort_order AS sortOrder, pg.min_required AS minRequired, pg.max_allowed AS maxAllowed FROM product_variation_groups pg JOIN variation_groups g ON g.id = pg.group_id AND g.active = 1 WHERE pg.product_id = ? ORDER BY pg.sort_order').bind(productId).all<GroupRow>(),
    env.DB.prepare('SELECT po.group_id AS groupId, o.id, o.label, o.sku, COALESCE(po.price_override_cents, o.base_price_cents) AS priceCents, o.base_price_cents AS basePriceCents, po.is_default AS isDefault, po.sort_order AS sortOrder FROM product_variation_options po JOIN variation_options o ON o.id = po.option_id AND o.active = 1 WHERE po.product_id = ? ORDER BY po.sort_order').bind(productId).all<OptionRow>()
  ]);
  return groups.results.map(group => ({ ...group, options: options.results.filter(option => option.groupId === group.groupId).map(option => ({ ...option, isDefault: option.isDefault === 1 })) }));
}

export async function listVariationGroups(env: Env): Promise<Response> {
  const [groups, options] = await Promise.all([
    env.DB.prepare('SELECT id, name, selection_type AS selectionType, active FROM variation_groups ORDER BY name').all(),
    env.DB.prepare('SELECT id, group_id AS groupId, label, sku, base_price_cents AS basePriceCents, sort_order AS sortOrder, active FROM variation_options ORDER BY sort_order').all<{ id: string; groupId: string }>()
  ]);
  return Response.json({ groups: groups.results.map(group => ({ ...group, options: options.results.filter(option => option.groupId === group.id) })) });
}

export async function saveVariationGroup(env: Env, raw: unknown, id?: string): Promise<Response> {
  const data = object(raw);
  const name = string(data.name, 'name', 120);
  const selectionType = data.selectionType ?? 'single';
  if (selectionType !== 'single' && selectionType !== 'multiple') throw new Error('Invalid selectionType');
  if (!Array.isArray(data.options) || data.options.length < 1 || data.options.length > 100) throw new Error('options must contain 1 to 100 choices');
  const options = data.options.map((value, index) => {
    const row = object(value);
    const label = string(row.label, 'option label', 120);
    const price = nonnegative(row.basePriceCents ?? 0, 'basePriceCents');
    if (price === null || !Number.isInteger(price)) throw new Error('basePriceCents must be an integer');
    return { id: optional(row.id, 'option id', 100) ?? crypto.randomUUID(), label, sku: optional(row.sku, 'sku', 80), price, sortOrder: index };
  });
  if (new Set(options.map(option => option.label.toLowerCase())).size !== options.length) throw new Error('Duplicate option label');
  const groupId = id ?? crypto.randomUUID();
  let removedIds: string[] = [];
  if (id) {
    const existing = await env.DB.prepare('SELECT id FROM variation_groups WHERE id = ?').bind(id).first();
    if (!existing) return Response.json({ error: 'Variation group not found' }, { status: 404 });
    const known = await env.DB.prepare('SELECT id FROM variation_options WHERE group_id = ?').bind(id).all<{ id: string }>();
    const knownIds = new Set(known.results.map(row => row.id));
    for (const option of options) if (data.options[option.sortOrder] && (data.options[option.sortOrder] as Record<string, unknown>).id && !knownIds.has(option.id)) throw new Error('Invalid option id');
    removedIds = known.results.map(row => row.id).filter(optionId => !options.some(option => option.id === optionId));
    if (removedIds.length) {
      const used = await env.DB.prepare(`SELECT option_id FROM product_variation_options WHERE option_id IN (${removedIds.map(() => '?').join(',')}) LIMIT 1`).bind(...removedIds).first();
      if (used) throw new Error('Remove this choice from its products before deleting it from the shared group');
    }
  }
  await env.DB.batch([
    id ? env.DB.prepare('UPDATE variation_groups SET name = ?, selection_type = ? WHERE id = ?').bind(name, selectionType, id)
      : env.DB.prepare('INSERT INTO variation_groups (id, name, selection_type) VALUES (?, ?, ?)').bind(groupId, name, selectionType),
    ...options.map(option => env.DB.prepare('INSERT INTO variation_options (id, group_id, label, sku, base_price_cents, sort_order) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, sku = excluded.sku, base_price_cents = excluded.base_price_cents, sort_order = excluded.sort_order, active = 1').bind(option.id, groupId, option.label, option.sku, option.price, option.sortOrder)),
    ...removedIds.map(optionId => env.DB.prepare('UPDATE variation_options SET active = 0 WHERE id = ?').bind(optionId))
  ]);
  return Response.json({ id: groupId }, { status: id ? 200 : 201 });
}

export type VariationAssignment = { groupId: string; minRequired: number; maxAllowed: number; options: { id: string; priceCents: number; isDefault: boolean }[] };

export async function parseVariationAssignments(env: Env, value: unknown): Promise<VariationAssignment[]> {
  if (!Array.isArray(value) || value.length > 30) throw new Error('Invalid variation list');
  const groups = await listVariationGroups(env).then(response => response.json()) as { groups: { id: string; selectionType: string; active: number; options: { id: string; basePriceCents: number; active: number }[] }[] };
  const groupMap = new Map(groups.groups.filter(group => group.active).map(group => [group.id, group]));
  const assignments = value.map(item => {
    const row = object(item);
    const groupId = string(row.groupId, 'groupId', 100);
    const group = groupMap.get(groupId);
    if (!group) throw new Error('Invalid variation group');
    const minRequired = row.minRequired === 0 ? 0 : positiveInteger(row.minRequired, 'minRequired', 100);
    const maxAllowed = positiveInteger(row.maxAllowed, 'maxAllowed', 100);
    if (minRequired > maxAllowed || (group.selectionType === 'single' && maxAllowed !== 1)) throw new Error('Invalid variation limits');
    if (!Array.isArray(row.options) || row.options.length < 1 || row.options.length > 100) throw new Error('Invalid variation options');
    const allowed = new Map(group.options.filter(option => option.active).map(option => [option.id, option]));
    const options = row.options.map(value => {
      const option = object(value);
      const id = string(option.id, 'option id', 100);
      if (!allowed.has(id)) throw new Error('Invalid variation option');
      const price = nonnegative(option.priceCents, 'priceCents');
      if (price === null || !Number.isInteger(price)) throw new Error('priceCents must be an integer');
      return { id, priceCents: price, isDefault: option.isDefault === true };
    });
    if (new Set(options.map(option => option.id)).size !== options.length) throw new Error('Duplicate variation option');
    if (options.filter(option => option.isDefault).length > maxAllowed) throw new Error('Too many default options');
    if (minRequired > options.length) throw new Error('Variation requires more enabled options');
    return { groupId, minRequired, maxAllowed, options };
  });
  if (new Set(assignments.map(row => row.groupId)).size !== assignments.length) throw new Error('Duplicate variation group');
  return assignments;
}

export async function variationStatements(env: Env, productId: string, assignments: VariationAssignment[]): Promise<D1PreparedStatement[]> {
  const groups = await listVariationGroups(env).then(response => response.json()) as { groups: { id: string; options: { id: string; basePriceCents: number }[] }[] };
  const groupMap = new Map(groups.groups.map(group => [group.id, group]));
  return [
    env.DB.prepare('DELETE FROM product_variation_groups WHERE product_id = ?').bind(productId),
    ...assignments.flatMap((assignment, groupOrder) => [
      env.DB.prepare('INSERT INTO product_variation_groups (product_id, group_id, sort_order, min_required, max_allowed) VALUES (?, ?, ?, ?, ?)').bind(productId, assignment.groupId, groupOrder, assignment.minRequired, assignment.maxAllowed),
      ...assignment.options.map((option, optionOrder) => {
        const base = groupMap.get(assignment.groupId)?.options.find(row => row.id === option.id)?.basePriceCents;
        return env.DB.prepare('INSERT INTO product_variation_options (product_id, group_id, option_id, price_override_cents, is_default, sort_order) VALUES (?, ?, ?, ?, ?, ?)').bind(productId, assignment.groupId, option.id, base === option.priceCents ? null : option.priceCents, option.isDefault ? 1 : 0, optionOrder);
      })
    ])
  ];
}

export type PricedSelection = { groupId: string; groupName: string; optionId: string; optionName: string; priceDeltaCents: number; groupOrder: number; optionOrder: number };

export async function priceSelections(env: Env, productId: string, selected: Selection): Promise<{ deltaCents: number; snapshots: PricedSelection[] }> {
  const groups = await productVariations(env, productId);
  return calculateSelections(groups, selected);
}

export function calculateSelections(groups: ProductVariation[], selected: Selection): { deltaCents: number; snapshots: PricedSelection[] } {
  const groupIds = new Set(groups.map(group => group.groupId));
  if (Object.keys(selected).some(id => !groupIds.has(id))) throw new Error('Invalid selected variation group');
  const snapshots: PricedSelection[] = [];
  for (const group of groups) {
    const optionIds = selected[group.groupId] ?? group.options.filter(option => option.isDefault).map(option => option.id);
    if (!Array.isArray(optionIds) || new Set(optionIds).size !== optionIds.length || optionIds.length < group.minRequired || optionIds.length > group.maxAllowed) throw new Error(`Select valid choices for ${group.name}`);
    for (const id of optionIds) {
      const option = group.options.find(row => row.id === id);
      if (!option) throw new Error(`Invalid choice for ${group.name}`);
      snapshots.push({ groupId: group.groupId, groupName: group.name, optionId: option.id, optionName: option.label, priceDeltaCents: option.priceCents, groupOrder: group.sortOrder, optionOrder: option.sortOrder });
    }
  }
  return { deltaCents: snapshots.reduce((sum, row) => sum + row.priceDeltaCents, 0), snapshots };
}
