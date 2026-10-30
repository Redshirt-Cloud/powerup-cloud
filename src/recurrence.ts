export type Cadence = 'weekly' | 'monthly';

export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function kitchenToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function occurrenceDates(start: string, cadence: Cadence, from: string, through: string, end?: string | null): string[] {
  if (!validDate(start) || !validDate(from) || !validDate(through)) throw new Error('Invalid recurrence date');
  const dates: string[] = [];
  if (cadence === 'weekly') {
    const weeksElapsed = Math.max(0, Math.floor((Date.parse(`${from}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / (7 * 86400000)));
    let current = addDays(start, weeksElapsed * 7);
    for (let i = 0; i < 100 && current <= through; i++, current = addDays(current, 7)) {
      if (current >= from && (!end || current <= end)) dates.push(current);
    }
  } else {
    const [year, month, day] = start.split('-').map(Number);
    const monthsElapsed = Math.max(0, Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - (year * 12 + month));
    for (let i = monthsElapsed; i < monthsElapsed + 100 && year * 12 + month - 1 + i <= Number(through.slice(0, 4)) * 12 + Number(through.slice(5, 7)) - 1; i++) {
      const monthIndex = month - 1 + i;
      const targetYear = year + Math.floor(monthIndex / 12);
      const targetMonth = monthIndex % 12;
      const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
      const current = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
      if (current >= from && current <= through && (!end || current <= end)) dates.push(current);
    }
  }
  return dates;
}
