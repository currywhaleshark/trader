import type { SeededRNG } from '../core/rng';
import { executeBuy, executeSell, shipBuyable, quoteBuy, quoteSell } from './market';
import { expectedSaleFactor, lotTerms, maxPremium } from './policy';
import { chooseLeg, npcProfile } from './routing';
import type { EconomyContext, EconomyState, Ship, SimEvent } from './types';

/**
 * 부피 1단위를 a→b로 나르는 비용(운임 + 양쪽 항만비 + 운하·해협 통과료를 배 한 척 적재량으로 나눈 몫).
 * 플레이어와 같은 길 고르기(§8.2)를 따른다: 막힌 운하는 돌아가고, 돌아간 거리만큼 운임이 는다.
 */
export function freightPerVolume(ctx: EconomyContext, a: string, b: string, state?: EconomyState): number {
  if (state) return legTable(ctx, state, a, b).freight;
  return computeFreight(ctx, undefined, a, b);
}

export function travelMonths(ctx: EconomyContext, a: string, b: string, state?: EconomyState): number {
  if (state) return legTable(ctx, state, a, b).months;
  const leg = chooseLeg(ctx, undefined, a, b, npcProfile(ctx));
  return leg ? leg.months : Infinity;
}

function computeFreight(ctx: EconomyContext, state: EconomyState | undefined, a: string, b: string): number {
  const s = ctx.data.shipping;
  const leg = chooseLeg(ctx, state, a, b, npcProfile(ctx));
  if (!leg) return Infinity;
  return (leg.distanceKm / 1000) * s.costPerUnitPer1000Km + 2 * s.portFeePerUnit + leg.fees / ctx.data.npc.shipCapacity;
}

/**
 * NPC 구간표: 같은 상태(같은 달, 같은 운하 상태)에서는 항구 쌍의 운임·기간이 바뀌지 않으므로 한 번만 계산한다.
 * 운하·해협 상태를 바꾸면 invalidateLegTables로 비운다.
 */
interface LegTable {
  index: Map<string, number>;
  freight: Float64Array;
  months: Float64Array;
}
const legTables = new WeakMap<EconomyState, LegTable>();

export function invalidateLegTables(state: EconomyState): void {
  legTables.delete(state);
}

function legTable(ctx: EconomyContext, state: EconomyState, a: string, b: string): { freight: number; months: number } {
  let t = legTables.get(state);
  if (!t) {
    const ids = ctx.cityIds;
    const n = ids.length;
    t = { index: new Map(ids.map((id, i) => [id, i])), freight: new Float64Array(n * n).fill(NaN), months: new Float64Array(n * n).fill(NaN) };
    legTables.set(state, t);
  }
  const i = t.index.get(a);
  const j = t.index.get(b);
  if (i === undefined || j === undefined) return { freight: Infinity, months: Infinity };
  const k = i * ctx.cityIds.length + j;
  if (Number.isNaN(t.freight[k])) {
    const leg = chooseLeg(ctx, state, a, b, npcProfile(ctx));
    t.freight[k] = computeFreight(ctx, state, a, b);
    t.months[k] = leg ? leg.months : Infinity;
  }
  return { freight: t.freight[k], months: t.months[k] };
}

const nearMemo = new WeakMap<EconomyContext, Map<string, string[]>>();

/** 이 항구에서 살 곳 후보: 지금 항구 + 가까운 순으로 repositionCandidates곳(없으면 모든 항구) */
function buyCandidates(ctx: EconomyContext, here: string): string[] {
  const k = ctx.data.npc.repositionCandidates;
  if (!k || k >= ctx.portIds.length - 1) return ctx.portIds;
  let memo = nearMemo.get(ctx);
  if (!memo) nearMemo.set(ctx, (memo = new Map()));
  let list = memo.get(here);
  if (!list) {
    const others = ctx.portIds.filter((id) => id !== here && Number.isFinite(ctx.distanceKm(here, id)));
    others.sort((a, b) => ctx.distanceKm(here, a) - ctx.distanceKm(here, b));
    list = [here, ...others.slice(0, k)];
    memo.set(here, list);
  }
  return list;
}

/** NPC 배의 항해 경로 기록(지도·봉쇄 때 다시 찾기용). 통과료는 운임에 넣어 미리 냈다. */
function setVoyage(ctx: EconomyContext, state: EconomyState, ship: Ship): void {
  if (ship.from === ship.to) {
    ship.voyage = undefined;
    return;
  }
  const leg = chooseLeg(ctx, state, ship.from, ship.to, npcProfile(ctx));
  if (!leg) return;
  ship.voyage = {
    distanceKm: leg.distanceKm,
    passages: leg.passages,
    avoid: leg.avoid,
    transits: leg.passages.map((id) => ({ id, at: ship.departedAt + (leg.passageAt[id] ?? 0.5) * (ship.arrivesAt - ship.departedAt), fee: 0, paid: false })),
  };
}

