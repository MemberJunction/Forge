import { randomBytes } from 'node:crypto';
import type { InstanceEvent, InstanceEventLevel } from '@mj-forge/shared';

/** A sink for streamed progress events. The GUI forwards these over IPC; the
 *  CLI prints them. Synchronous and best-effort — never throws into callers. */
export type EventSink = (event: InstanceEvent) => void;

/** No-op sink for callers that don't care about progress. */
export const noopSink: EventSink = () => {};

/** Build and emit an event to a sink, stamping the time. */
export function emit(
  sink: EventSink,
  slug: string,
  op: string,
  level: InstanceEventLevel,
  message: string
): void {
  try {
    sink({ slug, op, level, message, at: new Date().toISOString() });
  } catch {
    /* never let a misbehaving sink break orchestration */
  }
}

/** Lowercase, hyphenated, filesystem-safe slug derived from a display name. */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'instance';
}

/** Short, collision-resistant id (hex). */
export function newId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Generate a SQL-Server-acceptable strong password (>= 8 chars, 3 of 4
 * character classes). Avoids characters that are awkward in shell/.env.
 */
export function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '_-.@#%+=';
  const all = upper + lower + digits + symbols;
  const pick = (set: string, n: number) => {
    const bytes = randomBytes(n);
    let out = '';
    for (let i = 0; i < n; i++) out += set[bytes[i] % set.length];
    return out;
  };
  // Guarantee one of each class, then fill to 20 chars, then shuffle.
  const base = pick(upper, 2) + pick(lower, 2) + pick(digits, 2) + pick(symbols, 2) + pick(all, 12);
  const arr = base.split('');
  const shuffle = randomBytes(arr.length);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = shuffle[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}
