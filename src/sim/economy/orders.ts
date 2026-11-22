import { explainSource } from '../classroom/reasons';
import { SeededRNG } from '../core/rng';
import { quoteBuy, retainedFraction, shipBuyable } from './market';
import { canCarry, canEnter, cargoVolume, estimateVoyage, isDocked, PLAYER_ID, playerBuyLimit, shipType } from './player';
import { cityTrust, settleOrderTrust, trustChangeText, trustLevel } from './trust';
import { storedLots, warehouseOf } from './warehouse';
import type { CargoLot, EconomyContext, EconomyState, Ship, SimEvent, StorageZone, TradeOrder, TradeOrderBook, TradeReason } from './types';

export const ORDER_RULES = {
  intervalMin: 3, intervalMax: 5, offerMonths: 2, maxAccepted: 2,
  maxOpen: 3, historyLimit: 20, premium: 1.35,
} as const;

export function newOrderBook(month: number): TradeOrderBook {
  return { items: [], nextNo: 1, nextOfferMonth: month + 1, nextLocalOfferMonth: month + 2 };
}

export function isOpenOrder(order: TradeOrder): boolean {
  return order.status === 'offered' || order.status === 'accepted';
}

/** 이 배로 남은 발주를 채우는 현재 견적. UI와 구매 명령이 같은 계산을 쓴다. */
export function orderPurchasePlan(ctx: EconomyContext, state: EconomyState, ship: Ship, order: TradeOrder) {
  const remaining = Math.max(0, order.quantity - order.delivered);
  const aboard = ship.cargo.filter((l) => l.goodId === order.goodId && l.originCityId !== order.cityId).reduce((n, l) => n + l.quantity, 0);
  const plan = { remaining, aboard, needed: Math.max(0, Math.ceil(remaining - aboard - 1e-9)), quantity: 0, total: 0, keep: 1, reserve: 0, reason: '' };
  if (order.status !== 'accepted' || state.month >= order.deadlineMonth || remaining <= 1e-9) return { ...plan, reason: '진행 중인 발주가 아니에요.' };
  if (ship.companyId !== PLAYER_ID || !isDocked(ship) || ship.routeId) return { ...plan, reason: '직접 운항하는 내 배가 항구에 정박해야 해요.' };
  if (ship.to === order.cityId) return { ...plan, reason: '납품처에서 산 물건은 이 발주에 납품할 수 없어요.' };
  if (!canCarry(ctx, ship.typeId, order.goodId)) return { ...plan, reason: '이 배에는 발주 품목을 실을 수 없어요.' };
  if (!canEnter(ctx, state, ship.typeId, order.cityId)) return { ...plan, reason: '이 배는 납품 항구에 들어갈 수 없어요.' };
  const type = shipType(ctx, ship.typeId);
  const voyage = estimateVoyage(ctx, type.id, ship.to, order.cityId, state);
  if (!voyage.leg) return { ...plan, reason: '납품처까지 바로 갈 수 있는 배와 항구에서 채워 주세요.' };
  const months = Math.floor(voyage.months) + 1;
  if (state.month + months >= order.deadlineMonth) return { ...plan, reason: '지금 출항해도 납품 기한에 맞추기 어려워요.' };
  const g = ctx.goodById[order.goodId];
  plan.keep = retainedFraction(ctx, g, voyage.months, type.refrigerated);
  plan.needed = Math.max(0, Math.ceil(remaining / plan.keep - aboard - 1e-9));
  if (!plan.needed) return { ...plan, reason: '이 배에 필요한 물량을 모두 실었어요. 납품처로 출항하세요.' };
  // 매입 후에도 바로 출항하고 도착할 수 있도록 운항비를 남긴다.
  plan.reserve = voyage.fuel + voyage.fees + months * type.upkeepPerMonth + state.player.arrears;
  const budget = Math.max(0, state.player.cash - plan.reserve);
  const cost = (q: number) => quoteBuy(ctx, state.cities[ship.to], g.id, q, state).total + q * g.volume * ctx.data.shipping.portFeePerUnit;
  let low = 0, high = Math.min(plan.needed, Math.floor(playerBuyLimit(ctx, state, ship, g.id) + 1e-9));
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (cost(mid) <= budget) low = mid;
    else high = mid - 1;
  }
  plan.quantity = low;
  plan.total = low > 0 ? cost(low) : 0;
  if (low < plan.needed) plan.reason = '재고·짐칸·운항비를 남긴 구매 자금 안에서 가능한 만큼 채워요.';
  return plan;
}

