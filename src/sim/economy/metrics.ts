import { stepMonth } from './step';
import type { EconomyContext, EconomyState, SimEvent } from './types';

/** 상품별 균형 지표(기간 평균) */
export interface GoodBalance {
  produced: number;
  consumed: number;
  traded: number;
  /** 부족량 / 원한 양 */
  shortageRate: number;
  /** 소비·투입량으로 가중한 평균 가격 / 기준 가격. 사람들이 실제로 치른 값. */
  paidPriceRatio: number;
  /** 시장이 있는 (도시, 달) 중 가격이 상한의 90% 이상이던 비율 */
  nearCeilingShare: number;
  /** 생산 능력 대비 실제 생산 */
  utilization: number;
}

export interface BalanceReport {
  months: number;
  goods: Record<string, GoodBalance>;
  /** 회사 현금 / 시작 현금 (마지막 달) */
  companyCashRatio: number[];
  finalState: EconomyState;
  events: SimEvent[][];
}

/** warmup개월을 버리고 months개월 동안의 균형 지표를 잰다 */
export function measureBalance(
  ctx: EconomyContext,
  start: EconomyState,
  months: number,
  warmup = 12,
): BalanceReport {
  const zero = () => Object.fromEntries(ctx.goods.map((g) => [g.id, 0])) as Record<string, number>;
  const produced = zero();
  const consumed = zero();
  const used = zero();
  const shortage = zero();
  const paid = zero();
  const traded = zero();
  const capacity = zero();
  const ceiling = zero();
  const marketMonths = zero();
  const events: SimEvent[][] = [];
  let state = start;
  for (let m = 0; m < warmup + months; m++) {
    const r = stepMonth(ctx, state);
    state = r.state;
    events.push(r.events);
    if (m < warmup) continue;
    for (const e of r.events) if (e.type === 'delivery') traded[e.goodId] += e.quantity;
    for (const id of ctx.cityIds) {
      const c = state.cities[id];
      for (const ind of c.industries) capacity[ind.goodId] += ind.capacity;
      for (const g of ctx.goods) {
        const l = c.last;
        const u = l.consumed[g.id] + l.usedAsInput[g.id];
        produced[g.id] += l.produced[g.id];
        consumed[g.id] += l.consumed[g.id];
        used[g.id] += u;
        shortage[g.id] += l.shortage[g.id];
        paid[g.id] += u * c.price[g.id];
        if (c.target[g.id] > 0) {
          marketMonths[g.id]++;
          if (c.price[g.id] >= g.basePrice * ctx.data.market.priceCeil * 0.9) ceiling[g.id]++;
        }
      }
    }
  }
  const goods: Record<string, GoodBalance> = {};
  for (const g of ctx.goods) {
    const want = consumed[g.id] + shortage[g.id];
    goods[g.id] = {
      produced: produced[g.id] / months,
      consumed: consumed[g.id] / months,
      traded: traded[g.id] / months,
      shortageRate: want > 0 ? shortage[g.id] / want : 0,
      paidPriceRatio: used[g.id] > 0 ? paid[g.id] / used[g.id] / g.basePrice : 1,
      nearCeilingShare: marketMonths[g.id] > 0 ? ceiling[g.id] / marketMonths[g.id] : 0,
      utilization: capacity[g.id] > 0 ? produced[g.id] / capacity[g.id] : 0,
    };
  }
  return {
    months,
    goods,
    companyCashRatio: state.companies.map((c) => c.cash / ctx.data.npc.startingCash),
    finalState: state,
    events,
  };
}
