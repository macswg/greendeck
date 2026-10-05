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

export function roundedFill(ctx: SKRSContext2D, size: number, color: string, inset = 4, radius = 12): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(inset, inset, size - inset * 2, size - inset * 2, radius);
  ctx.fill();
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
