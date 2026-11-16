/**
 * 봇 플레이어로 회사 성장 속도를 잰다.
 *   npm run play -- --years 6 [--seed abc] [--ships small,medium]
 */
import { botCommands, botFleet, botVoyages } from '../src/sim/economy/bot';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { applyCommand, netProfit, PLAYER_ID } from '../src/sim/economy/player';
import { createEconomy } from '../src/sim/economy/setup';
import { stepMonth, totals } from '../src/sim/economy/step';
import type { EconomyState } from '../src/sim/economy/types';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';

const args = process.argv.slice(2);
const value = (name: string, fallback: string) => {
  const k = args.indexOf(name);
  return k >= 0 ? args[k + 1] : fallback;
};
const seed = value('--seed', DEFAULT_SEED);
const years = Number(value('--years', '6'));
const buyShips = value('--ships', 'medium,small').split(',');

const { world } = generateWorld(makeConfig({ seed }));
const eco = createEconomy(world, DEFAULT_ECONOMY, seed);
const ctx = eco.ctx;
let state: EconomyState = eco.state;
const money0 = totals(ctx, state).money;
const opt = { buyShips, keepCashPerShip: Number(value('--keep', '25000')) };
const firstBuy: Record<string, number> = {};

for (let m = 0; m < years * 12; m++) {
  state = structuredClone(state);
  for (const phase of [botCommands, botFleet, botVoyages]) {
    for (const cmd of phase(ctx, state, opt)) {
      const r = applyCommand(ctx, state, cmd);
      if (r.ok && cmd.type === 'buyShip') firstBuy[cmd.typeId] ??= m;
    }
  }
  state = stepMonth(ctx, state).state;
  if (m % 12 === 11) {
    const fleet = state.ships.filter((s) => s.companyId === PLAYER_ID);
    const yearLedger = state.player.ledger.slice(-12);
    const profit = yearLedger.reduce((s, l) => s + netProfit(l), 0);
    console.log(
      `${m / 12 + 1 | 0}년차 현금 ${Math.round(state.player.cash).toLocaleString()} · 배 ${fleet.length}척(${fleet.map((s) => s.typeId).join(',')}) · 연 영업이익 ${Math.round(profit).toLocaleString()}`,
    );
  }
}
const life = state.player.lifetime;
console.log('누적:', Object.entries(life).map(([k, v]) => `${k} ${Math.round(v).toLocaleString()}`).join(', '));
console.log('첫 구매 시점(월):', JSON.stringify(firstBuy));
console.log('돈 보존:', Math.abs(totals(ctx, state).money - money0) < 1e-3 ? '확인' : `불일치 ${totals(ctx, state).money - money0}`);