/** 발주 시점의 실제 생산·수요·재고에 근거한 설명을 계약에 보관한다. */
export function orderReason(ctx: EconomyContext, state: EconomyState, cityId: string, goodId: string): TradeReason {
  const city = state.cities[cityId], g = ctx.goodById[goodId];
  const name = ctx.cityNames[cityId];
  const disruption = state.modifiers.find((m) => m.cityId === cityId && m.goodId === goodId && m.factor < 1 && m.untilMonth >= state.month);
  if (disruption) return { category: 'shortage', text: `${disruption.reason} 때문에 ${name}의 ${g.name} 생산이 줄었어요. 창고를 채울 물건을 다른 도시에서 구해요.` };
  const inputFor = city.industries.find((i) => i.capacity > 0 && (ctx.goodById[i.goodId].recipe?.[goodId] ?? 0) > 0);
  if (inputFor) return { category: 'industry', text: `${name}의 ${ctx.goodById[inputFor.goodId].name} 공장에는 원료인 ${g.name}이(가) 필요해요. 지금 재고가 목표의 ${Math.round(city.stock[goodId] / city.target[goodId] * 100)}%여서 다른 도시의 공급을 기다려요.` };
  const facility = city.industries.some((i) => i.goodId === goodId && i.capacity > 0);
  if (g.source?.kind === 'crop' && facility && (ctx.cropCoef[cityId]?.[g.source.id]?.[state.month % 12] ?? 1) < 0.5) {
    return { category: 'season', text: `${name}은(는) 지금 ${g.name} 수확이 적은 계절이에요. 다음 수확까지 쓸 물건을 다른 지역에서 들여오려 해요.` };
  }
  if (!facility && g.source?.kind === 'resource') return { category: 'resource', text: `${name}에는 ${g.name}을(를) 생산하는 시설이 없어요. 이곳에서 쓸 자원을 생산지에서 실어 와야 해요.` };
  if (!facility && g.recipe) return { category: 'industry', text: `${name}에는 ${g.name} 공장이 없지만 쓰려는 사람이 있어요. 공장이 있는 지역에서 물건을 들여오려 해요.` };
  return { category: 'demand', text: `${name}에서 쓰는 ${g.name} 재고가 목표의 ${Math.round(city.stock[goodId] / city.target[goodId] * 100)}%로 줄었어요. 같은 상품을 만드는 도시라도 필요한 때와 양이 달라 무역이 생겨요.` };
}

type Candidate = Omit<TradeOrder, 'id' | 'status' | 'delivered' | 'issuedMonth' | 'offerExpiresMonth'>;

