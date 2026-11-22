/**
 * 오프라인 세계 생성: 시드 -> public/world/world.json + world.bin
 *   npm run gen:world                 기본 시드로 생성
 *   npm run gen:world -- --seed abc   다른 시드
 *   --if-missing                      현재 버전 자료가 있으면 건너뜀 (predev용)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';
import { packWorld } from '../src/sim/world/serialize';
import { CLIMATE_ZONES } from '../src/sim/world/types';
import { VIRTUAL_GENERATOR_VERSION } from '../src/sim/world/virtualMeta';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const k = args.indexOf(name);
  return k >= 0 ? args[k + 1] : undefined;
};

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/world');
const jsonPath = resolve(outDir, 'world.json');
const binPath = resolve(outDir, 'world.bin');

if (flag('--if-missing') && existsSync(jsonPath) && existsSync(binPath)) {
  try {
    const existing = JSON.parse(readFileSync(jsonPath, 'utf8'));
    if (existing.dataVersion === VIRTUAL_GENERATOR_VERSION) {
      console.log('현재 버전의 world.json이 이미 있습니다. (다시 만들려면 npm run gen:world)');
      process.exit(0);
    }
  } catch { /* 읽을 수 없는 자료는 다시 생성한다. */ }
  console.log('가상 세계 생성 규칙이 갱신되어 항구 자료를 다시 만듭니다.');
}

const seed = value('--seed') ?? DEFAULT_SEED;
const started = Date.now();
const { world, timings } = generateWorld(makeConfig({ seed }));
const elapsed = Date.now() - started;

const { meta, binary } = packWorld(world);
mkdirSync(outDir, { recursive: true });
writeFileSync(jsonPath, JSON.stringify(meta));
writeFileSync(binPath, binary);

console.log(`시드 "${seed}" · 해시 ${world.hash} · ${elapsed}ms`);
console.log('단계별(ms):', Object.entries(timings).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(`육지 비율 ${(world.stats.landFraction * 100).toFixed(1)}%`);
console.log(
  '기후대:',
  CLIMATE_ZONES.filter((z) => z.id > 0)
    .map((z) => `${z.name} ${((world.stats.climateShare[z.id] ?? 0) * 100).toFixed(1)}%`)
    .join(', '),
);
if (flag('--verbose')) {
  for (const c of world.cities) {
    const r = c.region;
    const crops = Object.entries(r.crops)
      .map(([id, s]) => `${id} ${s.suitability.toFixed(2)}/${Math.round(s.arableAreaKm2 / 1000)}k`)
      .join(' ');
    console.log(
      `  ${c.name.padEnd(5)} (${c.lat.toFixed(1)}, ${c.lon.toFixed(1)}) ${c.seaZone.padEnd(7)} ` +
        `${CLIMATE_ZONES[r.dominantClimate].name} T ${Math.min(...r.tempMonthlyC)}~${Math.max(...r.tempMonthlyC)}°C ` +
        `P ${r.precipMonthlyMm.reduce((a, b) => a + b, 0)}mm | ${crops} | ` +
        Object.entries(r.resources).map(([id, v]) => `${id} ${v}`).join(' '),
    );
  }
}
console.log('검증:');
for (const c of world.validation.checks) console.log(`  ${c.ok ? '✔' : '✘'} ${c.label} — ${c.detail}`);
console.log(`저장: ${jsonPath} (${(JSON.stringify(meta).length / 1024).toFixed(0)}KB), world.bin (${(binary.length / 1e6).toFixed(1)}MB)`);
if (!world.validation.ok) {
  console.error('검증 실패 항목이 있습니다.');
  process.exitCode = 1;
}
