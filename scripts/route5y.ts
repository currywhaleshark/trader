/**
 * 자동항로 5년 시험: 정기 항로 하나에 배를 맡기고 60개월을 돌려 누적 수익을 본다.
 *   npx tsx scripts/route5y.ts [개월=60]
 * 항로 예: 루멘(전자부품 사기·가공식품 팔기) ↔ 오르파(가공식품 사기·전자부품 팔기)
 */
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { applyCommand, netProfit, PLAYER_ID } from '../src/sim/economy/player';
import { evaluateRoute } from '../src/sim/economy/routePlan';
import { createGame } from '../src/sim/economy/start';
import { stepMonth } from '../src/sim/economy/step';
import type { RouteStop } from '../src/sim/economy/types';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';

const months = Number(process.argv[2] ?? 60);
const { world } = generateWorld(makeConfig({ seed: DEFAULT_SEED }));
const eco = createGame(world, DEFAULT_ECONOMY, DEFAULT_SEED);
const ctx = eco.ctx;

function run(label: string, stops: RouteStop[], minMargin: number, cash = 60000) {
  let s = structuredClone(eco.state);
  s.player.cash = cash;
  applyCommand(ctx, s, { type: 'saveRoute', route: { name: label, stops, minMargin, cashReserve: 5000 } });
  const routeId = s.player.routes[0].id;
  const ev0 = evaluateRoute(ctx, s, s.player.routes[0], 'small', { cash });
  const r = applyCommand(ctx, s, { type: 'assignRoute', shipId: 'p1', routeId });
  if (!r.ok) throw new Error(r.error);
  let arrivals = 0;
  let waits = 0;
  let waitMonths = 0;
  const yearly: number[] = [];
  let yearStart = s.player.cash;
  for (let m = 0; m < months; m++) {
    const out = stepMonth(ctx, s);
    s = out.state;
    for (const e of out.events) {
      if (e.type === 'arrival' && e.shipId === 'p1') arrivals++;
      if (e.type === 'notice' && e.shipId === 'p1' && e.text.includes('기다렸다가')) waits++;
    }
    if (s.ships.find((x) => x.id === 'p1')?.routeWaiting) waitMonths++;
    if ((m + 1) % 12 === 0) {
      yearly.push(Math.round(s.player.cash - yearStart));
      yearStart = s.player.cash;
    }
  }
  const l = s.player.lifetime;
  const net = l.sales - l.purchases - l.fuel - l.portFees - l.upkeep - (l.tariffs ?? 0);
  console.log(`\n[${label}] 최소 이익률 ${minMargin * 100}%`);
  console.log(
    `  시작 예상: 한 바퀴 ${ev0.loopMonths.toFixed(1)}달 · 매매 ${Math.round(ev0.tradeGain)} − 연료 ${Math.round(ev0.fuel)} − 유지 ${Math.round(ev0.upkeep)} = ${Math.round(ev0.net)} (월 ${Math.round(ev0.perMonth)})`,
  );
  console.log(`  ${months}개월: 도착 ${arrivals}번 · 기다림 시작 ${waits}번(기다린 달 ${waitMonths}) · 판 횟수 ${s.player.tradeCount}`);
  console.log(
    `  누적: 판매 ${Math.round(l.sales)} 구매 ${Math.round(l.purchases)} 연료 ${Math.round(l.fuel)} 항만 ${Math.round(l.portFees)} 관세 ${Math.round(l.tariffs ?? 0)} 유지 ${Math.round(l.upkeep)} 상함 ${Math.round(l.spoiledCost)}`,
  );
  console.log(`  순이익 ${Math.round(net)} · 월평균 ${Math.round(net / months)} · 해마다 현금 변화 ${yearly.join(', ')} · 마지막 현금 ${Math.round(s.player.cash)}`);
  const chron = s.player.chronicle.filter((c) => c.shipId === 'p1');
  const losing = chron.filter((c) => c.profit < 0);
  console.log(
    `  판매 기록 ${chron.length}건 중 밑진 판매 ${losing.length}건(합 ${Math.round(losing.reduce((a, c) => a + c.profit, 0))}) · 남긴 판매 합 ${Math.round(chron.filter((c) => c.profit >= 0).reduce((a, c) => a + c.profit, 0))}`,
  );
  void PLAYER_ID;
  return { net, arrivals, waitMonths, ledgerNet: s.player.ledger.reduce((a, b) => a + netProfit(b), 0) };
}

run('전자부품↔가공식품', [
  { cityId: 'lumen', buy: [{ goodId: 'electronics', maxQuantity: 30 }], sell: ['processed_food'] },
  { cityId: 'orpa', buy: [{ goodId: 'processed_food', maxQuantity: 40 }], sell: ['electronics'] },
], 0.05);
run('같은 항로, 기준 0%', [
  { cityId: 'lumen', buy: [{ goodId: 'electronics', maxQuantity: 30 }], sell: ['processed_food'] },
  { cityId: 'orpa', buy: [{ goodId: 'processed_food', maxQuantity: 40 }], sell: ['electronics'] },
], 0);
run('남지 않는 항로(비싼 곳에서 사서 싼 곳에 팔기)', [
  { cityId: 'orpa', buy: [{ goodId: 'electronics', maxQuantity: 30 }], sell: ['processed_food'] },
  { cityId: 'lumen', buy: [{ goodId: 'processed_food', maxQuantity: 40 }], sell: ['electronics'] },
], 0);