/** 현재 배의 항속거리·항구 크기·현금·실을 자리 안에서 조달 예시가 있는 발주만 만든다. */
function candidates(ctx: EconomyContext, state: EconomyState): Candidate[] {
  const best = new Map<string, Candidate>();
  const recent = state.player.orders?.items.slice(-4) ?? [];
  const open = state.player.orders?.items.filter(isOpenOrder) ?? [];
  for (const ship of state.ships.filter((s) => s.companyId === PLAYER_ID && !s.routeId && isDocked(s))) {
    const type = shipType(ctx, ship.typeId);
    const space = Math.max(0, ship.capacity - cargoVolume(ctx, ship));
    // 조달항까지 빈 배로 가는 동안 재고가 소진되는 초반 함정을 피한다.
    // 지금 정박한 항구의 물건으로 시작할 수 있는 운송만 제안한다.
    for (const cityId of ctx.portIds) {
      if (cityId === ship.to || !canEnter(ctx, state, type.id, cityId)) continue;
      const v = estimateVoyage(ctx, type.id, ship.to, cityId, state);
      if (!v.leg) continue;
      const months = Math.floor(v.months) + 1;
      if (months > 8) continue;
      const travelCost = v.fuel + v.fees + (months + 1) * type.upkeepPerMonth;
      const budget = Math.min(state.player.cash * 0.55, state.player.cash - travelCost - state.player.arrears);
      if (budget <= 0) continue;
      const src = state.cities[ship.to], dst = state.cities[cityId];
      for (const g of ctx.goods) {
        if (!canCarry(ctx, type.id, g.id) || dst.target[g.id] <= 0 || dst.stock[g.id] >= dst.target[g.id] * 0.85) continue;
        if (open.some((o) => o.cityId === cityId && o.goodId === g.id)) continue;
        const keep = retainedFraction(ctx, g, v.months, type.refrigerated);
        let buyQty = Math.floor(Math.min(space * 0.6 / g.volume, shipBuyable(ctx, state, src, g.id), 60, (dst.target[g.id] - dst.stock[g.id]) * 0.4 / keep));
        let buy = quoteBuy(ctx, src, g.id, buyQty, state);
        while (buyQty >= 3 && buy.total + ctx.data.shipping.portFeePerUnit * g.volume * buyQty > budget) {
          buyQty = Math.floor(buyQty * 0.8);
          buy = quoteBuy(ctx, src, g.id, buyQty, state);
        }
        // 부패성 화물은 조금 넉넉히 실어도 한 번에 납품을 끝낼 수 있게 한다.
        const quantity = Math.floor(buyQty * keep * (keep < 1 ? 0.97 : 1));
        if (quantity < 3) continue;
        const cost = buy.total + ctx.data.shipping.portFeePerUnit * g.volume * buyQty + travelCost;
        const referencePrice = dst.price[g.id];
        const basePrice = Math.ceil(Math.max(referencePrice * ORDER_RULES.premium, cost / quantity * 1.3));
        // 아주 비싼 조달만 가능한 품목은 발주하지 않는다.
        if (basePrice > Math.max(g.basePrice, referencePrice) * 2) continue;
        const trustBonus = trustLevel(cityTrust(state, cityId).score).bonus;
        const unitPrice = Math.ceil(basePrice * (1 + trustBonus));
        const candidate: Candidate = {
          kind: 'city', sourceKind: 'market', trustBonus,
          cityId, goodId: g.id, quantity, unitPrice, referencePrice,
          deadlineMonth: state.month + Math.max(5, months + 3),
          reason: orderReason(ctx, state, cityId, g.id), sourceCityId: ship.to,
          sourceReason: explainSource(ctx, state, ship.to, g.id),
          suggestedBuyQuantity: buyQty, estimatedCost: Math.ceil(cost),
        };
        const key = `${cityId}/${g.id}`;
        if (!best.has(key) || cost / quantity < best.get(key)!.estimatedCost / best.get(key)!.quantity) best.set(key, candidate);
      }
    }
  }
  // 최근과 다른 요청을 우선해 서로 다른 무역 이유를 만날 수 있게 한다.
  const all = [...best.values()];
  const varied = all.filter((c) => !recent.some((o) => o.cityId === c.cityId && o.goodId === c.goodId));
  return varied.length ? varied : all;
}

