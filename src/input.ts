import { validDate } from './recurrence';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}

export function string(value: unknown, field: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${field} must be 1 to ${max} characters`);
  return value.trim();
}

export function optional(value: unknown, field: string, max = 2000): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) throw new Error(`${field} must be at most ${max} characters`);
  return value.trim() || null;
}

export function nonnegative(value: unknown, field: string, max = 1000000): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error(`${field} must be a nonnegative number`);
  return value;
}

export function date(value: unknown, field: string): string {
  if (!validDate(value)) throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  return value;
}

export function positiveInteger(value: unknown, field: string, max = 1000): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) throw new Error(`${field} must be an integer from 1 to ${max}`);
  return value as number;
}
