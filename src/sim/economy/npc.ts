import type { SeededRNG } from '../core/rng';
import { executeBuy, executeSell, maxBuyable, quoteBuy, quoteSell } from './market';
import type { EconomyContext, EconomyState, Ship, SimEvent } from './types';

/** 부피 1단위를 a→b로 나르는 비용(운임 + 양쪽 항만비) */
export function freightPerVolume(ctx: EconomyContext, a: string, b: string): number {
  const s = ctx.data.shipping;
  return (ctx.distanceKm(a, b) / 1000) * s.costPerUnitPer1000Km + 2 * s.portFeePerUnit;
}

export function travelMonths(ctx: EconomyContext, a: string, b: string): number {
  return ctx.distanceKm(a, b) / ctx.data.npc.speedKmPerMonth;
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

/** from에서 사서 to에 파는 한 번의 항해 계획(현재 시세·재고 기준 견적) */
function planTrip(
  ctx: EconomyContext,
  state: EconomyState,
  ship: Ship,
  from: string,
  to: string,
  cashAvailable: number,
): { items: TripPlan['items']; profit: number } {
  const src = state.cities[from];
  const dest = state.cities[to];
  const freight = freightPerVolume(ctx, from, to);
  const items: TripPlan['items'] = [];
  if (!Number.isFinite(freight)) return { items, profit: 0 };
  const spread = ctx.data.market.spread;
  const candidates: { goodId: string; perVolume: number }[] = [];
  for (const g of ctx.goods) {
    if (dest.target[g.id] <= 0 || src.stock[g.id] <= 0) continue;
    const margin = dest.price[g.id] * (1 - spread) - src.price[g.id] * (1 + spread) - freight * g.volume;
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
    const absorb = dest.target[g.id] * ctx.data.npc.fillTo - dest.stock[g.id] - incomingCargo(state, to, g.id, ship);
    let qty = Math.min(room / g.volume, maxBuyable(ctx, src, g.id), absorb);
    if (qty < ctx.data.npc.minLotQuantity) continue;
    let buy = quoteBuy(ctx, src, g.id, qty);
    if (buy.total > cash) {
      qty *= (cash / buy.total) * 0.98;
      if (qty < ctx.data.npc.minLotQuantity) continue;
      buy = quoteBuy(ctx, src, g.id, qty);
    }
    const sell = quoteSell(ctx, dest, g.id, buy.quantity);
    const gain = sell.total - buy.total - freight * g.volume * buy.quantity;
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
  const here = ship.to;
  const city = state.cities[here];
  const company = state.companies.find((c) => c.id === ship.companyId)!;
  const month = state.month;
  const npc = ctx.data.npc;

  // 1) 판매(도착한 화물은 실제로 인도된 만큼만 도시 재고가 된다)
  for (const lot of ship.cargo) {
    const sale = executeSell(ctx, city, lot.goodId, lot.quantity);
    company.cash += sale.total;
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
  for (const from of ctx.cityIds) {
    const reposition = from === here ? 0 : travelMonths(ctx, here, from) + npc.portTimeMonths;
    if (!Number.isFinite(reposition)) continue;
    for (const to of ctx.cityIds) {
      if (to === from) continue;
      const plan = planTrip(ctx, state, ship, from, to, company.cash);
      if (plan.items.length === 0 || plan.profit < npc.minTripProfit) continue;
      const time = reposition + travelMonths(ctx, from, to) + npc.portTimeMonths;
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
      const freight = freightPerVolume(ctx, here, best.to) * g.volume * buy.quantity;
      const paidFreight = Math.min(freight, company.cash - buy.total);
      company.cash -= buy.total + paidFreight;
      state.sink += paidFreight;
      ship.cargo.push({
        goodId: item.goodId,
        quantity: buy.quantity,
        originCityId: here,
        originCountryId: ctx.countryOfCity[here],
        unitCost: buy.unitPrice,
      });
      events.push({
        type: 'departure', month, shipId: ship.id, companyId: company.id, from: here, to: best.to,
        goodId: item.goodId, quantity: buy.quantity, cost: buy.total,
      });
    }
    if (ship.cargo.length > 0) {
      ship.from = here;
      ship.to = best.to;
      ship.departedAt = depart;
      ship.arrivesAt = depart + travelMonths(ctx, here, best.to);
      return;
    }
  }

  // 3) 살 곳이 다른 항구면 빈 배로 이동, 할 일이 없으면 한 달 기다린다
  const target = best && best.from !== here ? best.from : here;
  ship.from = here;
  ship.to = target;
  ship.departedAt = depart;
  ship.arrivesAt = target === here ? now + 1 : depart + travelMonths(ctx, here, target);
}
