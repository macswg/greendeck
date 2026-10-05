import type { SKRSContext2D } from '@napi-rs/canvas';

export const FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif';

export const colors = {
  // Translucent so a background shows through behind button faces.
  bg: 'rgba(0, 0, 0, 0.55)',
  dim: '#8a8a8a',
  text: '#eee',
  active: '#1db954',
  pending: '#d9a400',
  error: '#d0343a',
  accent: '#3a8dde',
};

/** Draw text centered at (x, y), shrinking it until it fits maxWidth. */
export function text(
  ctx: SKRSContext2D,
  str: string,
  x: number,
  y: number,
  opts: { size: number; maxWidth: number; color?: string; weight?: string },
): void {
  let size = opts.size;
  ctx.font = `${opts.weight ?? 'bold'} ${size}px ${FONT}`;
  while (size > 8 && ctx.measureText(str).width > opts.maxWidth) {
    size--;
    ctx.font = `${opts.weight ?? 'bold'} ${size}px ${FONT}`;
  }
  ctx.fillStyle = opts.color ?? colors.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

/** How opaque a solid (lit) key face is, so background states still show through. */
const LIT_ALPHA = 0.8;

/**
 * A key's face. Faces are never fully opaque: solid colours (lit keys) are
 * drawn at LIT_ALPHA, and rgba() colours keep their own alpha.
 */
export function roundedFill(ctx: SKRSContext2D, size: number, color: string, inset = 4, radius = 12): void {
  ctx.save();
  if (!color.startsWith('rgba')) ctx.globalAlpha = LIT_ALPHA;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(inset, inset, size - inset * 2, size - inset * 2, radius);
  ctx.fill();
  ctx.restore();
}

/**
 * Button roles, so a key's colour says what kind of button it is:
 *   nav      black: page arrows, page title, sleep/wake
 *   action   red: record, take, anything with consequences outside greendeck
 *            (black at rest, solid red only while live)
 *   default  green: a button sitting in its default state
 * `idle` is the face at rest, `on` the face when active.
 */
export type Role = 'nav' | 'action' | 'default';

export const roles: Record<Role, { idle: string; on: string }> = {
  nav: { idle: colors.bg, on: '#3a3a3a' },
  action: { idle: colors.bg, on: colors.error },
  default: { idle: 'rgba(10, 46, 25, 0.55)', on: colors.active },
};

/** A key face in its role's colours: `idle` at rest, `on` when active. */
export function keyFace(ctx: SKRSContext2D, size: number, role: Role, on = false): void {
  roundedFill(ctx, size, on ? roles[role].on : roles[role].idle);
}

/** Filled sparkline of values in [min, max] across the given box. */
export function sparkline(
  ctx: SKRSContext2D,
  values: readonly number[],
  box: { x: number; y: number; w: number; h: number },
  opts: { min: number; max: number; color: string },
): void {
  if (values.length < 2) return;
  const { x, y, w, h } = box;
  const range = opts.max - opts.min || 1;
  const step = w / (values.length - 1);
  const py = (v: number) => y + h - (Math.min(Math.max(v, opts.min), opts.max) - opts.min) / range * h;

  ctx.beginPath();
  ctx.moveTo(x, y + h);
  values.forEach((v, i) => ctx.lineTo(x + i * step, py(v)));
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = opts.color;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  values.forEach((v, i) => (i ? ctx.lineTo(x + i * step, py(v)) : ctx.moveTo(x, py(v))));
  ctx.strokeStyle = opts.color;
  ctx.lineWidth = 2;
  ctx.stroke();
}
