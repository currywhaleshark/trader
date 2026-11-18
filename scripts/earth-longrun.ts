/**
 * 장기 결정성(§17): 같은 자료·시드로 현실 지구를 years년 두 번 돌려 결과가 같은지, 값이 발산하지 않는지 본다.
 *   npx tsx scripts/earth-longrun.ts [--years 30]
 */
import { createHash } from 'node:crypto';
import { buildEarth } from '../src/sim/earth/buildEarth';
import { economyDataFor } from '../src/sim/modes';
import { createGame } from '../src/sim/economy/start';
import { stepMonth, totals } from '../src/sim/economy/step';
import { loadEarthSources } from './earthSources';

const k = process.argv.indexOf('--years');
const years = k >= 0 ? Number(process.argv[k + 1]) : 30;
const { world } = buildEarth(loadEarthSources());
const run = () => {
  const t0 = Date.now();
  let { ctx, state } = createGame(world, economyDataFor('earth'), 'earth-1');
  const money0 = totals(ctx, state).money;
  for (let m = 0; m < years * 12; m++) state = stepMonth(ctx, state).state;
  let bad = 0;
  let ceil = 0;
  for (const id of ctx.cityIds) {
    for (const g of ctx.goods) {
      const c = state.cities[id];
      if (!Number.isFinite(c.price[g.id]) || !Number.isFinite(c.stock[g.id]) || c.stock[g.id] < 0) bad++;
      if (c.price[g.id] > g.basePrice * ctx.data.market.priceCeil + 1e-6) ceil++;
    }
  }
  const pops = Object.values(state.cities).map((c) => c.population);
  const incomes = Object.values(state.cities).map((c) => c.income);
  return {
    hash: createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 16),
    ms: Date.now() - t0,
    bad,
    ceil,
    moneyDrift: totals(ctx, state).money - money0,
    pop: [Math.min(...pops), Math.max(...pops)],
    income: [Math.min(...incomes), Math.max(...incomes)],
    npcShips: state.ships.filter((s) => s.companyId !== 'player').length,
    year: ctx.data.startYear + Math.floor(state.month / 12),
  };
};
const a = run();
const b = run();
console.log(`${years}년 실행 두 번: 지문 ${a.hash} / ${b.hash} → ${a.hash === b.hash ? '같음' : '다름'}`);
console.log(`걸린 시간 ${a.ms}ms, ${b.ms}ms (월 평균 ${(a.ms / (years * 12)).toFixed(0)}ms)`);
console.log(`비정상 수치 ${a.bad}건, 가격 상한 초과 ${a.ceil}건, 돈 총합 변화 ${a.moneyDrift.toFixed(3)}`);
console.log(`인구 범위 ${a.pop.map((v) => v.toFixed(1)).join('~')}, 소득 범위 ${a.income.map((v) => v.toFixed(2)).join('~')}, NPC 배 ${a.npcShips}척, 끝난 해 ${a.year}`);
if (a.hash !== b.hash || a.bad > 0) process.exitCode = 1;
