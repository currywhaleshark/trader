import { forecastPrice, quoteBuy } from './market';
import { incomingCargo } from './npc';
import { expectedSaleFactor, tariffRate } from './policy';
import { canCarry, canEnter, estimateVoyage, playerBuyLimit, shipType } from './player';
import type { EconomyContext, EconomyState, Ship } from './types';

/** "어디로 가면 남을까?" 한 줄 추천 */
export interface TripIdea {
  to: string;
  goodId: string;
  quantity: number;
  /** 연료비·유지비·항만비까지 뺀 예상 이익 */
  profit: number;
  months: number;
  /** 왜 남는지(학생용 문장) */
  reason: string;
}

/**
 * 지금 서 있는 항구에서 살 수 있는 상품 하나를 다른 항구에 가져갈 때의 예상 이익 순위.
 * 값은 "이미 오고 있는 배들과 내 짐까지 풀렸을 때의 예상 값"으로 계산하므로 지나치게 낙관하지 않는다.
 * 정답을 알려 주는 기능이 아니라, 학생이 이유를 읽고 고르도록 돕는 힌트다.
 */
export function suggestTrips(ctx: EconomyContext, state: EconomyState, ship: Ship, limit = 3): TripIdea[] {
  const here = ship.to;
  const src = state.cities[here];
  const type = shipType(ctx, ship.typeId);
  const spread = ctx.data.market.spread;
  const fee = ctx.data.shipping.portFeePerUnit;
  const ideas: TripIdea[] = [];
  for (const to of ctx.cityIds) {
    if (to === here || !canEnter(ctx, state, type.id, to)) continue;
    const v = estimateVoyage(ctx, type.id, here, to);
    if (!Number.isFinite(v.distanceKm)) continue;
    const budget = state.player.cash - v.fuel;
    if (budget <= 0) continue;
    const dest = state.cities[to];
    let best: TripIdea | null = null;
    for (const g of ctx.goods) {
      if (!canCarry(ctx, type.id, g.id) || dest.target[g.id] <= 0) continue;
      const incoming = incomingCargo(state, to, g.id, ship);
      let q = Math.min(playerBuyLimit(ctx, state, ship, g.id), dest.target[g.id] * 1.5 - dest.stock[g.id] - incoming);
      for (let k = 0; k < 30 && q >= 1 && quoteBuy(ctx, src, g.id, q).total + fee * g.volume * q > budget; k++) q *= 0.85;
      if (q < 1) continue;
      const keep = type.refrigerated || g.cargoClass !== 'perishable' ? 1 : Math.pow(1 - ctx.data.player.spoilagePerMonth, v.months);
      const buy = quoteBuy(ctx, src, g.id, q);
      const unit = forecastPrice(ctx, dest, g.id, incoming + q * keep, v.months) * (1 - spread) * expectedSaleFactor(ctx, state, here, g.id, to);
      const profit = unit * q * keep - buy.total - 2 * fee * g.volume * q - v.fuel - v.upkeep;
      if (profit <= 0 || (best && profit <= best.profit)) continue;
      const destRatio = dest.stock[g.id] / dest.target[g.id];
      const srcRatio = src.target[g.id] > 0 ? src.stock[g.id] / src.target[g.id] : 2;
      const parts: string[] = [];
      if (destRatio < 0.7) parts.push(`${ctx.cityNames[to]}에는 ${g.name}이(가) 모자라 비싸요`);
      else if (dest.price[g.id] > g.basePrice * 1.15) parts.push(`${ctx.cityNames[to]}에서 ${g.name} 값이 높아요`);
      if (srcRatio > 1.3) parts.push(`여기는 ${g.name}이(가) 남아돌아 싸요`);
      else if (src.price[g.id] < g.basePrice * 0.9) parts.push(`여기서 ${g.name}을(를) 싸게 살 수 있어요`);
      if (parts.length === 0) parts.push('두 항구의 값 차이가 운반비보다 커요');
      best = { to, goodId: g.id, quantity: q, profit, months: v.months, reason: parts.join(', ') };
    }
    if (best) ideas.push(best);
  }
  // 걸리는 시간도 따져, 한 달에 버는 돈이 큰 순서
  return ideas.sort((a, b) => b.profit / (b.months + 0.2) - a.profit / (a.months + 0.2)).slice(0, limit);
}
