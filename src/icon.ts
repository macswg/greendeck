import { createCanvas } from '@napi-rs/canvas';

/**
 * greendeck's icon: a dark deck with a 3x2 grid of keys, one lit green. As SVG
 * for browser tabs and a 180px PNG for the iOS home screen (which rounds the
 * corners itself, so the PNG is full-bleed).
 */
const KEYS = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 14 + (i % 3) * 18, y: 22 + Math.floor(i / 3) * 18, lit: i === 0 }));

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#18181b"/>
${KEYS.map((k) => `<rect x="${k.x}" y="${k.y}" width="14" height="14" rx="3.5" fill="${k.lit ? '#1db954' : '#3f3f46'}"/>`).join('\n')}
</svg>`;

export function iconPng(size = 180): Buffer {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const k = size / 64;
  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, size, size);
  for (const key of KEYS) {
    ctx.fillStyle = key.lit ? '#1db954' : '#3f3f46';
    ctx.beginPath();
    ctx.roundRect(key.x * k, key.y * k, 14 * k, 14 * k, 3.5 * k);
    ctx.fill();
  }
  return canvas.toBuffer('image/png');
}