/** 거점의 실제 부족분을 주변 항구에서 조달한다. 보유 재고와 왕복 항해도 고려한다. */
function localCandidates(ctx: EconomyContext, state: EconomyState): Candidate[] {
  const warehouse = warehouseOf(ctx, state), home = warehouse.cityId, dst = state.cities[home];
  const open = state.player.orders?.items.filter(isOpenOrder) ?? [];
  const trustBonus = trustLevel(cityTrust(state, home).score).bonus;
  const best = new Map<string, Candidate>();
  const needed = ctx.goods.filter((g) => dst.target[g.id] > 0 && dst.stock[g.id] < dst.target[g.id] * 0.85 && !open.some((o) => o.cityId === home && o.goodId === g.id));
  const add = (goodId: string, sourceCityId: string, sourceKind: Candidate['sourceKind'], quantity: number, buyQty: number, cost: number, months: number, sourceReason: TradeReason) => {
    if (quantity < 3) return;
    const g = ctx.goodById[goodId], referencePrice = dst.price[goodId];
    const basePrice = Math.ceil(Math.max(referencePrice * ORDER_RULES.premium, cost / quantity * 1.3));
    if (basePrice > Math.max(g.basePrice, referencePrice) * 2) return;
    const candidate: Candidate = {
      kind: 'local', sourceKind, trustBonus, cityId: home, goodId, sourceCityId,
      quantity, unitPrice: Math.ceil(basePrice * (1 + trustBonus)), referencePrice,
      deadlineMonth: state.month + Math.max(6, months + 3),
      reason: orderReason(ctx, state, home, goodId), sourceReason,
      suggestedBuyQuantity: buyQty, estimatedCost: Math.ceil(cost),
    };
    const previous = best.get(goodId);
    // 이미 들여온 회사 창고 재고를 먼저 활용한다.
    if (!previous || (previous.sourceKind !== 'warehouse' && (sourceKind === 'warehouse' || cost / quantity < previous.estimatedCost / previous.quantity))) best.set(goodId, candidate);
  };
  const inventory = (lots: CargoLot[], sourceKind: 'warehouse' | 'cargo', months: number, travelCost: number, refrigerated: boolean) => {
    for (const g of needed) {
      const eligible = lots.filter((l) => l.goodId === g.id && l.originCityId !== home && l.quantity > 0);
      const held = eligible.reduce((sum, l) => sum + l.quantity, 0);
      if (!held) continue;
      const keep = retainedFraction(ctx, g, months, refrigerated);
      const quantity = Math.floor(Math.min(held * keep * (keep < 1 ? 0.97 : 1), 60, (dst.target[g.id] - dst.stock[g.id]) * 0.4));
      let left = quantity / keep, cost = travelCost;
      for (const lot of eligible) { const take = Math.min(left, lot.quantity); cost += take * lot.unitCost; left -= take; }
      const first = eligible[0];
      add(g.id, first.originCityId, sourceKind, quantity, 0, cost, Math.ceil(months), first.bought?.reason ?? explainSource(ctx, state, first.originCityId, g.id));
    }
  };
  inventory([...warehouse.cargo, ...warehouse.coldCargo], 'warehouse', 0, 0, true);
  for (const ship of state.ships.filter((s) => s.companyId === PLAYER_ID && !s.routeId && isDocked(s))) {
    const type = shipType(ctx, ship.typeId);
    if (!canEnter(ctx, state, type.id, home)) continue;
    const back = ship.to === home ? null : estimateVoyage(ctx, type.id, ship.to, home, state);
    if (!back || back.leg) {
      const cost = back ? back.fuel + back.fees + (Math.floor(back.months) + 2) * type.upkeepPerMonth : 0;
      if (cost <= state.player.cash - state.player.arrears && (!back || back.months <= 8)) inventory(ship.cargo, 'cargo', back?.months ?? 0, cost, type.refrigerated);
    }
    const space = Math.max(0, ship.capacity - cargoVolume(ctx, ship));
    if (space <= 0) continue;
    for (const source of ctx.portIds) {
      if (source === home || !canEnter(ctx, state, type.id, source)) continue;
      const outward = source === ship.to ? null : estimateVoyage(ctx, type.id, ship.to, source, state);
      const inbound = estimateVoyage(ctx, type.id, source, home, state);
      if ((outward && !outward.leg) || !inbound.leg) continue;
      const months = (outward ? Math.floor(outward.months) + 1 : 0) + Math.floor(inbound.months) + 1;
      if (months > 8) continue;
      const travelCost = (outward ? outward.fuel + outward.fees : 0) + inbound.fuel + inbound.fees + (months + 1) * type.upkeepPerMonth;
      const budget = Math.min(state.player.cash * 0.55, state.player.cash - travelCost - state.player.arrears);
      if (budget <= 0) continue;
      for (const g of needed) {
        if (!canCarry(ctx, type.id, g.id)) continue;
        const keep = retainedFraction(ctx, g, inbound.months, type.refrigerated);
        const src = state.cities[source];
        // 조달항으로 가는 동안 주민·공장·기존 거래가 쓸 몫과 목표 재고도 남겨 둔다.
        // 아직 생산/수입되지 않은 물건을 확보한 것으로 가정하지 않는다.
        const outboundMonths = outward ? Math.floor(outward.months) + 1 : 0;
        const committedUse = src.last.consumed[g.id] + src.last.usedAsInput[g.id] + src.last.exported[g.id];
        const buffer = outboundMonths > 0 ? Math.max(src.reserve[g.id], src.target[g.id]) : src.reserve[g.id];
        const arrivalSupply = Math.max(0, src.stock[g.id] - buffer - committedUse * outboundMonths) * ctx.data.market.maxBuyShare;
        let buyQty = Math.floor(Math.min(space * 0.6 / g.volume, shipBuyable(ctx, state, src, g.id), arrivalSupply, 60, (dst.target[g.id] - dst.stock[g.id]) * 0.4 / keep));
        let buy = quoteBuy(ctx, state.cities[source], g.id, buyQty, state);
        while (buyQty >= 3 && buy.total + ctx.data.shipping.portFeePerUnit * g.volume * buyQty > budget) {
          buyQty = Math.floor(buyQty * 0.8);
          buy = quoteBuy(ctx, state.cities[source], g.id, buyQty, state);
        }
        const quantity = Math.floor(buyQty * keep * (keep < 1 ? 0.97 : 1));
        add(g.id, source, 'market', quantity, buyQty, buy.total + ctx.data.shipping.portFeePerUnit * g.volume * buyQty + travelCost, months, explainSource(ctx, state, source, g.id));
      }
    }
  }
  const all = [...best.values()];
  const recent = state.player.orders?.items.filter((o) => o.kind === 'local').slice(-2) ?? [];
  const varied = all.filter((c) => !recent.some((o) => o.goodId === c.goodId));
  return varied.length ? varied : all;
}