/** 다른 배들이 이미 그 도시로 싣고 가는 양 */
export function incomingCargo(state: EconomyState, cityId: string, goodId: string, except?: Ship): number {
  let sum = 0;
  for (const s of state.ships) {
    if (s === except || s.to !== cityId || s.from === s.to) continue;
    for (const lot of s.cargo) if (lot.goodId === goodId) sum += lot.quantity;
  }
  return sum;
}

interface TripPlan {
  from: string;
  to: string;
  items: { goodId: string; quantity: number }[];
  profit: number;
  score: number;
}

/**
 * 한 번의 결정(항구 도착) 동안 바뀌지 않는 시장 값을 숫자 배열로 옮겨 둔다.
 * 많은 (사는 곳, 파는 곳) 쌍을 빠르게 거르기 위한 것이며, 계산 결과는 객체에서 읽을 때와 같다.
 */
interface MarketSnapshot {
  index: Map<string, number>;
  goods: number;
  price: Float64Array;
  stock: Float64Array;
  target: Float64Array;
  /** 다른 배들이 그 도시로 싣고 가는 양(도시×상품) */
  incoming: Float64Array;
  /** 도착 나라 번호(도시별)와 관세·웃돈 어림값 기억(출발 도시×상품×도착 나라, NaN = 아직 모름) */
  countryOf: Int32Array;
  countries: number;
  saleFactor: Float64Array;
}

function snapshot(ctx: EconomyContext, state: EconomyState, ship: Ship): MarketSnapshot {
  const G = ctx.goods.length;
  const n = ctx.cityIds.length;
  const price = new Float64Array(n * G);
  const stock = new Float64Array(n * G);
  const target = new Float64Array(n * G);
  const index = new Map(ctx.cityIds.map((id, i) => [id, i]));
  const goodIndex = new Map(ctx.goods.map((g, k) => [g.id, k]));
  ctx.cityIds.forEach((id, i) => {
    const c = state.cities[id];
    ctx.goods.forEach((g, k) => {
      price[i * G + k] = c.price[g.id];
      stock[i * G + k] = c.stock[g.id];
      target[i * G + k] = c.target[g.id];
    });
  });
  // incomingCargo(state, to, good, ship)와 같은 값: 이 배를 뺀, 항해 중인 배들의 짐
  const incoming = new Float64Array(n * G);
  for (const s of state.ships) {
    if (s === ship || s.from === s.to) continue;
    const i = index.get(s.to);
    if (i === undefined) continue;
    for (const lot of s.cargo) {
      const k = goodIndex.get(lot.goodId);
      if (k !== undefined) incoming[i * G + k] += lot.quantity;
    }
  }
  const countryIds = [...new Set(ctx.cityIds.map((id) => ctx.countryOfCity[id]))];
  const cIndex = new Map(countryIds.map((c, i) => [c, i]));
  const countryOf = Int32Array.from(ctx.cityIds.map((id) => cIndex.get(ctx.countryOfCity[id])!));
  const saleFactor = new Float64Array(n * G * countryIds.length).fill(NaN);
  return { index, goods: G, price, stock, target, incoming, countryOf, countries: countryIds.length, saleFactor };
}

/** 성능 측정용 누적 횟수(§15 측정 보고). 계산 결과에는 영향이 없다. */
export const npcStats = { arrivals: 0, plans: 0 };

