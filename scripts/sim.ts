/**
 * 화면 없이 경제를 돌려 균형 지표를 본다.
 *   npm run sim -- --years 10 [--seed abc] [--mode earth]
 * 첫 1년은 적응 기간으로 보고 지표에서 뺀다.
 */
import { buildEarth } from '../src/sim/earth/buildEarth';
import { economyDataFor } from '../src/sim/modes';
import { loadEarthSources } from './earthSources';
import { measureBalance } from '../src/sim/economy/metrics';
import { createEconomy } from '../src/sim/economy/setup';
import { totals } from '../src/sim/economy/step';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';

const args = process.argv.slice(2);
const value = (name: string, fallback: string) => {
  const k = args.indexOf(name);
  return k >= 0 ? args[k + 1] : fallback;
};
const mode = value('--mode', 'virtual') as 'virtual' | 'earth';
const seed = value('--seed', mode === 'earth' ? 'earth-1' : DEFAULT_SEED);
const years = Number(value('--years', '10'));

const world = mode === 'earth' ? buildEarth(loadEarthSources()).world : generateWorld(makeConfig({ seed })).world;
const { ctx, state } = createEconomy(world, economyDataFor(mode), seed);
const started = Date.now();
const report = measureBalance(ctx, state, (years - 1) * 12, 12);
const end = report.finalState;

let bad = 0;
for (const id of ctx.cityIds) {
  for (const g of ctx.goods) {
    const c = end.cities[id];
    if (!Number.isFinite(c.price[g.id]) || !Number.isFinite(c.stock[g.id]) || c.stock[g.id] < 0) bad++;
  }
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
console.log(`== 시드 ${seed}, ${years}년(2년차부터 집계), ${Date.now() - started}ms, 마지막 달 비정상 수치 ${bad}건 ==`);
console.log('상품      월생산  월소비  월교역  가동률  부족률  지불가격  상한근접');
for (const g of ctx.goods) {
  const b = report.goods[g.id];
  console.log(
    `${g.name.padEnd(5)} ${b.produced.toFixed(0).padStart(7)} ${b.consumed.toFixed(0).padStart(7)} ${b.traded.toFixed(0).padStart(7)} ` +
      `${pct(b.utilization).padStart(7)} ${(g.demandPerMillion > 0 || b.consumed > 0 ? pct(b.shortageRate) : '-').padStart(7)} ` +
      `${b.paidPriceRatio.toFixed(2).padStart(8)} ${pct(b.nearCeilingShare).padStart(8)}`,
  );
}
const worst = (k: 'shortageRate' | 'paidPriceRatio') => Math.max(...ctx.goods.map((g) => report.goods[g.id][k]));
console.log(`최대 부족률 ${pct(worst('shortageRate'))}, 최대 지불가격 ${worst('paidPriceRatio').toFixed(2)}배`);
console.log(
  '회사 현금(시작 대비):',
  end.companies.map((c, k) => `${c.name} ${report.companyCashRatio[k].toFixed(2)}배, 배당 ${Math.round(c.paidOut).toLocaleString()}`).join(' / '),
);
console.log('돈의 총합(회사+도시+운임):', Math.round(totals(ctx, end).money).toLocaleString());
if (args.includes('--cities')) {
  for (const id of ctx.cityIds) {
    const c = end.cities[id];
    const short = ctx.goods.filter((g) => c.annual.shortage[g.id] > 0.3 * Math.max(1e-9, c.annual.used[g.id] + c.annual.shortage[g.id])).map((g) => g.name);
    const ind = c.industries.map((i) => `${ctx.goodById[i.goodId].name}${Math.round(i.capacity)}`).join(' ');
    console.log(`  ${ctx.cityNames[id].padEnd(7)} 인구 ${c.population.toFixed(1)} 소득 ${c.income.toFixed(2)} | ${ind} | 부족: ${short.join(',') || '-'}`);
  }
  console.log(`  배후 운송 중: ${(end.inland ?? []).length}건, NPC 배 ${end.ships.filter((s) => s.companyId !== 'player').length}척`);
}
