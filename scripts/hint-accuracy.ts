/**
 * 항구 힌트(suggestTrips)의 예상과 실제를 견준다: 힌트대로 사서 가서 팔았을 때
 * 1개당 받은 돈이 예상과 얼마나 다르고, 항해하는 동안 목적지에서 무슨 일이 있었나.
 *   npx tsx scripts/hint-accuracy.ts [--mode virtual|earth] [--samples 4]
 */
import { readFileSync } from 'node:fs';
import { suggestTrips } from '../src/sim/economy/advice';
import { arrivalMarket, expectedSaleUnit, quoteSell, settledPrice } from '../src/sim/economy/market';
import { applyCommand, estimateVoyage, isDocked, PLAYER_ID } from '../src/sim/economy/player';
import { expectedSaleFactor } from '../src/sim/economy/policy';
import { createGame } from '../src/sim/economy/start';
import { stepMonth } from '../src/sim/economy/step';
import type { EconomyState } from '../src/sim/economy/types';
import { buildEarth } from '../src/sim/earth/buildEarth';
import { economyDataFor } from '../src/sim/modes';
import { unpackWorld } from '../src/sim/world/serialize';
import type { World } from '../src/sim/world/types';
import { loadEarthSources } from './earthSources';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const mode = arg('--mode', 'virtual') as 'virtual' | 'earth';
const samples = Number(arg('--samples', '4'));
let world: World;
if (mode === 'earth') world = buildEarth(loadEarthSources()).world;
else {
  const meta = JSON.parse(readFileSync('public/world/world.json', 'utf8'));
  const bin = readFileSync('public/world/world.bin');
  world = unpackWorld(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
}
const g0 = createGame(world, economyDataFor(mode), mode === 'earth' ? 'earth-1' : 'trade-world-1');
const { ctx } = g0;
let base = g0.state;

interface Row {
  surprise?: { expectedUnit: number; actualUnit: number; reasons: { text: string }[] };
  variants: Record<string, number>;
  good: string;
  to: string;
  months: number;
  expUnit: number;
  actUnit: number;
  miss: number;
  price0: number;
  priceArr: number;
  settledForecast: number;
  others: number;
  plannedIncoming: number;
  prodExtra: number;
  consExtra: number;
  event: boolean;
  ownImpact: number;
  q: number;
  stock0: number;
}
const rows: Row[] = [];
for (let s = 0; s < samples; s++) {
  for (const port of ctx.portIds) {
    const st: EconomyState = structuredClone(base);
    const me = st.ships.find((x) => x.companyId === PLAYER_ID)!;
    me.from = me.to = port;
    me.cargo = [];
    me.holding = true;
    me.routeId = undefined;
    st.player.cash = 30000;
    const idea = suggestTrips(ctx, st, me, 1)[0];
    if (!idea) continue;
    const g = ctx.goodById[idea.goodId];
    const dest0 = st.cities[idea.to];
    const v = estimateVoyage(ctx, me.typeId!, port, idea.to, st);
    const incoming0 = st.ships.filter((x) => x !== me && x.to === idea.to && x.from !== x.to).reduce((a, x) => a + x.cargo.filter((l) => l.goodId === g.id).reduce((b, l) => b + l.quantity, 0), 0);
    const drainNow = Math.max(0, dest0.last.consumed[g.id] + dest0.last.usedAsInput[g.id] - dest0.last.produced[g.id]);
    const settledForecast = settledPrice(ctx, dest0, g.id, Math.max(0, dest0.stock[g.id] + incoming0 + idea.quantity - drainNow * v.months));
    const factor = expectedSaleFactor(ctx, st, port, g.id, idea.to, v.months);
    const expUnit = settledForecast * (1 - ctx.data.market.spread) * factor;
    const price0 = dest0.price[g.id];
    const lagK = Math.pow(1 - (g.priceResponse?.priceAdjust ?? ctx.data.market.priceAdjust), v.months);
    const withLag = (settled: number) => settled + (price0 - settled) * lagK;
    const l = dest0.last;
    const drain = Math.max(0, l.consumed[g.id] + l.usedAsInput[g.id] - l.produced[g.id]);
    const mine = idea.quantity;
    const resupply = (rate: number) => Math.max(0, rate * v.months - incoming0);
    const settledWith = (extra: number) => settledPrice(ctx, dest0, g.id, Math.max(0, dest0.stock[g.id] + incoming0 + mine + extra - drain * v.months));
    const annualRate = dest0.annual.months > 0 ? dest0.annual.imported[g.id] / dest0.annual.months : l.imported[g.id];
    const unitOf = (pr: number) => pr * (1 - ctx.data.market.spread) * factor;
    const variants = {
      A: unitOf(settledForecast),
      B: unitOf(withLag(settledForecast)),
      C: unitOf(withLag(settledWith(resupply(l.imported[g.id])))),
      D: unitOf(withLag(settledWith(resupply(annualRate)))),
      E: expectedSaleUnit(ctx, dest0, g.id, incoming0, idea.quantity, v.months) * factor,
      F: (() => {
        const at = arrivalMarket(ctx, dest0, g.id, incoming0, v.months);
        const pr = price0 + (at.price - price0) * 0.5;
        return quoteSell(ctx, { ...at.city, price: { ...at.city.price, [g.id]: pr } }, g.id, idea.quantity).unitPrice * factor;
      })(),
      G: (() => {
        const at = arrivalMarket(ctx, dest0, g.id, incoming0, v.months);
        const pr = Math.min(price0, at.price);
        return quoteSell(ctx, { ...at.city, price: { ...at.city.price, [g.id]: pr } }, g.id, idea.quantity).unitPrice * factor;
      })(),
    };
    const stock0 = dest0.stock[g.id];
    const prod0 = dest0.last.produced[g.id];
    const cons0 = dest0.last.consumed[g.id] + dest0.last.usedAsInput[g.id];
    const mods0 = st.modifiers.filter((m) => m.cityId === idea.to && m.goodId === g.id).length;
    if (!applyCommand(ctx, st, { type: 'trade', shipId: me.id, goodId: g.id, side: 'buy', quantity: idea.quantity }).ok) continue;
    const q = me.cargo.filter((l) => l.goodId === g.id).reduce((a, l) => a + l.quantity, 0);
    if (!applyCommand(ctx, st, { type: 'sail', shipId: me.id, to: idea.to }).ok) continue;
    let cur = st;
    let others = 0;
    let prod = 0;
    let cons = 0;
    let months = 0;
    for (let k = 0; k < 24; k++) {
      const r = stepMonth(ctx, cur);
      cur = r.state;
      months++;
      for (const e of r.events) if (e.type === 'delivery' && e.companyId !== PLAYER_ID && e.to === idea.to && e.goodId === g.id) others += e.quantity;
      const d = cur.cities[idea.to];
      prod += d.last.produced[g.id];
      cons += d.last.consumed[g.id] + d.last.usedAsInput[g.id];
      if (isDocked(cur.ships.find((x) => x.id === me.id)!)) break;
    }
    const ship = cur.ships.find((x) => x.id === me.id)!;
    const have = ship.cargo.filter((l) => l.goodId === g.id).reduce((a, l) => a + l.quantity, 0);
    const d = cur.cities[idea.to];
    const priceArr = d.price[g.id];
    const one = quoteSell(ctx, d, g.id, 1).unitPrice;
    const all = quoteSell(ctx, d, g.id, have).unitPrice;
    const before = cur.player.chronicle.length;
    if (!applyCommand(ctx, cur, { type: 'trade', shipId: me.id, goodId: g.id, side: 'sell', quantity: have }).ok) continue;
    const e = cur.player.chronicle.slice(before).find((x) => x.goodId === g.id);
    if (!e) continue;
    const actUnit = (e.revenue - e.tariff) / e.quantity;
    const hintUnit = variants.E;
    rows.push({
      surprise: e.surprise,
      variants,
      good: g.id,
      to: idea.to,
      months,
      expUnit: hintUnit,
      actUnit,
      miss: actUnit / hintUnit - 1,
      price0,
      priceArr,
      settledForecast,
      others,
      plannedIncoming: incoming0,
      prodExtra: prod - prod0 * months,
      consExtra: cons - cons0 * months,
      event: cur.modifiers.filter((m) => m.cityId === idea.to && m.goodId === g.id).length !== mods0,
      ownImpact: all / one - 1,
      q,
      stock0,
    });
    void q;
  }
  for (let m = 0; m < 7; m++) base = stepMonth(ctx, base).state;
}

for (const k of ['E', 'F', 'G']) {
  const miss = rows.map((r) => r.actUnit / r.variants[k] - 1);
  const mean = miss.reduce((a, b) => a + b, 0) / miss.length;
  const abs = miss.reduce((a, b) => a + Math.abs(b), 0) / miss.length;
  console.log(`  ${k}: 평균 ${(mean * 100).toFixed(1)}% | 평균 크기 ${(abs * 100).toFixed(1)}% | 15% 넘게 덜 받음 ${miss.filter((m) => m < -0.15).length}건 | 15% 넘게 더 받음 ${miss.filter((m) => m > 0.15).length}건`);
}
const bad = rows.filter((r) => r.miss < -0.15);
const pct = (a: number, b: number) => `${b ? Math.round((a / b) * 100) : 0}%`;
console.log(`${mode}: 힌트 ${rows.length}건, 예상보다 15% 넘게 덜 받음 ${bad.length}건(${pct(bad.length, rows.length)}), 평균 차이 ${(rows.reduce((a, r) => a + r.miss, 0) / rows.length * 100).toFixed(1)}%`);
const cause = (r: Row) => {
  const out: string[] = [];
  if (r.others > r.q * 0.3) out.push('others');
  if (r.prodExtra > r.q * 0.3) out.push('prod');
  if (r.consExtra < -r.q * 0.3) out.push('cons');
  if (r.event) out.push('event');
  if (r.ownImpact < -0.08) out.push('own');
  if (r.priceArr > r.settledForecast * 1.15 && r.actUnit < r.expUnit) out.push('lag');
  return out.length ? out : ['?'];
};
const tally: Record<string, number> = {};
for (const r of bad) for (const c of cause(r)) tally[c] = (tally[c] ?? 0) + 1;
console.log('크게 빗나간 경우의 까닭(겹칠 수 있음):', tally);
for (const r of bad.slice(0, 14)) {
  console.log(
    `${r.good.padEnd(12)} → ${r.to.padEnd(12)} ${r.months}달 예상 ${r.expUnit.toFixed(0)} 실제 ${r.actUnit.toFixed(0)} (${(r.miss * 100).toFixed(0)}%) | 값 ${r.price0.toFixed(0)}→${r.priceArr.toFixed(0)}, 예측 균형값 ${r.settledForecast.toFixed(0)} | 내 양 ${r.q.toFixed(0)} 재고 ${r.stock0.toFixed(0)} | 다른 배 ${r.others.toFixed(0)}(출발 때 알던 ${r.plannedIncoming.toFixed(0)}) 생산+ ${r.prodExtra.toFixed(0)} 소비+ ${r.consExtra.toFixed(0)} 사건 ${r.event} 내 판매 영향 ${(r.ownImpact * 100).toFixed(0)}% → ${cause(r).join(',')}`,
  );
}

const withS = rows.filter((r) => r.surprise);
console.log(`
게임이 설명을 붙인 판매 ${withS.length}건 / ${rows.length}건`);
for (const r of withS.slice(0, 6)) {
  console.log(`- ${r.good} → ${r.to}: 예상 ${r.surprise!.expectedUnit.toFixed(0)} 실제 ${r.surprise!.actualUnit.toFixed(0)}`);
  for (const x of r.surprise!.reasons) console.log(`    · ${x.text}`);
}
