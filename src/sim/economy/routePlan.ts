import { forecastPrice, shipBuyable, quoteBuy, quoteSell } from './market';
import { incomingCargo } from './npc';
import { estimateVoyage, shipType } from './player';
import { expectedSaleFactor } from './policy';
import type { CityEconomy, EconomyContext, EconomyState, Ship, TradeRoute } from './types';

/**
 * 정기 항로의 수익성 계산(§10.3 자동항로).
 * 한 번 사서 파는 거래의 "손에 쥐는" 이익을 다음을 모두 넣어 계산한다:
 *  - 도착 시점의 값: 지금 값이 아니라, 항해하는 동안 그 항구에서 쓰이는 양과
 *    다른 배(경쟁 선박)가 그 항구로 실어 가는 양, 내가 실어 갈 양까지 더한 재고로 예상한 값
 *  - 관세·문화 웃돈(원산지·상표 기준), 냉장선이 아니면 상해 버리는 몫
 *  - 사고팔 때의 항만비, 그 거래가 차지하는 짐칸 몫만큼의 연료비·유지비
 * 이 계산은 자동항로의 구매 판단, 항로 전체 평가, 화면의 추천이 함께 쓴다(같은 숫자를 보여 주기 위해).
 */

export interface TradeEstimate {
  goodId: string;
  quantity: number;
  /** 산 값(항만비 포함) */
  cost: number;
  /** 도착해 팔 때 손에 쥘 돈(관세·웃돈·상함·항만비 반영) */
  revenue: number;
  /** 상해서 잃을 것으로 보는 몫(산 값 기준) */
  spoilage: number;
  /** 이 거래가 차지하는 짐칸 몫의 연료비 */
  fuelShare: number;
  /** 이 거래가 차지하는 짐칸 몫의 유지비 */
  upkeepShare: number;
  /** revenue − cost − fuelShare − upkeepShare */
  gain: number;
  /** gain / cost */
  margin: number;
  /** 도착 예상 1개 값(관세 등 반영 전) */
  arrivalPrice: number;
  /** 지금 그 항구의 1개 값 */
  priceNow: number;
}

export interface LegInfo {
  months: number;
  fuel: number;
  /** 운하·해협 통과료 */
  fees: number;
}

/**
 * 한 바퀴(또는 한 번의 항해)를 두 가지로 판단한다(§9.3).
 *  - contribution = 매매 차익 − 연료 − 통과료 등 운항에만 드는 돈: 지금 배를 움직이는 편이 세워 두는 것보다 나은가.
 *    (유지비는 기다려도 나가므로 이 판단에서 빼고, 같은 기간 세워 둘 때와 비교한 값이 된다)
 *  - net = contribution − 유지비: 이 항로가 정말 수익성이 있는가(추천·배 구매 판단).
 * 예: 판매 11,000 − 매입 10,000 − 연료 900 − 기타 운항비 200 = −100 → 운항 자체가 손실이라 출항을 보류한다.
 *     판매 11,000 − 매입 10,000 − 연료 600 − 기타 200 = 200 → 출항은 정박보다 낫지만, 유지비 300을 빼면 −100이라 수익 항로가 아니다.
 */
export function judgeLoop(x: { tradeGain: number; fuel: number; fees: number; upkeep: number }): {
  contribution: number;
  net: number;
  /** 정박보다 운항이 나은가(출항 판단) */
  sail: boolean;
  /** 유지비까지 뺀 총순이익이 남는가(수익 항로 판단) */
  profitable: boolean;
} {
  const contribution = x.tradeGain - x.fuel - x.fees;
  const net = contribution - x.upkeep;
  return { contribution, net, sail: contribution > 0, profitable: net > 0 };
}

/**
 * 도착할 즈음의 그 항구 시장(내 짐을 내리기 직전).
 * 재고: 지금 재고 + 다른 배들이 실어 오고 있는 양 − 항해하는 동안 쓰여 없어질 양.
 * 값: 시장은 한 달에 일부(priceAdjust)만 자리 잡을 값으로 움직이므로, 지금 값에서 그만큼만 다가간다.
 */
