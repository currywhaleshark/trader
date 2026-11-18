import { executeBuy, executeSell, maxBuyable, quoteBuy, quoteSell } from './market';
import type { EconomyContext, EconomyState, InlandShipment } from './types';

/**
 * 배후 운송(§4.2). 내륙 경제권과 관문항 시장 사이의 물량을 월별 경제 처리에서 자동으로 옮긴다.
 *  - 플레이어가 트럭·열차를 조작하지 않는다. 두 시장의 값 차이가 운송비보다 클 때 도시 상인들이 옮긴다.
 *  - 출발 시장에서 실제로 살 수 있는 만큼만(남겨 둘 몫·한 번에 살 수 있는 비율 안에서) 꺼낸다.
 *    그래서 시작 재고가 없는 배후지가 100을 만들고 40을 썼다면 내보낼 수 있는 양은 60을 넘지 않는다.
 *  - 이동 중인 물량은 재고와 따로 세고(state.inland), 기간이 지나 도착한 만큼만 관문항 재고가 된다.
 *  - 원산지·상표는 그대로 간다(경유해도 원산지가 바뀌지 않는다).
 *  - 관세: 단순화를 위해 배후 운송에는 관세를 매기지 않는다. 배로 들어온 물건은 관문항 시장에 팔릴 때
 *    한 번 통관(관문국 규칙)한 것으로 보고, 같은 물건에 두 번 매기지 않는다.
 *  - 돈: 출발 시장의 상인은 판 값을 받고, 도착 시장의 상인이 그 값과 운송비를 떠날 때 낸다. 운송비는 경제 밖으로 나간다.
 *    (돈의 총합이 그대로다)
 */
export function inlandStep(ctx: EconomyContext, state: EconomyState, month: number): void {
  if (ctx.inlandLinks.length === 0) return;
  const end = month + 1;
  const list = (state.inland ??= []);
  // 1) 도착: 이번 달 안에 닿는 물량을 도착 시장에 넣는다
  const arrived = list.filter((s) => s.arrivesAt < end);
  state.inland = list.filter((s) => s.arrivesAt >= end);
  for (const s of arrived) {
    const dst = state.cities[s.to];
    if (!dst) continue;
    // 도착 시장이 그 상품을 쓰지 않아도(목표 0) 버리지 않고 재고에 넣는다(물량 보존)
    const sale = executeSell(ctx, dst, s.goodId, s.quantity, s.originCountryId, s.brandCountryId);
    // 값은 떠날 때 도착 시장 상인이 이미 치렀다(executeSell이 뺀 대금을 되돌린다: 돈이 생기거나 사라지지 않게)
    dst.treasury += sale.total;
    const left = s.quantity - sale.quantity;
    if (left > 1e-9) {
      dst.stock[s.goodId] += left;
      const mix = (dst.mix[s.goodId] ??= {});
      const key = `${s.originCountryId}/${s.brandCountryId}`;
      mix[key] = (mix[key] ?? 0) + left;
    }
  }

  // 2) 출발: 연결마다, 방향마다 남는 몫을 운송 한도 안에서 옮긴다
  const r = ctx.data.inland;
  const spread = ctx.data.market.spread;
  for (const link of ctx.inlandLinks) {
    for (const [fromId, toId] of [
      [link.inlandId, link.portId],
      [link.portId, link.inlandId],
    ]) {
      const src = state.cities[fromId];
      const dst = state.cities[toId];
      if (!src || !dst) continue;
      let room = link.monthlyCapacity;
      const cands: { goodId: string; perVolume: number }[] = [];
      for (const g of ctx.goods) {
        if (dst.target[g.id] <= 0 || src.stock[g.id] <= 0) continue;
        const gap = dst.price[g.id] * (1 - spread) - src.price[g.id] * (1 + spread) - link.costPerUnit * g.volume;
        if (gap / src.price[g.id] <= r.minMargin) continue;
        cands.push({ goodId: g.id, perVolume: gap / g.volume });
      }
      cands.sort((a, b) => b.perVolume - a.perVolume);
      for (const c of cands) {
        if (room <= 1e-6) break;
        const g = ctx.goodById[c.goodId];
        const moving = state.inland.filter((s) => s.to === toId && s.goodId === g.id).reduce((s, x) => s + x.quantity, 0);
        const absorb = dst.target[g.id] * r.fillTo - dst.stock[g.id] - moving;
        let q = Math.min(room / g.volume, maxBuyable(ctx, src, g.id), absorb);
        if (q < r.minLot) continue;
        // 실제 견적으로 다시 확인(내가 옮기는 양만큼 값이 밀린다)
        const buy = quoteBuy(ctx, src, g.id, q);
        const sell = quoteSell(ctx, dst, g.id, buy.quantity);
        if (sell.total - buy.total - link.costPerUnit * g.volume * buy.quantity <= 0) continue;
        q = buy.quantity;
        const done = executeBuy(ctx, src, g.id, q);
        if (done.quantity <= 0) continue;
        // 도착 시장 상인이 출발 시장에 물건값(done.total, 출발 시장 금고로 이미 들어갔다)과 운송비를 낸다
        const cost = link.costPerUnit * g.volume * done.quantity;
        dst.treasury -= done.total + cost;
        state.sink += cost;
        room -= done.quantity * g.volume;
        for (const part of done.parts) {
          const sh: InlandShipment = {
            id: `i${(state.nextInlandNo = (state.nextInlandNo ?? 0) + 1)}`,
            linkId: link.id,
            from: fromId,
            to: toId,
            goodId: g.id,
            quantity: part.quantity,
            originCountryId: part.origin,
            brandCountryId: part.brand,
            departedAt: month,
            arrivesAt: month + link.months,
            unitValue: done.unitPrice,
          };
          state.inland.push(sh);
        }
      }
    }
  }
}

/** 배후 연결로 이동 중인 상품별 수량(물량 보존 확인용) */
export function inlandInTransit(state: EconomyState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of state.inland ?? []) out[s.goodId] = (out[s.goodId] ?? 0) + s.quantity;
  return out;
}
