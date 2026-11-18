/**
 * 현실 지구에서 원자재(철광석·원유)를 어느 시장이 내놓는지 본다.
 * 직접 생산하지 않는데 팔 수 있는 재고가 있으면 표시한다.
 *   npx tsx scripts/earth-raw-sellers.ts [--months 12]
 */
import { buildEarth } from '../src/sim/earth/buildEarth';
import { maxBuyable, shipBuyable } from '../src/sim/economy/market';
import { economyDataFor } from '../src/sim/modes';
import { createGame } from '../src/sim/economy/start';
import { stepMonth } from '../src/sim/economy/step';
import { loadEarthSources } from './earthSources';

const k = process.argv.indexOf('--months');
const months = k >= 0 ? Number(process.argv[k + 1]) : 12;
const { world } = buildEarth(loadEarthSources());
let { ctx, state } = createGame(world, economyDataFor('earth'), 'earth-1');
const RAW = ctx.goods.filter((g) => g.source?.kind === 'resource').map((g) => g.id);

const report = (label: string) => {
  console.log(`\n== ${label} ==`);
  for (const goodId of RAW) {
    const rows: string[] = [];
    let wrong = 0;
    for (const id of ctx.cityIds) {
      const c = state.cities[id];
      const cap = c.industries.find((i) => i.goodId === goodId)?.capacity ?? 0;
      if (!ctx.portIds.includes(id)) continue;
      const sell = shipBuyable(ctx, state, c, goodId);
      const held = maxBuyable(ctx, c, goodId) - sell;
      if (sell <= 0.01 && cap <= 0 && held <= 0.01) continue;
      if (cap <= 0 && sell > 0.01) wrong++;
      rows.push(`${cap > 0 ? '  ' : sell > 0.01 ? '!!' : '--'} ${id.padEnd(14)} 생산 ${cap.toFixed(1).padStart(6)}  재고 ${c.stock[goodId].toFixed(1).padStart(7)}  배에 팖 ${sell.toFixed(1).padStart(6)}  내놓지 않음 ${held.toFixed(1).padStart(6)}  값 ${c.price[goodId].toFixed(0)}`);
    }
    console.log(`${goodId}: 생산 없이 배에 파는 항구 ${wrong}곳`);
    for (const r of rows) console.log(r);
  }
};
report('시작');
for (let m = 0; m < months; m++) state = stepMonth(ctx, state).state;
report(`${months}개월 뒤`);