export function arrivalMarket(
  ctx: EconomyContext,
  dst: CityEconomy,
  goodId: string,
  incomingOthers: number,
  months: number,
): { price: number; stock: number; city: CityEconomy } {
  const l = dst.last;
  const drain = Math.max(0, l.consumed[goodId] + l.usedAsInput[goodId] - l.produced[goodId]);
  const stock = Math.max(0, dst.stock[goodId] + incomingOthers - drain * months);
  const settled = forecastPrice(ctx, dst, goodId, incomingOthers, months);
  const price = settled + (dst.price[goodId] - settled) * Math.pow(1 - ctx.data.market.priceAdjust, Math.max(0, months));
  const city = { ...dst, price: { ...dst.price, [goodId]: price }, stock: { ...dst.stock, [goodId]: stock } };
  return { price, stock, city };
}

/** 두 항구 사이 한 구간(항구에서 머무는 시간 포함). state가 있으면 지금의 운하·해협 상태를 따른다. */
export function legInfo(ctx: EconomyContext, typeId: string, from: string, to: string, state?: EconomyState): LegInfo {
  const v = estimateVoyage(ctx, typeId, from, to, state);
  return { months: v.months + ctx.data.npc.portTimeMonths, fuel: v.fuel, fees: v.fees };
}

/**
 * from에서 goodId를 quantity만큼 사서 months 뒤 to에서 판다고 할 때의 예상.
 * legFuel: 사는 항구에서 파는 항구까지 실제로 드는 연료비(짐칸 몫으로 나눈다).
 * except: 계산하는 배 자신(이미 실은 짐을 경쟁 화물로 세지 않는다).
 */
export function estimateTrade(
  ctx: EconomyContext,
  state: EconomyState,
  typeId: string,
  from: string,
  goodId: string,
  quantity: number,
  to: string,
  months: number,
  legFuel: number,
  except?: Ship,
): TradeEstimate {
  const g = ctx.goodById[goodId];
  const t = shipType(ctx, typeId);
  const src = state.cities[from];
  const dst = state.cities[to];
  const fee = ctx.data.shipping.portFeePerUnit * g.volume;
  const buy = quoteBuy(ctx, src, goodId, quantity);
  const q = buy.quantity;
  const cost = buy.total + fee * q;
  const keep = t.refrigerated || g.cargoClass !== 'perishable' ? 1 : Math.pow(1 - ctx.data.player.spoilagePerMonth, months);
  const sold = q * keep;
  let arrivalPrice = 0;
  let revenue = 0;
  if (dst.target[goodId] > 0 && sold > 0) {
    const arr = arrivalMarket(ctx, dst, goodId, incomingCargo(state, to, goodId, except), months);
    arrivalPrice = arr.price;
    const factor = expectedSaleFactor(ctx, state, from, goodId, to);
    // 내가 한꺼번에 내놓는 양만큼 값이 밀리는 것(가격 충격)은 실제 판매와 같은 견적으로
    const sale = quoteSell(ctx, arr.city, goodId, sold);
    revenue = Math.max(0, sale.total * factor - fee * sold);
  }
  const share = Math.min(1, (q * g.volume) / t.capacity);
  const fuelShare = legFuel * share;
  const upkeepShare = months * t.upkeepPerMonth * share;
  const gain = revenue - cost - fuelShare - upkeepShare;
  return {
    goodId,
    quantity: q,
    cost,
    revenue,
    spoilage: (cost / Math.max(q, 1e-9)) * (q - sold),
    fuelShare,
    upkeepShare,
    gain,
    margin: cost > 0 ? gain / cost : 0,
    arrivalPrice,
    priceNow: dst.price[goodId],
  };
}

/** route에서 stop 다음으로 이 상품을 파는 기항지(없으면 -1) */
export function nextSellingStop(route: Pick<TradeRoute, 'stops'>, from: number, goodId: string): number {
  const n = route.stops.length;
  for (let k = 1; k <= n; k++) {
    const j = (from + k) % n;
    if (route.stops[j].sell.includes(goodId)) return j === from ? -1 : j;
  }
  return -1;
}

/** 기항지 from에서 to까지(앞으로 돌며) 걸리는 달과 연료비·통과료 */
export function legsBetween(
  ctx: EconomyContext,
  typeId: string,
  route: Pick<TradeRoute, 'stops'>,
  from: number,
  to: number,
  state?: EconomyState,
): LegInfo {
  const n = route.stops.length;
  let months = 0;
  let fuel = 0;
  let fees = 0;
  for (let k = from; k !== to; k = (k + 1) % n) {
    const l = legInfo(ctx, typeId, route.stops[k].cityId, route.stops[(k + 1) % n].cityId, state);
    months += l.months;
    fuel += l.fuel;
    fees += l.fees;
  }
  return { months, fuel, fees };
}