export function tickOrders(ctx: EconomyContext, state: EconomyState, events: SimEvent[]): void {
  // 준비 시뮬레이션에는 발주가 없다. 예전 저장은 첫 월 갱신부터 준비한다.
  if (!state.player.orders && state.month <= ctx.data.warmupMonths) return;
  const book = (state.player.orders ??= newOrderBook(state.month));
  book.nextLocalOfferMonth ??= state.month + 2;
  for (const order of book.items) {
    const expired = order.status === 'offered' ? state.month >= order.offerExpiresMonth : order.status === 'accepted' && state.month >= order.deadlineMonth;
    if (!expired) continue;
    const accepted = order.status === 'accepted';
    order.status = 'expired';
    order.closedMonth = state.month;
    if (accepted) {
      const change = settleOrderTrust(state, order);
      events.push({ type: 'order', month: state.month, orderId: order.id, kind: 'expired', text: `${ctx.cityNames[order.cityId]}의 ${ctx.goodById[order.goodId].name} 발주 기한이 지났어요. 납품한 대금은 그대로이고 위약금은 없어요. ${trustChangeText(change)}.` });
    }
  }
  const offer = (picked: Candidate) => {
    const order: TradeOrder = { ...picked, id: `order-${book.nextNo++}`, status: 'offered', delivered: 0, issuedMonth: state.month, offerExpiresMonth: state.month + ORDER_RULES.offerMonths };
    book.items.push(order);
    events.push({ type: 'order', month: state.month, orderId: order.id, kind: 'offered', text: `${order.kind === 'local' ? '거점 지역 발주: ' : ''}${ctx.cityNames[order.cityId]}에서 ${ctx.goodById[order.goodId].name} ${order.quantity}개를 요청했어요. 발주함에서 조건을 보고 선택하세요.` });
  };
  // 경제 사건·NPC와 독립된 난수: 발주를 무시해도 기존 세계 흐름은 바뀌지 않는다.
  // 일반 발주는 두 자리까지, 거점 지역 요청에는 한 자리를 남겨 둔다.
  if (state.month >= book.nextOfferMonth && book.items.filter(isOpenOrder).length < ORDER_RULES.maxOpen && book.items.filter((o) => isOpenOrder(o) && o.kind !== 'local').length < ORDER_RULES.maxOpen - 1) {
    const rng = new SeededRNG(`${state.rng.origin}/orders/${state.month}/${book.nextNo}`);
    book.nextOfferMonth = state.month + rng.int(ORDER_RULES.intervalMin, ORDER_RULES.intervalMax);
    const choices = candidates(ctx, state);
    if (choices.length) offer(choices[rng.int(0, choices.length - 1)]);
  }
  if (state.month >= book.nextLocalOfferMonth && book.items.filter(isOpenOrder).length < ORDER_RULES.maxOpen && !book.items.some((o) => o.kind === 'local' && isOpenOrder(o))) {
    const home = warehouseOf(ctx, state).cityId;
    book.nextLocalOfferMonth = state.month + trustLevel(cityTrust(state, home).score).localInterval;
    const rng = new SeededRNG(`${state.rng.origin}/local-orders/${state.month}/${book.nextNo}`);
    const choices = localCandidates(ctx, state);
    if (choices.length) offer(choices[rng.int(0, choices.length - 1)]);
  }
  const history = book.items.filter((o) => !isOpenOrder(o)).slice(-ORDER_RULES.historyLimit);
  book.items = book.items.filter((o) => isOpenOrder(o) || history.includes(o));
}

