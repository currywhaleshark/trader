import { retainedFraction, expectedSaleUnit, quoteBuy, quoteSell, withheldFromShips } from '../sim/economy/market';
import { incomingCargo } from '../sim/economy/npc';
import { canCarry, canEnter, quoteCargoSale, estimateVoyage, isDocked, playerBuyLimit, shipType, type VoyageEstimate } from '../sim/economy/player';
import { expectedSaleFactor, lotTerms } from '../sim/economy/policy';
import { quoteSpecialtyBuy, specialtyById, specialtySaleUnit } from '../sim/economy/specialties';
import { cargoProducts, marketProducts, type TradeProduct } from '../sim/economy/products';
import { lotQuantity } from '../sim/economy/warehouse';
import type { GoodDef as Good } from '../sim/economy/data';
import type { EconomyContext, Ship } from '../sim/economy/types';
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
export interface TradeRow extends TradeProduct {
  offered: boolean;
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
  /** 이 항구가 배에 내놓지 않는 원자재(생산하지 않는 원유·철광석 등)인가 */
  withheld: boolean;
  /** 세계 평균보다 얼마나 싼가/비싼가(이 항구 값 / 평균 값) */
  priceVsWorld: number;
}

/** 시장을 해상 목적지로 고를 때는 내륙 시장과 실제로 연결된 관문항을 사용한다. */
export function shippingPortForMarket(ctx: EconomyContext, cityId: string): string | undefined {
  if (ctx.portIds.includes(cityId)) return cityId;
  return ctx.inlandLinks.find((l) => l.inlandId === cityId && l.open && ctx.portIds.includes(l.portId))?.portId;
}

export function canSendShipTo(sim: Pick<Simulation, 'ctx' | 'state'>, ship: Ship, portId: string): boolean {
  return isDocked(ship) && !ship.routeId && ship.to !== portId && canEnter(sim.ctx, sim.state, ship.typeId, portId)
    && Number.isFinite(voyageTo(sim, ship, portId)?.distanceKm);
}

export function voyageTo(sim: Pick<Simulation, 'ctx' | 'state'>, ship: Ship, dest: string | null): VoyageEstimate | null {
  if (!dest || !ship.typeId || dest === ship.to) return null;
  return estimateVoyage(sim.ctx, ship.typeId, ship.to, dest, sim.state);
}

/** 거래 표 계산(내 배 패널·항구 창이 함께 쓴다). plan: 상품별로 사려는 양(없으면 최대) */
export function tradeRows(sim: Pick<Simulation, 'ctx' | 'state'>, ship: Ship, dest: string | null, plan: Record<string, number> = {}, brands: Record<string, string | undefined> = {}): TradeRow[] {
  const { ctx, state } = sim;
  if (!isDocked(ship)) return [];
  const here = ship.to;
  const city = state.cities[here];
  const type = shipType(ctx, ship.typeId);
  const voyage = voyageTo(sim, ship, dest);
  const market = marketProducts(ctx, state, here);
  const offered = new Set(market.map((p) => p.id));
  const products = [...market, ...cargoProducts(ctx, ship.cargo).filter((p) => !offered.has(p.id))];
  return products.map((product) => {
      const g = ctx.goodById[product.goodId];
      const brand = brands[product.id];
      const specialty = specialtyById(ctx, product.specialtyId);
      const have = lotQuantity(ship.cargo, g.id, product.specialtyId);
      const buyable = playerBuyLimit(ctx, state, ship, g.id, brand, specialty?.id);
      const purchaseQuote = (q: number) => specialty ? quoteSpecialtyBuy(ctx, state, here, specialty, q) : quoteBuy(ctx, city, g.id, q, state, brand);
      const fee = ctx.data.shipping.portFeePerUnit * g.volume;
      const buyUnit = purchaseQuote(1).unitPrice + (buyable > 0 ? fee : 0);
      const sellUnit = city.target[g.id] <= 0 ? 0 : have > 0 ? quoteCargoSale(ctx, state, ship, g.id, 1, product.specialtyId).unitPrice : Math.max(0, quoteSell(ctx, city, g.id, 1).unitPrice - fee);
      let destUnit: number | null = null;
      let perUnit: number | null = null;
      let duty = 0;
      if (voyage?.leg && dest && state.cities[dest].target[g.id] > 0 && canCarry(ctx, type.id, g.id)) {
        const amount = Math.max(1, Math.min(buyable, plan[product.id] || buyable || 1));
        const keep = retainedFraction(ctx, g, voyage.months, type.refrigerated);
        // 관세(원산지 기준)·문화 웃돈(상표 기준)까지 따진 "손에 쥐는" 값
        const marketMonths = Math.floor(voyage.months) + 1;
        const factor = expectedSaleFactor(ctx, state, here, g.id, dest, marketMonths, brand);
        const purchase = purchaseQuote(amount);
        const arrivalMonth = state.month + marketMonths;
        duty = purchase.quantity > 0 ? purchase.parts.reduce((sum, p) =>
          sum + p.quantity * lotTerms(ctx, state, dest, g.id, p.origin, p.brand, arrivalMonth).tariff, 0) / purchase.quantity : 0;
        destUnit = expectedSaleUnit(ctx, state.cities[dest], g.id, incomingCargo(state, dest, g.id, ship), amount * keep, marketMonths) * keep * factor;
        destUnit = Math.max(0, destUnit - fee * keep);
        if (specialty && purchase.quantity > 0) {
          const base = expectedSaleUnit(ctx, state.cities[dest], g.id, incomingCargo(state, dest, g.id, ship), amount * keep, marketMonths);
          const terms = lotTerms(ctx, state, dest, g.id, specialty.countryId, specialty.countryId, arrivalMonth);
          const unit = specialtySaleUnit(ctx, { goodId: g.id, specialtyId: specialty.id, originCityId: here, originCountryId: specialty.countryId, brandCountryId: specialty.countryId, quantity: amount, unitCost: purchase.unitPrice + fee }, ctx.countryOfCity[dest], base * (1 + terms.premium), terms.tariff, fee);
          destUnit = Math.max(0, unit.grossUnit * (1 - terms.tariff) - fee) * keep;
        }
        perUnit = purchase.quantity > 0 ? destUnit - purchase.unitPrice - fee : null;
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
      return { ...product, offered: offered.has(product.id), g, buyable, buyUnit, sellUnit, have, destUnit, perUnit, duty, carry: canCarry(ctx, type.id, g.id), withheld: withheldFromShips(ctx, state, city, g.id), priceVsWorld };
    });
}