/** from에서 사서 to에 파는 한 번의 항해 계획(현재 시세·재고 기준 견적) */
function planTrip(
  ctx: EconomyContext,
  state: EconomyState,
  ship: Ship,
  from: string,
  to: string,
  cashAvailable: number,
  memo?: Map<string, number>,
  incoming?: Map<string, number>,
  premiumBound?: number,
  snap?: MarketSnapshot,
): { items: TripPlan['items']; profit: number } {
  npcStats.plans++;
  const src = state.cities[from];
  const dest = state.cities[to];
  const freight = freightPerVolume(ctx, from, to, state);
  const items: TripPlan['items'] = [];
  if (!Number.isFinite(freight)) return { items, profit: 0 };
  const spread = ctx.data.market.spread;
  const candidates: { goodId: string; perVolume: number }[] = [];
  const factor: Record<string, number> = {};
  const best = premiumBound ?? 1 + maxPremium(ctx, state);
  const si = snap ? snap.index.get(from)! * snap.goods : 0;
  const di = snap ? snap.index.get(to)! * snap.goods : 0;
  for (let k = 0; k < ctx.goods.length; k++) {
    const g = ctx.goods[k];
    if (snap) {
      // 같은 거르기를 숫자 배열로 먼저 한다(값은 객체와 같다)
      if (snap.target[di + k] <= 0 || snap.stock[si + k] <= 0) continue;
      if (snap.price[di + k] * (1 - spread) * best - snap.price[si + k] * (1 + spread) - freight * g.volume <= 0) continue;
    }
    if (dest.target[g.id] <= 0 || src.stock[g.id] <= 0) continue;
    // 웃돈을 가장 후하게 쳐도 남지 않으면 정확히 계산할 필요가 없다
    if (dest.price[g.id] * (1 - spread) * best - src.price[g.id] * (1 + spread) - freight * g.volume <= 0) continue;
    // 관세(원산지 기준)와 문화 웃돈(상표 기준)을 출발지 창고 구성으로 어림한다(결정 동안 기억)
    let f: number | undefined;
    if (snap) {
      const slot = (si + k) * snap.countries + snap.countryOf[di / snap.goods];
      f = snap.saleFactor[slot];
      if (Number.isNaN(f)) f = snap.saleFactor[slot] = expectedSaleFactor(ctx, state, from, g.id, to);
    } else {
      const memoKey = `${from}|${g.id}|${ctx.countryOfCity[to]}`;
      f = memo?.get(memoKey);
      if (f === undefined) {
        f = expectedSaleFactor(ctx, state, from, g.id, to);
        memo?.set(memoKey, f);
      }
    }
    factor[g.id] = f;
    const margin = dest.price[g.id] * (1 - spread) * factor[g.id] - src.price[g.id] * (1 + spread) - freight * g.volume;
    if (margin > 0) candidates.push({ goodId: g.id, perVolume: margin / g.volume });
  }
  candidates.sort((x, y) => y.perVolume - x.perVolume);

  let room = ship.capacity;
  let cash = cashAvailable;
  let profit = 0;
  for (const cand of candidates) {
    const g = ctx.goodById[cand.goodId];
    if (room < g.volume * ctx.data.npc.minLotQuantity) continue;
    // 도착지가 받아 줄 만큼만: 목표의 fillTo배까지, 이미 가고 있는 화물은 뺀다
    const coming = snap
      ? snap.incoming[di + ctx.goods.indexOf(g)]
      : incoming
        ? (incoming.get(`${to}|${g.id}`) ?? 0)
        : incomingCargo(state, to, g.id, ship);
    const absorb = dest.target[g.id] * ctx.data.npc.fillTo - dest.stock[g.id] - coming;
    let qty = Math.min(room / g.volume, shipBuyable(ctx, state, src, g.id), absorb);
    if (qty < ctx.data.npc.minLotQuantity) continue;
    let buy = quoteBuy(ctx, src, g.id, qty);
    if (buy.total > cash) {
      qty *= (cash / buy.total) * 0.98;
      if (qty < ctx.data.npc.minLotQuantity) continue;
      buy = quoteBuy(ctx, src, g.id, qty);
    }
    const sell = quoteSell(ctx, dest, g.id, buy.quantity);
    const gain = sell.total * factor[g.id] - buy.total - freight * g.volume * buy.quantity;
    if (gain <= 0) continue;
    items.push({ goodId: g.id, quantity: buy.quantity });
    profit += gain;
    room -= buy.quantity * g.volume;
    cash -= buy.total;
  }
  return { items, profit };
}

/**
 * 항구에 닿은 NPC 선박의 행동: 화물을 전부 팔고, 다음 거래를 고른다.
 *  - 세계의 모든 (사는 곳, 파는 곳) 쌍을 견주어 "걸리는 시간 대비 이익"이 가장 큰 거래를 택한다.
 *    사는 곳이 다른 항구면 빈 배로 그곳까지 간다(그 시간도 계산에 넣는다).
 *  - 플레이어와 같은 시장 규칙(실재고·호가 차이·가격 충격·운임)을 따른다.
 *  - 판단에는 오차가 있고 도착할 때 시세가 달라져 있을 수 있으므로 완벽한 AI가 아니다.
 */
