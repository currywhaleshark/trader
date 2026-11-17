import { forecastPrice, quoteBuy, quoteSell } from '../sim/economy/market';
import { incomingCargo } from '../sim/economy/npc';
import { originShares } from '../sim/economy/origin';
import { canCarry, cargoOf, estimateVoyage, isDocked, playerBuyLimit, shipType, type VoyageEstimate } from '../sim/economy/player';
import { expectedSaleFactor, tariffRate } from '../sim/economy/policy';
import type { GoodDef as Good } from '../sim/economy/data';
import type { Ship } from '../sim/economy/types';
import type { Simulation } from './useSimulation';

export const won = (v: number) => Math.round(v).toLocaleString('ko-KR');
export const qty = (v: number) => (v >= 10 ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(1));

/**
 * 수량 막대(1개씩 움직임). 살 때는 온전한 개수만 고르고, 팔 때는 막대 끝 칸이 "실은 것 전부"다.
 * 상한 짐은 39.4개처럼 소수로 남는데, 1개씩 움직이는 막대로 39까지만 팔면 0.4개 찌꺼기가 영영 남는다.
 */
export function tradeSlider(side: 'buy' | 'sell', buyable: number, have: number): { max: number; quantity: (v: number) => number } {
  if (side === 'buy') {
    const max = Math.max(0, Math.floor(buyable + 1e-9));
    return { max, quantity: (v) => Math.max(0, Math.min(Math.round(v), max)) };
  }
  const max = have > 1e-9 ? Math.ceil(have - 1e-9) : 0;
  return { max, quantity: (v) => Math.max(0, Math.min(Math.round(v), have)) };
}

/** 정박한 배가 지금 항구에서 할 수 있는 거래 한 줄(상품 하나) */
export interface TradeRow {
  g: Good;
  /** 이 배가 지금 살 수 있는 최대량(돈·자리·물량) */
  buyable: number;
  buyUnit: number;
  /** 0이면 이 항구에서는 못 판다 */
  sellUnit: number;
  have: number;
  /** 목적지에서 손에 쥘 1개 값(관세·문화 웃돈·상함 반영) */
  destUnit: number | null;
  /** 1개당 남는 돈(항만비 포함, 연료비 제외) */
  perUnit: number | null;
  /** 원산지 섞임을 따진 평균 관세율 */
  duty: number;
  carry: boolean;
  /** 세계 평균보다 얼마나 싼가/비싼가(이 항구 값 / 평균 값) */
  priceVsWorld: number;
}

export function voyageTo(sim: Simulation, ship: Ship, dest: string | null): VoyageEstimate | null {
  if (!dest || !ship.typeId || dest === ship.to) return null;
  return estimateVoyage(sim.ctx, ship.typeId, ship.to, dest);
}

/** 거래 표 계산(내 배 패널·항구 창이 함께 쓴다). plan: 상품별로 사려는 양(없으면 최대) */
export function tradeRows(sim: Simulation, ship: Ship, dest: string | null, plan: Record<string, number> = {}): TradeRow[] {
  const { ctx, state } = sim;
  if (!isDocked(ship)) return [];
  const here = ship.to;
  const city = state.cities[here];
  const type = shipType(ctx, ship.typeId);
  const voyage = voyageTo(sim, ship, dest);
  return ctx.goods
    .filter((g) => city.target[g.id] > 0 || cargoOf(ship, g.id) > 0)
    .map((g) => {
      const buyable = playerBuyLimit(ctx, state, ship, g.id);
      const buyUnit = quoteBuy(ctx, city, g.id, 1).unitPrice;
      const sellUnit = city.target[g.id] > 0 ? quoteSell(ctx, city, g.id, 1).unitPrice : 0;
      let destUnit: number | null = null;
      let perUnit: number | null = null;
      let duty = 0;
      if (voyage && dest && state.cities[dest].target[g.id] > 0 && canCarry(ctx, type.id, g.id)) {
        const amount = Math.max(1, Math.min(buyable, plan[g.id] || buyable || 1));
        const keep = type.refrigerated || g.cargoClass !== 'perishable' ? 1 : Math.pow(1 - ctx.data.player.spoilagePerMonth, voyage.months);
        // 관세(원산지 기준)·문화 웃돈(상표 기준)까지 따진 "손에 쥐는" 값
        const factor = expectedSaleFactor(ctx, state, here, g.id, dest);
        const origins = originShares(city, g.id);
        duty = Object.entries(origins).reduce((s, [o, w]) => s + w * tariffRate(ctx, state, ctx.countryOfCity[dest], g.id, o), 0);
        destUnit =
          forecastPrice(ctx, state.cities[dest], g.id, incomingCargo(state, dest, g.id, ship) + amount * keep, voyage.months) *
          (1 - ctx.data.market.spread) *
          keep *
          factor;
        perUnit = destUnit - buyUnit - 2 * ctx.data.shipping.portFeePerUnit * g.volume;
      }
      let sum = 0;
      let n = 0;
      for (const id of ctx.cityIds) {
        if (state.cities[id].target[g.id] > 0) {
          sum += state.cities[id].price[g.id];
          n++;
        }
      }
      const priceVsWorld = n > 0 && sum > 0 ? city.price[g.id] / (sum / n) : 1;
      return { g, buyable, buyUnit, sellUnit, have: cargoOf(ship, g.id), destUnit, perUnit, duty, carry: canCarry(ctx, type.id, g.id), priceVsWorld };
    });
}
