/**
 * 새 게임 화면의 세계 고르기 그림: 세계 자료(public/world…)를 작은 지구본 PNG로 찍는다.
 *   npx tsx scripts/gen-thumbs.ts            두 모드 모두
 *   npx tsx scripts/gen-thumbs.ts --if-missing
 * 결과: public/thumbs/<mode>.png (정사각형, 투명 배경)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBaseLayer } from '../src/render/baseLayer';
import { DEG } from '../src/sim/core/sphere';
import { MODES } from '../src/sim/modes';
import { unpackWorld, type WorldMeta } from '../src/sim/world/serialize';
import { WORLD_MODES } from '../src/sim/world/types';
import { encodePng } from './png';

const SIZE = 360;
/** 지구본 가운데(위도, 경도): 모드마다 대표 지역이 보이게 */
const CENTER: Record<string, [number, number]> = { virtual: [10, -10], earth: [22, 105] };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/thumbs');
mkdirSync(outDir, { recursive: true });
const ifMissing = process.argv.includes('--if-missing');

for (const mode of WORLD_MODES) {
  const def = MODES[mode];
  const out = resolve(outDir, `${mode}.png`);
  if (ifMissing && existsSync(out)) continue;
  const base = resolve(root, 'public', def.assetDir, def.assetName);
  if (!existsSync(`${base}.json`)) {
    console.warn(`${def.name}: 세계 자료가 없어 그림을 건너뜁니다(${base}.json)`);
    continue;
  }
  const meta = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as WorldMeta;
  const bin = readFileSync(`${base}.bin`);
  const world = unpackWorld(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  const img = renderBaseLayer(world, { layer: 'terrain', month: 6, cropId: 'grain', scale: 2 });

  // 정사영 지구본: 화면의 점마다 구면 위 위경도를 구해 바탕 그림에서 색을 가져온다
  const [cLat, cLon] = CENTER[mode] ?? [0, 0];
  const sinC = Math.sin(cLat * DEG);
  const cosC = Math.cos(cLat * DEG);
  const px = new Uint8ClampedArray(SIZE * SIZE * 4);
  const r = SIZE / 2 - 4;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x + 0.5 - SIZE / 2) / r;
      const v = -(y + 0.5 - SIZE / 2) / r;
      const d2 = u * u + v * v;
      const o = (y * SIZE + x) * 4;
      if (d2 > 1.02) continue;
      // 가장자리는 반 픽셀만큼 부드럽게
      const edge = Math.min(1, Math.max(0, (1.02 - d2) / 0.04));
      const z = Math.sqrt(Math.max(0, 1 - d2));
      const lat = Math.asin(v * cosC + z * sinC) / DEG;
      const lon = cLon + Math.atan2(u, z * cosC - v * sinC) / DEG;
      const ix = Math.floor(((((lon + 180) % 360) + 360) % 360) / 360 * img.width) % img.width;
      const iy = Math.min(img.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * img.height)));
      const i = (iy * img.width + ix) * 4;
      // 왼쪽 위에서 비추는 빛 + 가장자리의 푸른 대기
      const light = 0.55 + 0.45 * Math.max(0, -0.45 * u + 0.45 * v + 0.77 * z);
      const rim = Math.pow(1 - z, 3);
      px[o] = img.data[i] * light * (1 - rim) + 110 * rim;
      px[o + 1] = img.data[i + 1] * light * (1 - rim) + 170 * rim;
      px[o + 2] = img.data[i + 2] * light * (1 - rim) + 255 * rim;
      px[o + 3] = 255 * edge;
    }
  }
  writeFileSync(out, encodePng(SIZE, SIZE, px));
  console.log(`${def.name}: ${out}`);
}