/** 거점 창고에서도 외부 항구에서 들여온 화물만 계약에 납품할 수 있다. */
export function warehouseDeliverableQuantity(state: EconomyState, order: TradeOrder, storage: StorageZone): number {
  const warehouse = state.player.warehouse;
  if (!warehouse || (storage !== 'ambient' && storage !== 'cold') || warehouse.cityId !== order.cityId || order.status !== 'accepted' || state.month >= order.deadlineMonth) return 0;
  const held = storedLots(warehouse, storage).filter((l) => l.goodId === order.goodId && l.originCityId !== order.cityId).reduce((q, l) => q + l.quantity, 0);
  return Math.max(0, Math.min(order.quantity - order.delivered, held));
}

/** 목적지에서 산 상품을 그 자리에서 되파는 것은 운송 납품이 아니다. */
export function deliverableQuantity(state: EconomyState, ship: Ship, order: TradeOrder): number {
  if (order.status !== 'accepted' || state.month >= order.deadlineMonth || ship.companyId !== PLAYER_ID || !isDocked(ship) || ship.routeId || ship.to !== order.cityId) return 0;
  const held = ship.cargo.filter((l) => l.goodId === order.goodId && l.originCityId !== order.cityId).reduce((n, l) => n + l.quantity, 0);
  return Math.max(0, Math.min(order.quantity - order.delivered, held));
}
