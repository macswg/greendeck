import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { Widget } from '../widget.ts';
import { colors, roundedFill, text } from '../draw.ts';

const run = promisify(execFile);

export type LinkTarget = { url: string } | { app: string };

export interface LinkOptions {
  label?: string;
  /** Icon image URL(s), tried in order. Apps default to their own icon. */
  icon?: string | string[];
  /** Hide the label once the icon has loaded (it still shows if the icon can't). */
  iconOnly?: boolean;
}

/**
 * Opens a web page in the default browser, or launches an app (by bundle id
 * or path). Shows the site's or app's icon, loaded when greendeck starts.
 */
export class LinkButton extends Widget {
  #target: LinkTarget;
  #label: string;
  #icon: Image | undefined;
  #iconOnly: boolean;
  #flashUntil = 0;

  constructor(target: LinkTarget, opts: LinkOptions = {}) {
    super();
    this.#target = target;
    this.#label = opts.label ?? ('url' in target ? new URL(target.url).hostname : target.app.split('/').pop()!.replace(/\.app$/, ''));
    this.#iconOnly = opts.iconOnly ?? false;
    void this.#loadIcon(opts.icon);
  }

  async #loadIcon(icon: string | string[] | undefined): Promise<void> {
    try {
      if (icon === undefined && 'app' in this.#target) {
        this.#icon = await loadImage(await appIcon(this.#target.app));
      } else {
        const urls = icon === undefined && 'url' in this.#target ? [new URL('/favicon.ico', this.#target.url).href] : [icon ?? []].flat();
        this.#icon = await firstImage(urls);
      }
      this.invalidate();
    } catch (err) {
      console.error(`link ${this.#label}: no icon:`, (err as Error).message);
    }
  }

  onDown(): void {
    const args = 'url' in this.#target ? [this.#target.url] : this.#target.app.includes('/') ? ['-a', this.#target.app] : ['-b', this.#target.app];
    execFile('open', args, (err) => err && console.error(`open ${args.at(-1)}:`, err.message));
    this.#flashUntil = performance.now() + 150;
    this.invalidate();
    setTimeout(() => this.invalidate(), 160);
  }

  render(ctx: SKRSContext2D, s: number): void {
    roundedFill(ctx, s, performance.now() < this.#flashUntil ? '#3a3a3a' : colors.bg);
    if (!this.#icon) {
      text(ctx, this.#label, s / 2, s / 2, { size: 16, maxWidth: s - 12 });
      return;
    }
    if (this.#iconOnly) {
      const size = s * 0.62;
      ctx.drawImage(this.#icon, (s - size) / 2, (s - size) / 2, size, size);
      return;
    }
    const size = s * 0.52;
    ctx.drawImage(this.#icon, (s - size) / 2, s * 0.12, size, size);
    text(ctx, this.#label, s / 2, s * 0.8, { size: 11, maxWidth: s - 10, weight: 'normal', color: colors.dim });
  }
}

/** The first of these image URLs that loads. */
async function firstImage(urls: string[]): Promise<Image> {
  let last: unknown = new Error('no icon URL');
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      let data = Buffer.from(await res.arrayBuffer());
      // Browsers forgive SVG comments containing "--"; the renderer's XML
      // parser doesn't. Comments are never drawn, so drop them.
      if (/svg/.test(res.headers.get('content-type') ?? '') || url.endsWith('.svg')) {
        data = Buffer.from(data.toString('utf8').replace(/<!--[\s\S]*?-->/g, ''));
      }
      return await loadImage(data);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

/** An app's icon as PNG data, converted from its .icns with macOS's sips. */
async function appIcon(app: string): Promise<Buffer> {
  const path = app.includes('/')
    ? app
    : (await run('mdfind', [`kMDItemCFBundleIdentifier == '${app.replace(/'/g, '')}'`])).stdout.split('\n')[0];
  if (!path) throw new Error(`app ${app} not found`);
  const { stdout } = await run('defaults', ['read', join(path, 'Contents/Info'), 'CFBundleIconFile']);
  const icns = join(path, 'Contents/Resources', stdout.trim().replace(/(\.icns)?$/, '.icns'));
  const png = join(tmpdir(), `greendeck-icon-${process.pid}-${Math.random().toString(36).slice(2)}.png`);
  await run('sips', ['-s', 'format', 'png', icns, '-Z', '256', '--out', png]);
  return readFile(png);
}
