// Draws the picture wallpapers into assets/wallpapers/:
//
//   node scripts/make-wallpapers.ts
//
// Made for the deck: dark overall so key labels stay readable, and shapes
// that run the whole width so each picture flows across the gaps between
// keys. Sized to the Stream Deck XL panel (8 x 4 keys of 96 px with 32 px
// gaps) at 2x. Each uses a fixed seed, so re-running gives the same pictures.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

const W = 1984;
const H = 960;

/** A seeded random number generator, 0–1. */
function random(seed: number): () => number {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** DUSK: layered mountain ridges under an evening sky with a warm band along the horizon. */
function dusk(ctx: SKRSContext2D): void {
  const rand = random(7);

  // Sky: deep indigo at the top down to a dusky violet near the horizon.
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.75);
  sky.addColorStop(0, '#05060f');
  sky.addColorStop(0.45, '#141a3a');
  sky.addColorStop(0.8, '#3b2a55');
  sky.addColorStop(1, '#6b3a4f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // The last of the sunset: a wide warm glow low and right of centre.
  const glow = ctx.createRadialGradient(W * 0.62, H * 0.72, 0, W * 0.62, H * 0.72, W * 0.55);
  glow.addColorStop(0, 'rgba(255, 150, 70, 0.55)');
  glow.addColorStop(0.35, 'rgba(220, 90, 70, 0.22)');
  glow.addColorStop(1, 'rgba(120, 40, 80, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Stars, only in the darker upper sky, fading out toward the glow.
  for (let i = 0; i < 260; i++) {
    const x = rand() * W;
    const y = rand() ** 1.6 * H * 0.55;
    const fade = 1 - y / (H * 0.55);
    const r = rand() < 0.08 ? 2.6 : 1.2 + rand() * 0.8;
    ctx.fillStyle = `rgba(230, 235, 255, ${(0.35 + rand() * 0.6) * fade})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // A thin crescent moon, upper left. The halo goes on first and unclipped, so
  // the dark side of the moon sits in the same glow as the sky around it.
  const moon = { x: W * 0.2, y: H * 0.2, r: 34 };
  const halo = ctx.createRadialGradient(moon.x, moon.y, moon.r * 0.8, moon.x, moon.y, moon.r * 3.5);
  halo.addColorStop(0, 'rgba(255, 240, 210, 0.16)');
  halo.addColorStop(1, 'rgba(255, 240, 210, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(moon.x - moon.r * 4, moon.y - moon.r * 4, moon.r * 8, moon.r * 8);
  // The lit crescent: the disc, clipped to outside an offset disc.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.arc(moon.x + 14, moon.y - 8, 32, 0, Math.PI * 2);
  ctx.clip('evenodd');
  ctx.fillStyle = '#f3e6c8';
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  /** A ridge line: a few sine waves of different lengths added together. */
  function ridge(base: number, height: number, waves: [number, number, number][]): (x: number) => number {
    return (x) => base - height * waves.reduce((sum, [len, amp, phase]) => sum + amp * Math.sin((x / len) * Math.PI * 2 + phase), 0);
  }

  // Back to front: each ridge darker and lower, with a faint haze on its top
  // edge so the layers separate.
  const ridges: { y: (x: number) => number; fill: string; haze: string }[] = [
    { y: ridge(H * 0.62, 70, [[900, 0.6, 1.1], [410, 0.3, 0.2], [170, 0.1, 2.0]]), fill: '#3a2c4f', haze: 'rgba(255, 170, 120, 0.25)' },
    { y: ridge(H * 0.7, 80, [[1100, 0.55, 2.4], [480, 0.35, 0.9], [210, 0.1, 0.4]]), fill: '#25203d', haze: 'rgba(230, 140, 120, 0.18)' },
    { y: ridge(H * 0.8, 90, [[1300, 0.5, 0.3], [520, 0.35, 1.7], [190, 0.15, 2.9]]), fill: '#161530', haze: 'rgba(180, 120, 160, 0.14)' },
    { y: ridge(H * 0.92, 70, [[1500, 0.6, 1.9], [600, 0.3, 0.6], [230, 0.1, 1.3]]), fill: '#0a0a18', haze: 'rgba(120, 100, 170, 0.1)' },
  ];
  for (const { y, fill, haze } of ridges) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, y(x));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, y(x));
    ctx.strokeStyle = haze;
    ctx.lineWidth = 6;
    ctx.stroke();
  }
}

/** GRID: a retro-futurist neon grid running to a striped sun on the horizon. */
function grid(ctx: SKRSContext2D): void {
  const rand = random(3);
  const horizon = H * 0.52;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#07021a');
  sky.addColorStop(1, '#3a0a4a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon);
  const ground = ctx.createLinearGradient(0, horizon, 0, H);
  ground.addColorStop(0, '#1a0526');
  ground.addColorStop(1, '#040108');
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, W, H - horizon);

  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = `rgba(255, 230, 255, ${rand() * 0.6})`;
    ctx.fillRect(rand() * W, rand() * horizon * 0.8, 2, 2);
  }

  // The sun: a warm gradient disc, cut by bands that thicken toward the horizon.
  const sun = { x: W / 2, y: horizon - 40, r: 230 };
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, horizon);
  ctx.clip();
  const sunFill = ctx.createLinearGradient(0, sun.y - sun.r, 0, sun.y + sun.r);
  sunFill.addColorStop(0, '#ffd36b');
  sunFill.addColorStop(0.5, '#ff6a6a');
  sunFill.addColorStop(1, '#c2187a');
  ctx.shadowColor = 'rgba(255, 90, 140, 0.8)';
  ctx.shadowBlur = 80;
  ctx.fillStyle = sunFill;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sun.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Stripes only across the disc.
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sun.r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#2a0838';
  for (let i = 0; i < 6; i++) {
    const thick = 14 - i * 2;
    ctx.fillRect(sun.x - sun.r, horizon - 18 - i * 30 - thick, sun.r * 2, thick);
  }
  ctx.restore();

  // The grid: lines fanning from a vanishing point, and cross lines that
  // bunch up toward the horizon.
  ctx.strokeStyle = 'rgba(255, 60, 200, 0.5)';
  ctx.shadowColor = 'rgba(255, 60, 200, 0.8)';
  ctx.shadowBlur = 12;
  ctx.lineWidth = 3;
  for (let i = -24; i <= 24; i++) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + i * 12, horizon);
    ctx.lineTo(W / 2 + i * 190, H);
    ctx.stroke();
  }
  for (let i = 1; i < 14; i++) {
    const y = horizon + (H - horizon) * (i / 13) ** 2.2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 120, 220, 0.9)';
  ctx.fillRect(0, horizon - 2, W, 3);
}

const out = new URL('../assets/wallpapers/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const [name, draw] of Object.entries({ dusk, grid })) {
  const canvas = createCanvas(W, H);
  draw(canvas.getContext('2d'));
  writeFileSync(new URL(`${name}.png`, out), canvas.toBuffer('image/png'));
  console.log(`wrote assets/wallpapers/${name}.png`);
}
