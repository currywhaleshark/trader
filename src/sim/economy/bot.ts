import { retainedFraction, expectedSaleUnit, quoteBuy } from './market';
import { incomingCargo } from './npc';
import { expectedSaleFactor } from './policy';
import { canCarry, canEnter, cargoOf, estimateVoyage, isDocked, PLAYER_ID, playerBuyLimit, shipType } from './player';
import type { Command, EconomyContext, EconomyState, Ship } from './types';

/**
 * 밸런싱·테스트용 "부지런한 플레이어". 화면 없이 사람이 할 법한 수동 거래를 흉내 낸다.
 *  - 배가 항구에 서 있으면 실은 것을 팔고(값을 쳐주는 곳에서만),
 *  - 여기서 사서 다른 항구에 팔 때 한 달 이익이 가장 큰 상품 하나를 골라 싣고 떠난다.
 *  - 현금이 넉넉하면 배를 산다.
 * 게임 규칙의 빈틈을 찾는 용도가 아니라, 보통의 노력으로 회사가 크는 속도를 재는 용도다.
 */
export interface BotOptions {
  /** 살 배 종류(순서대로 시도) */
  buyShips: string[];
  /** 배를 살 때 배 한 척당 남겨 둘 운영 자금(짐 살 돈) */
  keepCashPerShip: number;
}

interface Plan {
  to: string;
  items: { goodId: string; quantity: number }[];
  perMonth: number;
}

/**
 * 목적지마다 실을 상품 꾸러미를 만든다: 부피당 예상 이익이 큰 순서로, 배와 현금이 허락하는 만큼.
 * 이익은 지금 값이 아니라 "오고 있는 배들과 내 짐까지 풀렸을 때의 값"으로 계산한다.
 */
function bestPlan(ctx: EconomyContext, state: EconomyState, ship: Ship): Plan | null {
  const here = ship.to;
  const src = state.cities[here];
  const type = shipType(ctx, ship.typeId);
  const spread = ctx.data.market.spread;
  const feePerVol = ctx.data.shipping.portFeePerUnit;
  let best: Plan | null = null;
  for (const to of ctx.portIds) {
    if (to === here || !canEnter(ctx, state, ship.typeId, to)) continue;
    const dest = state.cities[to];
    const v = estimateVoyage(ctx, ship.typeId!, here, to, state);
    if (!Number.isFinite(v.distanceKm)) continue;
    // 연료비와 한 달 유지비는 남기고 산다
    let budget = state.player.cash - v.fuel - v.fees - type.upkeepPerMonth;
    let room = ship.capacity;
    const cands: { goodId: string; perVol: number }[] = [];
    for (const g of ctx.goods) {
      if (!canCarry(ctx, ship.typeId, g.id) || dest.target[g.id] <= 0) continue;
      const keep = retainedFraction(ctx, g, v.months, type.refrigerated);
      const unit = expectedSaleUnit(ctx, dest, g.id, incomingCargo(state, to, g.id, ship), 1, v.months) * keep * expectedSaleFactor(ctx, state, here, g.id, to, v.months);
      const perVol = (unit - quoteBuy(ctx, src, g.id, 1, state).unitPrice) / g.volume - 2 * feePerVol;
      if (perVol > 0) cands.push({ goodId: g.id, perVol });
    }
    cands.sort((x, y) => y.perVol - x.perVol);
    const items: Plan['items'] = [];
    let profit = -v.fuel - v.fees - v.upkeep;
    for (const c of cands) {
      const g = ctx.goodById[c.goodId];
      if (room < g.volume || budget <= 0) break;
      const incoming = incomingCargo(state, to, g.id, ship);
      const absorb = dest.target[g.id] * 1.5 - dest.stock[g.id] - incoming;
      let qty = Math.min(room / g.volume, playerBuyLimit(ctx, state, ship, g.id), absorb);
      for (let k = 0; k < 30 && qty >= 1 && quoteBuy(ctx, src, g.id, qty, state).total + feePerVol * g.volume * qty > budget; k++) qty *= 0.85;
      if (qty < 1) continue;
      const keep = retainedFraction(ctx, g, v.months, type.refrigerated);
      const buy = quoteBuy(ctx, src, g.id, qty, state);
      const unit = expectedSaleUnit(ctx, dest, g.id, incoming, qty * keep, v.months) * expectedSaleFactor(ctx, state, here, g.id, to, v.months);
      const gain = unit * qty * keep - buy.total - feePerVol * g.volume * qty * (1 + keep);
      if (gain <= 0) continue;
      items.push({ goodId: g.id, quantity: qty });
      profit += gain;
      room -= qty * g.volume;
      budget -= buy.total + feePerVol * g.volume * qty;
    }
    if (items.length === 0 || profit <= 0) continue;
    const perMonth = profit / (v.months + 0.2);
    if (!best || perMonth > best.perMonth) best = { to, items, perMonth };
  }
  return best;
}

/** 지금 상태에서 봇이 내릴 명령들(applyCommand로 차례로 적용한다) */
export function botCommands(ctx: EconomyContext, state: EconomyState, opt: BotOptions): Command[] {
  const cmds: Command[] = [];
  for (const ship of state.ships) {
    if (ship.companyId !== PLAYER_ID || !isDocked(ship) || ship.routeId) continue;
    for (const lot of [...ship.cargo]) {
      if (state.cities[ship.to].target[lot.goodId] > 0) {
        cmds.push({ type: 'trade', shipId: ship.id, goodId: lot.goodId, side: 'sell', quantity: cargoOf(ship, lot.goodId) });
      }
    }
  }
  return cmds;
}

/** 판 다음의 상태에서 살 것·갈 곳을 정한다 */
export function botVoyages(ctx: EconomyContext, state: EconomyState): Command[] {
  const cmds: Command[] = [];
  for (const ship of state.ships) {
    if (ship.companyId !== PLAYER_ID || !isDocked(ship) || ship.routeId) continue;
    const plan = bestPlan(ctx, state, ship);
    if (plan) {
      for (const item of plan.items) cmds.push({ type: 'trade', shipId: ship.id, goodId: item.goodId, side: 'buy', quantity: item.quantity });
      cmds.push({ type: 'sail', shipId: ship.id, to: plan.to });
    }
  }
  return cmds;
}

export function botFleet(ctx: EconomyContext, state: EconomyState, opt: BotOptions): Command[] {
  for (const typeId of opt.buyShips) {
    const t = ctx.data.shipTypes.find((s) => s.id === typeId)!;
    const fleet = state.ships.filter((s) => s.companyId === PLAYER_ID).length;
    if (state.player.cash < t.price + opt.keepCashPerShip * (fleet + 1)) continue;
    if (canEnter(ctx, state, typeId, ctx.data.player.startCityId)) return [{ type: 'buyShip', typeId }];
  }
  return [];
}
