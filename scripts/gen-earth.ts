/**
 * 현실 지구 세계 자료 생성: data/earth/sources(고정 자료) + src/sim/earth/definitions.ts
 *   -> public/world/earth/earth.json + earth.bin
 *   npm run gen:earth                 생성
 *   --if-missing                      이미 있고 자료 버전이 같으면 건너뜀(predev용)
 * 외부 사이트에 접속하지 않는다(자료 갱신은 npm run fetch:earth).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEarth } from '../src/sim/earth/buildEarth';
import { EARTH_DATA_VERSION } from '../src/sim/earth/definitions';
import { packWorld } from '../src/sim/world/serialize';
import { CLIMATE_ZONES } from '../src/sim/world/types';
import { loadEarthSources } from './earthSources';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/world/earth');
const jsonPath = resolve(outDir, 'earth.json');
const binPath = resolve(outDir, 'earth.bin');

if (process.argv.includes('--if-missing') && existsSync(jsonPath) && existsSync(binPath)) {
  try {
    const v = JSON.parse(readFileSync(jsonPath, 'utf8')).dataVersion;
    if (v === EARTH_DATA_VERSION) {
      console.log(`earth.json(${v})이 이미 있습니다. (다시 만들려면 npm run gen:earth)`);
      process.exit(0);
    }
  } catch {
    // 다시 만든다
  }
}

const t0 = Date.now();
const { world, timings } = buildEarth(loadEarthSources());
const { meta, binary } = packWorld(world);
mkdirSync(outDir, { recursive: true });
writeFileSync(jsonPath, JSON.stringify(meta));
writeFileSync(binPath, binary);

console.log(`현실 지구 ${world.dataVersion} · 해시 ${world.hash} · ${Date.now() - t0}ms`);
console.log('단계별(ms):', Object.entries(timings).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(`지도 단위 ${world.mapUnits.length}개, 경제 국가 ${world.countries.length}개, 경제권 ${world.cities.length}개(항구 ${world.cities.filter((c) => c.isPort).length}), 항로 ${world.seaRoutes.length}개`);
console.log(
  '기후대:',
  CLIMATE_ZONES.filter((z) => z.id > 0)
    .map((z) => `${z.name} ${((world.stats.climateShare[z.id] ?? 0) * 100).toFixed(1)}%`)
    .join(', '),
);
if (process.argv.includes('--verbose')) {
  for (const c of world.cities) {
    const r = c.region;
    console.log(
      `  ${c.name.padEnd(7)} ${CLIMATE_ZONES[r.dominantClimate]?.name ?? '-'} T ${Math.min(...r.tempMonthlyC)}~${Math.max(...r.tempMonthlyC)}°C P ${r.precipMonthlyMm.reduce((a, b) => a + b, 0)}mm | ` +
        Object.entries(r.crops).map(([id, s]) => `${id} ${s.suitability}/${Math.round(s.arableAreaKm2 / 1000)}k`).join(' ') +
        ' | ' + Object.entries(r.resources).map(([id, v]) => `${id} ${v}`).join(' '),
    );
  }
}
console.log('검증:');
for (const c of world.validation.checks) console.log(`  ${c.ok ? '✔' : '✘'} ${c.label} — ${c.detail}`);
console.log(`저장: ${jsonPath} (${(JSON.stringify(meta).length / 1024).toFixed(0)}KB), earth.bin (${(binary.length / 1e6).toFixed(1)}MB)`);
if (!world.validation.ok) {
  console.error('검증 실패 항목이 있습니다.');
  process.exitCode = 1;
}