/** 기항지 k에서 상품 하나를 살지: 살 양과 그때의 예상(살 수 없으면 null) */
export function planStopBuy(
  ctx: EconomyContext,
  state: EconomyState,
  typeId: string,
  route: Pick<TradeRoute, 'stops' | 'minMargin'>,
  k: number,
  item: { goodId: string; maxQuantity: number },
  room: number,
  budget: number,
  except?: Ship,
): { sellAt: number; estimate: TradeEstimate; reason?: 'noSeller' | 'noRoom' | 'noMoney' | 'margin' } {
  const g = ctx.goodById[item.goodId];
  const from = route.stops[k].cityId;
  const j = nextSellingStop(route, k, item.goodId);
  const empty = (reason: 'noSeller' | 'noRoom' | 'noMoney' | 'margin', est?: TradeEstimate) => ({
    sellAt: j,
    estimate: est ?? estimateTrade(ctx, state, typeId, from, item.goodId, 0, from, 0, 0, except),
    reason,
  });
  if (j < 0) return empty('noSeller');
  const t = shipType(ctx, typeId);
  if (!t.cargoClasses.includes(g.cargoClass)) return empty('noRoom');
  let q = Math.min(item.maxQuantity, room / g.volume, shipBuyable(ctx, state, state.cities[from], item.goodId));
  if (q < 0.5) return empty('noRoom');
  const fee = ctx.data.shipping.portFeePerUnit * g.volume;
  for (let it = 0; it < 40 && q >= 0.5 && quoteBuy(ctx, state.cities[from], item.goodId, q).total + fee * q > budget; it++) q *= 0.85;
  if (q < 0.5) return empty('noMoney');
  const leg = legsBetween(ctx, typeId, route, k, j, state);
  const est = estimateTrade(ctx, state, typeId, from, item.goodId, q, route.stops[j].cityId, leg.months, leg.fuel + leg.fees, except);
  if (est.margin < route.minMargin || est.gain <= 0) return { sellAt: j, estimate: est, reason: 'margin' };
  return { sellAt: j, estimate: est };
}

export interface RouteTrade extends TradeEstimate {
  buyStop: number;
  sellStop: number;
}

export interface RouteEvaluation {
  /** 한 바퀴 도는 데 걸리는 달 */
  loopMonths: number;
  trades: RouteTrade[];
  /** 매매 차익 합(산 값·항만비·관세·상함을 뺀, 연료·유지비 빼기 전) */
  tradeGain: number;
  fuel: number;
  /** 운하·해협 통과료 */
  fees: number;
  upkeep: number;
  spoilage: number;
  /** tradeGain − fuel − fees: 배를 움직일지 판단하는 값(유지비는 기다려도 나간다) */
  contribution: number;
  /** contribution − upkeep: 한 바퀴의 예상 순이익 */
  net: number;
  /** 한 달 평균 순이익 */
  perMonth: number;
  /** 짐 없이 가는 구간 수 */
  emptyLegs: number;
  /** 배가 못 들어가는 항구가 있다 */
  blocked: boolean;
}

/**
 * 항로를 한 바퀴 돈다고 할 때의 예상(지금 시세·재고·다른 배의 짐 기준).
 * 자동항로가 실제로 하는 것과 같은 규칙으로 산다: 다음에 파는 기항지에서 남을 때만, 조건(최소 이익률)을 넘을 때만.
 * startStop: 어느 기항지에서 출발하는지(배가 지금 서 있는 곳). 짐칸은 비어 있다고 본다.
 */