export function actAtPort(
  ctx: EconomyContext,
  state: EconomyState,
  ship: Ship,
  now: number,
  rng: SeededRNG,
  events: SimEvent[],
): void {
  npcStats.arrivals++;
  const here = ship.to;
  const city = state.cities[here];
  const company = state.companies.find((c) => c.id === ship.companyId)!;
  const month = state.month;
  const npc = ctx.data.npc;

  // 1) 판매(도착한 화물은 실제로 인도된 만큼만 도시 재고가 된다)
  for (const lot of ship.cargo) {
    const terms = lotTerms(ctx, state, here, lot.goodId, lot.originCountryId, lot.brandCountryId);
    const sale = executeSell(ctx, city, lot.goodId, lot.quantity, lot.originCountryId, lot.brandCountryId, terms.premium);
    // 관세는 대금에서 떼어 그 나라 정부(도시 금고)에 낸다
    const tariff = sale.total * terms.tariff;
    city.treasury += tariff;
    city.annual.tariffs += tariff;
    company.cash += sale.total - tariff;
    events.push({
      type: 'delivery', month, shipId: ship.id, companyId: company.id, from: ship.from, to: here,
      goodId: lot.goodId, quantity: sale.quantity, revenue: sale.total, originCityId: lot.originCityId,
    });
  }
  ship.cargo = [];

  // 2) 다음 거래 고르기
  const emptyHeading: Record<string, number> = {};
  for (const s of state.ships) {
    if (s !== ship && s.from !== s.to && s.cargo.length === 0) emptyHeading[s.to] = (emptyHeading[s.to] ?? 0) + 1;
  }
  let best: TripPlan | null = null;
  // 이 결정 동안 출발지 창고 구성은 변하지 않으므로 관세·웃돈 어림값을 재사용한다
  const memo = new Map<string, number>();
  // 문화 웃돈의 최댓값(빠른 거르기용)과 시장 값도 이 결정 동안 그대로다
  const premiumBound = 1 + maxPremium(ctx, state);
  const snap = snapshot(ctx, state, ship);
  // 다른 배들이 각 항구로 싣고 가는 양도 이 결정 동안 그대로다: 한 번만 센다(incomingCargo와 같은 값)
  const incoming = new Map<string, number>();
  for (const s of state.ships) {
    if (s === ship || s.from === s.to) continue;
    for (const lot of s.cargo) {
      const key = `${s.to}|${lot.goodId}`;
      incoming.set(key, (incoming.get(key) ?? 0) + lot.quantity);
    }
  }
  for (const from of buyCandidates(ctx, here)) {
    const reposition = from === here ? 0 : travelMonths(ctx, here, from, state) + npc.portTimeMonths;
    if (!Number.isFinite(reposition)) continue;
    for (const to of ctx.portIds) {
      if (to === from) continue;
      const plan = planTrip(ctx, state, ship, from, to, company.cash, memo, incoming, premiumBound, snap);
      if (plan.items.length === 0 || plan.profit < npc.minTripProfit) continue;
      const time = reposition + travelMonths(ctx, from, to, state) + npc.portTimeMonths;
      const noise = 1 + rng.range(-npc.judgementNoise, npc.judgementNoise);
      // 같은 곳으로 이미 빈 배가 가고 있으면 덜 끌린다
      const crowd = from === here ? 1 : 1 + (emptyHeading[from] ?? 0);
      const score = ((plan.profit / time) * noise) / crowd;
      if (!best || score > best.score) best = { from, to, items: plan.items, profit: plan.profit, score };
    }
  }

  const depart = now + npc.portTimeMonths;
  if (best && best.from === here) {
    for (const item of best.items) {
      const g = ctx.goodById[item.goodId];
      const quote = quoteBuy(ctx, city, item.goodId, item.quantity);
      if (quote.quantity <= 0 || quote.total > company.cash) continue;
      const buy = executeBuy(ctx, city, item.goodId, item.quantity);
      const freight = freightPerVolume(ctx, here, best.to, state) * g.volume * buy.quantity;
      const paidFreight = Math.min(freight, company.cash - buy.total);
      company.cash -= buy.total + paidFreight;
      state.sink += paidFreight;
      for (const part of buy.parts) {
        ship.cargo.push({
          goodId: item.goodId,
          quantity: part.quantity,
          originCityId: here,
          originCountryId: part.origin,
          brandCountryId: part.brand,
          unitCost: buy.unitPrice,
        });
      }
      events.push({
        type: 'departure', month, shipId: ship.id, companyId: company.id, from: here, to: best.to,
        goodId: item.goodId, quantity: buy.quantity, cost: buy.total,
      });
    }
    if (ship.cargo.length > 0) {
      ship.from = here;
      ship.to = best.to;
      ship.departedAt = depart;
      ship.arrivesAt = depart + travelMonths(ctx, here, best.to, state);
      setVoyage(ctx, state, ship);
      return;
    }
  }

  // 3) 살 곳이 다른 항구면 빈 배로 이동, 할 일이 없으면 한 달 기다린다
  const target = best && best.from !== here ? best.from : here;
  ship.from = here;
  ship.to = target;
  ship.departedAt = depart;
  ship.arrivesAt = target === here ? now + 1 : depart + travelMonths(ctx, here, target, state);
  setVoyage(ctx, state, ship);
}
