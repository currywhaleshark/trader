/**
 * 브라우저 없이 세계를 PNG로 확인한다.
 *   npm run preview:png -- --layer climate --month 6 --seed abc --out preview/climate.png
 * 항구(흰 점)와 항로(옅은 선)를 함께 찍는다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { LAYERS, renderBaseLayer, type LayerId } from '../src/render/baseLayer';
import { densifyPath, wrapLon } from '../src/sim/core/sphere';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';
import { encodePng } from './png';

const args = process.argv.slice(2);
const value = (name: string, fallback: string) => {
  const k = args.indexOf(name);
  return k >= 0 ? args[k + 1] : fallback;
};

const seed = value('--seed', DEFAULT_SEED);
const layers = value('--layer', 'terrain').split(',') as LayerId[];
const month = Number(value('--month', '6'));
const cropId = value('--crop', 'grain');
const scale = Number(value('--scale', '2'));
const routes = !args.includes('--no-routes');

const { world } = generateWorld(makeConfig({ seed }));
for (const layer of layers) {
  if (!LAYERS.some((l) => l.id === layer)) throw new Error(`알 수 없는 레이어: ${layer}`);
  const img = renderBaseLayer(world, { layer, month, cropId, scale });
  const plot = (lat: number, lon: number, r: number, g: number, b: number, size: number) => {
    const cx = Math.floor(((wrapLon(lon) + 180) / 360) * img.width);
    const cy = Math.floor(((90 - lat) / 180) * img.height);
    for (let dy = -size; dy <= size; dy++) {
      for (let dx = -size; dx <= size; dx++) {
        const x = (cx + dx + img.width) % img.width;
        const y = cy + dy;
        if (y < 0 || y >= img.height) continue;
        const o = (y * img.width + x) * 4;
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
      }
    }
  };
  if (routes) {
    for (const r of world.seaRoutes) {
      for (const p of densifyPath(r.waypoints, 0.3)) plot(p[0], p[1], 255, 235, 150, 0);
    }
  }
  for (const c of world.cities) {
    plot(c.lat, c.lon, 20, 20, 20, 3);
    plot(c.lat, c.lon, 255, 255, 255, 2);
  }
  const out = resolve(value('--out', `preview/${layer}.png`).replace('{layer}', layer));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePng(img.width, img.height, img.data));
  console.log(`${layer} -> ${out}`);
}