export function evaluateRoute(
  ctx: EconomyContext,
  state: EconomyState,
  route: Pick<TradeRoute, 'stops' | 'minMargin' | 'cashReserve'>,
  typeId: string,
  opts: { startStop?: number; cash?: number; except?: Ship; capacity?: number } = {},
): RouteEvaluation {
  const n = route.stops.length;
  const t = shipType(ctx, typeId);
  const capacity = opts.capacity ?? t.capacity;
  const blocked = route.stops.some((s) => t.size > (state.portLevel[s.cityId] ?? ctx.portSize[s.cityId] ?? 0));
  const s0 = Math.min(Math.max(0, opts.startStop ?? 0), Math.max(0, n - 1));
  let budget = (opts.cash ?? Infinity) - route.cashReserve;
  const trades: RouteTrade[] = [];
  const hold: RouteTrade[] = [];
  let fuel = 0;
  let loopMonths = 0;
  let emptyLegs = 0;
  if (n < 2 || blocked) {
    return { loopMonths: 0, trades, tradeGain: 0, fuel: 0, fees: 0, upkeep: 0, spoilage: 0, contribution: 0, net: 0, perMonth: 0, emptyLegs: 0, blocked };
  }
  let fees = 0;
  let unreachable = false;
  for (let step = 0; step < n; step++) {
    const k = (s0 + step) % n;
    const leg = legInfo(ctx, typeId, route.stops[k].cityId, route.stops[(k + 1) % n].cityId, state);
    if (!Number.isFinite(leg.months)) unreachable = true;
    // 이 기항지에서 팔 짐을 내린다(판 돈은 다음 구매에 쓸 수 있다)
    for (let i = hold.length - 1; i >= 0; i--) {
      if (hold[i].sellStop !== k) continue;
      budget += hold[i].revenue;
      hold.splice(i, 1);
    }
    // 살 것을 정한다(남는 짐칸·돈 안에서). 다음 구간을 갈 연료비·통과료는 남겨 둔다(출항 자금)
    for (const item of route.stops[k].buy) {
      const used = hold.reduce((s, h) => s + h.quantity * ctx.goodById[h.goodId].volume, 0);
      const plan = planStopBuy(ctx, state, typeId, route, k, item, capacity - used, budget - leg.fuel - leg.fees, opts.except);
      if (plan.reason) continue;
      const tr: RouteTrade = { ...plan.estimate, buyStop: k, sellStop: plan.sellAt };
      trades.push(tr);
      hold.push(tr);
      budget -= plan.estimate.cost;
    }
    if (hold.length === 0) emptyLegs++;
    fuel += leg.fuel;
    fees += leg.fees;
    budget -= leg.fuel + leg.fees;
    loopMonths += leg.months;
  }
  if (unreachable) {
    return { loopMonths: 0, trades: [], tradeGain: 0, fuel: 0, fees: 0, upkeep: 0, spoilage: 0, contribution: 0, net: 0, perMonth: 0, emptyLegs: 0, blocked: true };
  }
  // 연료·유지비는 거래마다 짐칸 몫으로 나눠 넣었으니, 여기서는 항로 전체로 다시 센다
  const tradeGain = trades.reduce((s, x) => s + x.revenue - x.cost, 0);
  const upkeep = loopMonths * t.upkeepPerMonth;
  const { contribution, net } = judgeLoop({ tradeGain, fuel, fees, upkeep });
  return {
    loopMonths,
    trades,
    tradeGain,
    fuel,
    fees,
    upkeep,
    spoilage: trades.reduce((s, x) => s + x.spoilage, 0),
    contribution,
    net,
    perMonth: loopMonths > 0 ? net / loopMonths : 0,
    emptyLegs,
    blocked,
  };
}

/**
 * 추천: 이 항로에서 기항지 k에서 사서 다른 기항지에서 팔면 실제로 남는 상품(배 한 척 기준).
 * "세계 평균보다 싸다"와 달리, 도착 때의 값·경쟁 선박·운항비를 모두 넣는다.
 */
export function routeOpportunities(
  ctx: EconomyContext,
  state: EconomyState,
  route: Pick<TradeRoute, 'stops'>,
  typeId: string,
  k: number,
): { goodId: string; sellStop: number; estimate: TradeEstimate }[] {
  const t = shipType(ctx, typeId);
  const from = route.stops[k].cityId;
  const out: { goodId: string; sellStop: number; estimate: TradeEstimate }[] = [];
  for (const g of ctx.goods) {
    if (!t.cargoClasses.includes(g.cargoClass)) continue;
    const avail = shipBuyable(ctx, state, state.cities[from], g.id);
    if (avail < 1) continue;
    let best: { goodId: string; sellStop: number; estimate: TradeEstimate } | null = null;
    for (let j = 0; j < route.stops.length; j++) {
      if (j === k || route.stops[j].cityId === from || state.cities[route.stops[j].cityId].target[g.id] <= 0) continue;
      const leg = legsBetween(ctx, typeId, route, k, j, state);
      const q = Math.min(avail, t.capacity / g.volume);
      const est = estimateTrade(ctx, state, typeId, from, g.id, q, route.stops[j].cityId, leg.months, leg.fuel + leg.fees);
      if (est.gain > 0 && (!best || est.gain > best.estimate.gain)) best = { goodId: g.id, sellStop: j, estimate: est };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.estimate.gain - a.estimate.gain);
}
